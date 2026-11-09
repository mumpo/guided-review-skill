import { expect, test } from "bun:test";
import fixture from "../../../packages/core/fixtures/valid.json";
import { githubThreadService } from "./threads";
import type {
  CommentTransport,
  PublishedComment,
  ReviewThread,
} from "./comments";

const pr = fixture.pullRequest;
const comment = (id = 1) => ({
  databaseId: id,
  id: `C${id}`,
  body: `body ${id}`,
  author: { login: "alice" },
  url: `${pr.url}#discussion_r${id}`,
  reactionGroups: [
    { content: "HEART", viewerHasReacted: true, reactors: { totalCount: 2 } },
  ],
});
const connection = (nodes: unknown[], next: string | null = null) => ({
  nodes,
  pageInfo: { hasNextPage: next !== null, endCursor: next },
});
const thread = (id = "T1") => ({
  id,
  path: "src/greeting.ts",
  diffSide: "LEFT",
  line: 2,
  startLine: 1,
  subjectType: "LINE",
  isResolved: true,
  isOutdated: false,
  comments: connection([comment()]),
});
const response = (nodes: unknown[], next: string | null = null) =>
  JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          baseRefOid: pr.baseCommit,
          headRefOid: pr.headCommit,
          reviewThreads: connection(nodes, next),
        },
      },
    },
  });

test("loads all thread and comment pages, preserves anchors, reactions, deleted authors and resolved state", async () => {
  const requests: { query: string; variables: Record<string, unknown> }[] = [];
  const first = thread();
  first.comments = connection([comment()], "comments2");
  const run: CommentTransport = async (args, input) => {
    expect(args).toEqual([
      "api",
      "--hostname",
      "github.com",
      "graphql",
      "--input",
      "-",
    ]);
    const request = JSON.parse(input ?? "");
    requests.push(request);
    if (request.variables.id)
      return JSON.stringify({
        data: {
          node: {
            comments: connection([{ ...comment(2), author: null }]),
          },
        },
      });
    if (request.variables.cursor)
      return response([
        { ...thread("T2"), subjectType: "FILE", startLine: null, line: null },
      ]);

    return response([first], "threads2");
  };

  const threads = await githubThreadService(pr, run).load();

  expect(requests).toHaveLength(4);
  expect(requests[1].variables).toEqual({ id: "T1", cursor: "comments2" });
  expect(requests[2].variables.cursor).toBe("threads2");
  expect(threads[0]).toMatchObject({
    id: "T1",
    side: "old",
    line: 2,
    startLine: 1,
    resolved: true,
  });
  expect(threads[0].comments.map((item) => item.author)).toEqual([
    "alice",
    "[deleted]",
  ]);
  expect(threads[0].comments[0].reactions).toEqual([
    { content: "HEART", count: 2, viewerHasReacted: true },
  ]);
  expect(threads[1].fileLevel).toBe(true);
});

test("changed commits, malformed responses and repeated cursors fail instead of attaching incorrect threads", async () => {
  const failures = [
    JSON.stringify({ errors: [{ message: "denied" }] }),
    response([{ ...thread(), diffSide: "wrong" }]),
    response([{ ...thread(), startLine: 3 }]),
    response([{ ...thread(), comments: connection([]) }]),
    response([
      {
        ...thread(),
        comments: connection([{ ...comment(), url: "https://other.test" }]),
      },
    ]),
    response([
      {
        ...thread(),
        comments: connection([
          { ...comment(), reactionGroups: [], databaseId: -1 },
        ]),
      },
    ]),
    response([]).replace(pr.headCommit, "changed"),
    response([], "same"),
  ];
  for (const output of failures) {
    await expect(
      githubThreadService(pr, async () => output).load(),
    ).rejects.toThrow();
  }
});

test("replies target the root comment, preserve literal bodies, and are never retried on an uncertain failure", async () => {
  const calls: { args: string[]; input?: string }[] = [];
  const body = "reply\n`$(literal)` ❤️";
  const run: CommentTransport = async (args, input) => {
    calls.push({ args, input });

    return JSON.stringify({
      id: 2,
      node_id: "C2",
      body,
      user: { login: "me" },
      html_url: `${pr.url}#discussion_r2`,
    });
  };
  const target: ReviewThread = {
    id: "T",
    path: "a",
    side: "new",
    line: 1,
    resolved: false,
    outdated: false,
    comments: [
      { id: 1, body: "root", author: "a", url: `${pr.url}#discussion_r1` },
    ],
  };

  const posted = await githubThreadService(pr, run).reply(target, body);

  expect(posted.body).toBe(body);
  expect(calls[0].args).toContain(
    `repos/${pr.owner}/${pr.repository}/pulls/${pr.number}/comments/1/replies`,
  );
  expect(JSON.parse(calls[0].input ?? "")).toEqual({ body });
  let attempts = 0;
  await expect(
    githubThreadService(pr, async () => {
      attempts++;
      throw new Error("timeout");
    }).reply(target, body),
  ).rejects.toThrow("reply may have been published");
  expect(attempts).toBe(1);
});

test("reaction writes add and remove the viewer's reaction by comment node ID and return authoritative counts", async () => {
  const calls: { query: string; variables: unknown }[] = [];
  const item: PublishedComment = {
    id: 1,
    nodeId: "C1",
    body: "body",
    author: "alice",
    url: `${pr.url}#discussion_r1`,
  };
  const service = githubThreadService(pr, async (_args, input) => {
    const request = JSON.parse(input ?? "");
    calls.push(request);
    const operation = request.query.includes("removeReaction")
      ? "removeReaction"
      : "addReaction";

    return JSON.stringify({
      data: {
        [operation]: { subject: { reactionGroups: comment().reactionGroups } },
      },
    });
  });

  expect(await service.react(item, "HEART", false)).toEqual([
    { content: "HEART", count: 2, viewerHasReacted: true },
  ]);
  await service.react(item, "HEART", true);

  expect(calls[0].query).toContain("addReaction");
  expect(calls[1].query).toContain("removeReaction");
  expect(calls[1].variables).toEqual({
    input: { subjectId: "C1", content: "HEART" },
  });
});

test("invalid PR identity and cancelled operations do not reach transport", async () => {
  let calls = 0;
  const run: CommentTransport = async () => {
    calls++;
    return response([]);
  };
  await expect(
    githubThreadService({ ...pr, owner: "../other" }, run).load(),
  ).rejects.toThrow("Invalid GitHub");
  const abort = new AbortController();
  abort.abort();
  await expect(
    githubThreadService(pr, run, abort.signal).load(),
  ).rejects.toThrow();

  expect(calls).toBe(0);
});

test("commit changes during nested pagination are rejected by the final metadata check", async () => {
  let reads = 0;
  await expect(
    githubThreadService(pr, async () => {
      reads++;

      return reads === 1
        ? response([thread()])
        : response([]).replace(pr.baseCommit, "changed");
    }).load(),
  ).rejects.toThrow("Generate a fresh artifact");

  expect(reads).toBe(2);
});

test("cross-side ranges preserve both sides and uncertain reaction failures never retry", async () => {
  const threads = await githubThreadService(pr, async () =>
    response([{ ...thread(), startDiffSide: "RIGHT", startLine: 10, line: 2 }]),
  ).load();

  expect(threads[0]).toMatchObject({
    startSide: "new",
    side: "old",
    startLine: 10,
    line: 2,
  });
  let attempts = 0;
  await expect(
    githubThreadService(pr, async () => {
      attempts++;
      throw new Error("timeout");
    }).react(threads[0].comments[0], "HEART", true),
  ).rejects.toThrow("reaction may have changed");
  expect(attempts).toBe(1);
});

test("64-bit comment IDs use fullDatabaseId and outdated null anchors do not block current threads", async () => {
  const threads = await githubThreadService(pr, async (_args, input) => {
    const query = JSON.parse(input ?? "").query;
    if (query.includes("reviewThreads"))
      expect(query).toContain("databaseId: fullDatabaseId");

    return response([
      {
        ...thread(),
        comments: connection([{ ...comment(), databaseId: "3000000000" }]),
      },
      { ...thread("old"), isOutdated: true, line: null, startLine: 1 },
    ]);
  }).load();

  expect(threads).toHaveLength(1);
  expect(threads[0].comments[0].id).toBe(3000000000);
  await expect(
    githubThreadService(pr, async () =>
      response([
        {
          ...thread(),
          comments: connection([
            { ...comment(), databaseId: "9007199254740993" },
          ]),
        },
      ]),
    ).load(),
  ).rejects.toThrow();
});
