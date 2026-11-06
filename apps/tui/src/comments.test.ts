import { expect, test } from "bun:test";
import fixture from "../../../packages/core/fixtures/valid.json";
import {
  githubCommentPublisher,
  type CommentTarget,
  type CommentTransport,
} from "./comments";

const pr = fixture.pullRequest;
const target: CommentTarget = {
  fileId: "guide",
  path: "docs/guide.md",
  side: "old",
  line: 12,
};
const posted = {
  id: 15,
  body: "comment",
  user: { login: "reviewer" },
  html_url: `${pr.url}#discussion_r15`,
};

test("publishes literal JSON to the selected source coordinates after checking captured commits", async () => {
  for (const side of ["old", "new"] as const) {
    const calls: { args: string[]; input?: string }[] = [];
    const run: CommentTransport = async (args, input) => {
      calls.push({ args, input });

      return JSON.stringify(
        input
          ? posted
          : { base: { sha: pr.baseCommit }, head: { sha: pr.headCommit } },
      );
    };
    const body = 'Line one\n`code` $(literal) @file "quoted" 🐱';

    // GitHub may canonicalize owner/repository casing in its response URL.
    const identity = {
      ...pr,
      owner: "Example",
      repository: "Project",
      url: "https://github.com/Example/Project/pull/42",
    };
    const result = await githubCommentPublisher(identity, run)(
      { ...target, side },
      body,
    );

    expect(calls).toHaveLength(2);
    expect(calls[0].args).toEqual([
      "api",
      "--hostname",
      "github.com",
      "repos/Example/Project/pulls/42",
    ]);
    expect(calls[1].args).toEqual([
      "api",
      "--hostname",
      "github.com",
      "--method",
      "POST",
      "repos/Example/Project/pulls/42/comments",
      "--input",
      "-",
    ]);
    expect(JSON.parse(calls[1].input ?? "")).toEqual({
      body,
      commit_id: pr.headCommit,
      path: target.path,
      side: side === "old" ? "LEFT" : "RIGHT",
      line: 12,
    });
    expect(result).toEqual({
      id: 15,
      body: "comment",
      author: "reviewer",
      url: posted.html_url,
    });
  }
});

test("changed base or head prevents all write requests", async () => {
  for (const changed of ["base", "head"]) {
    let calls = 0;
    const run: CommentTransport = async () => {
      calls++;

      return JSON.stringify({
        base: { sha: changed === "base" ? "changed" : pr.baseCommit },
        head: { sha: changed === "head" ? "changed" : pr.headCommit },
      });
    };

    await expect(
      githubCommentPublisher(pr, run)(target, "draft"),
    ).rejects.toThrow("fresh artifact");
    expect(calls).toBe(1);
  }
});

test("empty bodies and unsafe identities fail before accessing GitHub", async () => {
  const run: CommentTransport = async () => {
    throw new Error("transport must not run");
  };

  await expect(githubCommentPublisher(pr, run)(target, " \n")).rejects.toThrow(
    "Write a comment",
  );
  await expect(
    githubCommentPublisher({ ...pr, url: "https://example.com/pull/42" }, run)(
      target,
      "draft",
    ),
  ).rejects.toThrow("Invalid GitHub");
});

test("write failures are never retried and acknowledge ambiguous publication", async () => {
  let writes = 0;
  const run: CommentTransport = async (_args, input) => {
    if (input) {
      writes++;
      throw new Error("connection lost");
    }

    return JSON.stringify({
      base: { sha: pr.baseCommit },
      head: { sha: pr.headCommit },
    });
  };

  await expect(
    githubCommentPublisher(pr, run)(target, "draft"),
  ).rejects.toThrow("Check GitHub before retrying");
  expect(writes).toBe(1);
});

test("authentication failures during the read do not attempt a write", async () => {
  let calls = 0;
  const run: CommentTransport = async () => {
    calls++;
    throw new Error("gh auth login required");
  };

  await expect(
    githubCommentPublisher(pr, run)(target, "draft"),
  ).rejects.toThrow("gh auth login");
  expect(calls).toBe(1);
});

test("viewer shutdown aborts the transport and prevents posting after a delayed metadata read", async () => {
  const controller = new AbortController();
  let calls = 0;
  const run: CommentTransport = async (_args, _input, signal) => {
    calls++;
    expect(signal).toBe(controller.signal);
    controller.abort();

    return JSON.stringify({
      base: { sha: pr.baseCommit },
      head: { sha: pr.headCommit },
    });
  };

  await expect(
    githubCommentPublisher(pr, run, controller.signal)(target, "draft"),
  ).rejects.toThrow();
  expect(calls).toBe(1);
});

test("malformed write responses retain uncertainty instead of reporting success", async () => {
  const run: CommentTransport = async (_args, input) =>
    JSON.stringify(
      input
        ? { id: 15 }
        : { base: { sha: pr.baseCommit }, head: { sha: pr.headCommit } },
    );

  await expect(
    githubCommentPublisher(pr, run)(target, "draft"),
  ).rejects.toThrow("Check GitHub before retrying");
});
