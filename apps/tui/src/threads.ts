import type { ReviewSnapshot } from "../../../packages/core/src";
import {
  gh,
  reactionChoices,
  type CommentTransport,
  type PublishedComment,
  type Reaction,
  type ReactionContent,
  type ReviewThread,
  type ThreadService,
} from "./comments";

const commentFields = `databaseId: fullDatabaseId id body author { login } url
  reactionGroups { content viewerHasReacted reactors { totalCount } }`;
const connectionFields = `pageInfo { hasNextPage endCursor } nodes { ${commentFields} }`;
const threadFields = `id path diffSide line startLine startDiffSide subjectType isResolved isOutdated
  comments(first: 100) { ${connectionFields} }`;

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Unexpected response from GitHub.");

  return value as RecordValue;
}

function string(value: unknown): string {
  if (typeof value !== "string" || !value)
    throw new Error("Unexpected response from GitHub.");

  return value;
}

function lineNumber(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new Error("Unexpected comment coordinates from GitHub.");

  return value as number;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw new Error("Unexpected response from GitHub.");

  return value;
}

export function parseReactions(value: unknown): Reaction[] {
  if (!Array.isArray(value))
    throw new Error("Unexpected reactions from GitHub.");

  return value.map((item) => {
    const group = record(item);
    if (!reactionChoices.some(([content]) => content === group.content))
      throw new Error("Unexpected reaction from GitHub.");
    const count = record(group.reactors).totalCount;
    if (!Number.isSafeInteger(count) || (count as number) < 0)
      throw new Error("Unexpected reaction count from GitHub.");

    return {
      content: group.content as ReactionContent,
      count: count as number,
      viewerHasReacted: boolean(group.viewerHasReacted),
    };
  });
}

/** Network operations are confined to the TUI and never alter the artifact. */
export function githubThreadService(
  pr: ReviewSnapshot["pullRequest"],
  run: CommentTransport = gh,
  signal?: AbortSignal,
): ThreadService {
  const endpoint = `repos/${pr.owner}/${pr.repository}/pulls/${pr.number}`;
  const validate = () => {
    if (
      !/^[\w.-]+$/.test(pr.owner) ||
      !/^[\w.-]+$/.test(pr.repository) ||
      !Number.isSafeInteger(pr.number) ||
      pr.number < 1 ||
      pr.url !==
        `https://github.com/${pr.owner}/${pr.repository}/pull/${pr.number}`
    )
      throw new Error("Invalid GitHub comment target.");
    signal?.throwIfAborted();
  };
  const graph = async (
    query: string,
    variables: Record<string, unknown> = {},
  ) => {
    validate();
    const result = record(
      JSON.parse(
        await run(
          ["api", "--hostname", "github.com", "graphql", "--input", "-"],
          JSON.stringify({ query, variables }),
          signal,
        ),
      ),
    );
    if (result.errors)
      throw new Error(
        "GitHub could not complete the thread request. Check authentication and PR access.",
      );

    return record(result.data);
  };
  const parseComment = (value: unknown): PublishedComment => {
    const item = record(value);
    // GitHub's BigInt scalar may be serialized as a decimal string.
    const databaseId =
      typeof item.databaseId === "string" && /^[1-9]\d*$/.test(item.databaseId)
        ? Number(item.databaseId)
        : item.databaseId;
    const id = lineNumber(databaseId);
    const url = string(item.url);
    if (!id || !url.startsWith(`${pr.url}#`) || typeof item.body !== "string")
      throw new Error("Unexpected comment from GitHub.");

    return {
      id,
      nodeId: string(item.id),
      body: item.body,
      author:
        item.author === null ? "[deleted]" : string(record(item.author).login),
      url,
      reactions: parseReactions(item.reactionGroups),
    };
  };
  const page = (value: unknown) => {
    const connection = record(value);
    if (!Array.isArray(connection.nodes))
      throw new Error("Incomplete GitHub thread response.");
    const info = record(connection.pageInfo);
    const next = boolean(info.hasNextPage) ? string(info.endCursor) : null;

    return { nodes: connection.nodes, next };
  };

  const checkCommits = (value: unknown) => {
    const pull = record(value);
    if (pull.baseRefOid !== pr.baseCommit || pull.headRefOid !== pr.headCommit)
      throw new Error(
        "The PR has changed. Generate a fresh artifact to display existing threads.",
      );

    return pull;
  };

  return {
    async load() {
      const threads: ReviewThread[] = [];
      let cursor: string | null = null;
      const cursors = new Set<string>();
      do {
        const data = await graph(
          `query($owner:String!,$repo:String!,$number:Int!,$cursor:String) {
          repository(owner:$owner,name:$repo) { pullRequest(number:$number) {
            baseRefOid headRefOid reviewThreads(first:100,after:$cursor) {
              pageInfo { hasNextPage endCursor } nodes { ${threadFields} }
            }
          } }
        }`,
          { owner: pr.owner, repo: pr.repository, number: pr.number, cursor },
        );
        const pull = checkCommits(record(data.repository).pullRequest);
        const result = page(pull.reviewThreads);
        for (const value of result.nodes) {
          const item = record(value);
          const id = string(item.id);
          if (boolean(item.isOutdated)) continue;

          if (item.diffSide !== "LEFT" && item.diffSide !== "RIGHT")
            throw new Error("Unexpected comment side from GitHub.");
          if (item.subjectType !== "LINE" && item.subjectType !== "FILE")
            throw new Error("Unexpected thread type from GitHub.");
          let comments = page(item.comments);
          const all = comments.nodes.map(parseComment);
          const commentCursors = new Set<string>();
          while (comments.next) {
            if (commentCursors.has(comments.next))
              throw new Error("Incomplete GitHub comment pagination.");
            commentCursors.add(comments.next);
            const next = await graph(
              `query($id:ID!,$cursor:String!) {
              node(id:$id) { ... on PullRequestReviewThread {
                comments(first:100,after:$cursor) { ${connectionFields} }
              } }
            }`,
              { id, cursor: comments.next },
            );
            comments = page(record(next.node).comments);
            all.push(...comments.nodes.map(parseComment));
          }
          const line = lineNumber(item.line);
          const startLine = lineNumber(item.startLine);
          const startSide =
            item.startDiffSide === "LEFT"
              ? "old"
              : item.startDiffSide === "RIGHT"
                ? "new"
                : undefined;
          if (
            startLine !== null &&
            (line === null ||
              ((!startSide || item.startDiffSide === item.diffSide) &&
                startLine > line))
          )
            throw new Error("Unexpected comment range from GitHub.");
          if (item.startDiffSide != null && !startSide)
            throw new Error("Unexpected range side from GitHub.");
          if (!all.length)
            throw new Error("Incomplete GitHub thread response.");
          threads.push({
            id,
            path: string(item.path),
            side: item.diffSide === "LEFT" ? "old" : "new",
            line,
            startLine,
            startSide,
            fileLevel: item.subjectType === "FILE",
            resolved: boolean(item.isResolved),
            outdated: boolean(item.isOutdated),
            comments: [
              ...new Map(all.map((comment) => [comment.id, comment])).values(),
            ],
          });
        }
        cursor = result.next;
        if (cursor && cursors.has(cursor))
          throw new Error("Incomplete GitHub thread pagination.");
        if (cursor) cursors.add(cursor);
      } while (cursor);

      // Nested comment pages may take time; recheck coordinates after the final page.
      const final = await graph(
        `query($owner:String!,$repo:String!,$number:Int!) {
        repository(owner:$owner,name:$repo) { pullRequest(number:$number) { baseRefOid headRefOid } }
      }`,
        { owner: pr.owner, repo: pr.repository, number: pr.number },
      );
      checkCommits(record(final.repository).pullRequest);

      return [
        ...new Map(threads.map((thread) => [thread.id, thread])).values(),
      ];
    },
    async reply(thread, body) {
      validate();
      if (!body.trim()) throw new Error("Write a comment before publishing.");
      const root = thread.comments[0];
      if (!root || !Number.isSafeInteger(root.id) || root.id < 1)
        throw new Error("Invalid reply target.");
      try {
        const result = record(
          JSON.parse(
            await run(
              [
                "api",
                "--hostname",
                "github.com",
                "--method",
                "POST",
                `${endpoint}/comments/${root.id}/replies`,
                "--input",
                "-",
              ],
              JSON.stringify({ body }),
              signal,
            ),
          ),
        );

        return parseComment({
          databaseId: result.id,
          id: result.node_id,
          body: result.body,
          author: result.user,
          url: result.html_url,
          reactionGroups: [],
        });
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} Check GitHub before retrying: the reply may have been published.`,
        );
      }
    },
    async react(comment, content, remove) {
      if (
        !comment.nodeId ||
        !reactionChoices.some(([choice]) => choice === content)
      )
        throw new Error("Invalid reaction target.");
      const mutation = remove ? "removeReaction" : "addReaction";
      const input = remove ? "RemoveReactionInput!" : "AddReactionInput!";
      try {
        const result = await graph(
          `mutation($input:${input}) {
          ${mutation}(input:$input) { subject { reactionGroups {
            content viewerHasReacted reactors { totalCount }
          } } }
        }`,
          { input: { subjectId: comment.nodeId, content } },
        );

        return parseReactions(
          record(record(result[mutation]).subject).reactionGroups,
        );
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} Check GitHub before retrying: the reaction may have changed.`,
        );
      }
    },
  };
}
