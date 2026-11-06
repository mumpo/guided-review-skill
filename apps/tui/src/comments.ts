import type { ReviewSnapshot } from "../../../packages/core/src";

export interface CommentTarget {
  fileId: string;
  path: string;
  side: "old" | "new";
  line: number;
}

export interface PublishedComment {
  id: number;
  body: string;
  author: string;
  url: string;
}

export type PublishComment = (
  target: CommentTarget,
  body: string,
) => Promise<PublishedComment>;

export type CommentTransport = (
  args: string[],
  input?: string,
  signal?: AbortSignal,
) => Promise<string>;

const gh: CommentTransport = async (args, input, signal) => {
  let child: Bun.Subprocess<"ignore" | Uint8Array, "pipe", "pipe">;
  try {
    child = Bun.spawn(["gh", ...args], {
      stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      signal,
    });
  } catch {
    throw new Error(
      "Could not start gh. Install GitHub CLI and run gh auth login.",
    );
  }

  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (code !== 0) {
    throw new Error(
      `gh failed: ${error.trim() || "check authentication and PR access"}`,
    );
  }

  return output;
};

/** All network access is deferred until the user explicitly publishes. */
export function githubCommentPublisher(
  pr: ReviewSnapshot["pullRequest"],
  run: CommentTransport = gh,
  signal?: AbortSignal,
): PublishComment {
  return async (target, body) => {
    signal?.throwIfAborted();
    if (!body.trim()) throw new Error("Write a comment before publishing.");

    // Validate the captured identity before using it to address a writable endpoint.
    const url = new URL(pr.url);
    const expected = `/${pr.owner}/${pr.repository}/pull/${pr.number}`;
    if (
      url.origin !== "https://github.com" ||
      url.username ||
      url.password ||
      url.pathname !== expected ||
      url.search ||
      url.hash ||
      !/^[a-zA-Z0-9_.-]+$/.test(pr.owner) ||
      !/^[a-zA-Z0-9_.-]+$/.test(pr.repository) ||
      !Number.isSafeInteger(pr.number) ||
      pr.number < 1 ||
      !Number.isSafeInteger(target.line) ||
      target.line < 1 ||
      !target.path ||
      !["old", "new"].includes(target.side)
    )
      throw new Error("Invalid GitHub comment target.");

    const endpoint = `repos/${pr.owner}/${pr.repository}/pulls/${pr.number}`;
    const metadata = JSON.parse(
      await run(
        ["api", "--hostname", "github.com", endpoint],
        undefined,
        signal,
      ),
    );
    if (
      metadata?.base?.sha !== pr.baseCommit ||
      metadata?.head?.sha !== pr.headCommit
    ) {
      throw new Error(
        "The PR has changed. Generate a fresh artifact before publishing. Your draft is retained for this session.",
      );
    }

    signal?.throwIfAborted();

    let response: PublishedComment;
    try {
      const result = JSON.parse(
        await run(
          [
            "api",
            "--hostname",
            "github.com",
            "--method",
            "POST",
            `${endpoint}/comments`,
            "--input",
            "-",
          ],
          JSON.stringify({
            body,
            commit_id: pr.headCommit,
            path: target.path,
            side: target.side === "old" ? "LEFT" : "RIGHT",
            line: target.line,
          }),
          signal,
        ),
      );

      if (
        !Number.isSafeInteger(result.id) ||
        typeof result.body !== "string" ||
        typeof result.user?.login !== "string" ||
        typeof result.html_url !== "string" ||
        !result.html_url
          .toLowerCase()
          .startsWith(
            `https://github.com/${pr.owner}/${pr.repository}/pull/${pr.number}#`.toLowerCase(),
          )
      ) {
        throw new Error("Unexpected response from GitHub.");
      }

      response = {
        id: result.id,
        body: result.body,
        author: result.user.login,
        url: result.html_url,
      };
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} Check GitHub before retrying: the comment may have been published.`,
      );
    }

    return response;
  };
}

export function commentKey(target: CommentTarget): string {
  return JSON.stringify([target.fileId, target.side, target.line]);
}
