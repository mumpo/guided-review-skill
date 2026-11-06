import {
  type DiffFile,
  parseDiff,
  type ReviewSnapshot,
} from "../../core/src/index";

export interface CollectedPullRequest {
  pullRequest: ReviewSnapshot["pullRequest"];
  files: DiffFile[];
}

/** Runs gh with argument boundaries preserved and returns stdout. */
export type GhRunner = (args: string[]) => Promise<string>;

function spawnGh(args: string[]) {
  return Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
}

export const runGh: GhRunner = async (args) => {
  let process: ReturnType<typeof spawnGh>;
  try {
    process = spawnGh(args);
  } catch (error) {
    throw new Error(`Could not start gh; install GitHub CLI: ${String(error)}`);
  }

  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `gh failed (${code}): ${stderr.trim() || "check authentication and PR access"}`,
    );
  }

  return stdout;
};

type Obj = Record<string, unknown>;

function object(value: unknown, label: string): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label}: expected an object`);

  return value as Obj;
}

function str(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label}: expected a non-empty string`);

  return value;
}

function count(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(`${label}: expected a non-negative integer`);

  return value as number;
}

function json(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: invalid JSON returned by gh`);
  }
}

// Git quotes paths containing control characters, quotes, backslashes, or non-ASCII bytes.
function gitPath(path: string): string {
  const bytes = new TextEncoder().encode(path);
  if (
    !bytes.some(
      (byte) => byte < 32 || byte >= 127 || byte === 34 || byte === 92,
    )
  )
    return path;

  let result = '"';
  const escapes: Record<number, string> = {
    7: "a",
    8: "b",
    9: "t",
    10: "n",
    11: "v",
    12: "f",
    13: "r",
    34: '"',
    92: "\\",
  };

  for (const byte of bytes) {
    if (escapes[byte]) result += `\\${escapes[byte]}`;
    else if (byte < 32 || byte >= 127)
      result += `\\${byte.toString(8).padStart(3, "0")}`;
    else result += String.fromCharCode(byte);
  }

  return `${result}"`;
}

/** Collect a consistent PR snapshot without checking out the repository. */
export async function collectPullRequest(
  url: string,
  run: GhRunner = runGh,
): Promise<CollectedPullRequest> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Expected a GitHub pull request URL");
  }

  const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/.exec(
    parsed.pathname,
  );
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !match
  ) {
    throw new Error(
      "Expected a GitHub.com pull request URL: https://github.com/OWNER/REPO/pull/NUMBER",
    );
  }

  const [, owner, repository, numberText] = match;
  const number = Number(numberText);
  if (!Number.isSafeInteger(number))
    throw new Error("Invalid pull request number");

  const endpoint = `repos/${owner}/${repository}/pulls/${number}`;
  const metadata = async () =>
    object(json(await run(["api", endpoint]), "PR metadata"), "PR metadata");

  const first = await metadata();
  const baseCommit = str(object(first.base, "base").sha, "base.sha");
  const headCommit = str(object(first.head, "head").sha, "head.sha");
  const fileCount = count(first.changed_files, "changed_files");
  if (fileCount > 3000)
    throw new Error(
      "GitHub's file list is limited to 3,000 files; cannot collect a complete PR",
    );

  const description = first.body === null ? "" : first.body;
  if (typeof description !== "string")
    throw new Error("body: expected a string or null");

  if (first.state !== "open" && first.state !== "closed")
    throw new Error("state: expected open or closed");

  for (const key of ["draft", "merged"]) {
    if (typeof first[key] !== "boolean")
      throw new Error(`${key}: expected a boolean`);
  }

  const pullRequest: CollectedPullRequest["pullRequest"] = {
    url: `https://github.com/${owner}/${repository}/pull/${number}`,
    owner,
    repository,
    number,
    title: str(first.title, "title"),
    description,
    author: str(object(first.user, "user").login, "user.login"),
    baseCommit,
    headCommit,
    status: first.merged
      ? "merged"
      : first.state === "closed"
        ? "closed"
        : first.draft
          ? "draft"
          : "open",
    commitCount: count(first.commits, "commits"),
    baseRefName: str(object(first.base, "base").ref, "base.ref"),
    headRefName: str(object(first.head, "head").ref, "head.ref"),
  };

  const entries: Obj[] = [];

  for (let page = 1; entries.length < fileCount; page++) {
    const value = json(
      await run(["api", `${endpoint}/files?per_page=100&page=${page}`]),
      "PR files",
    );
    if (!Array.isArray(value) || value.length === 0 || value.length > 100)
      throw new Error("Incomplete or invalid PR file list");

    entries.push(...value.map((entry) => object(entry, "PR file")));
  }

  if (entries.length !== fileCount)
    throw new Error("PR file count does not match metadata");

  const rawDiff = await run([
    "api",
    "-H",
    "Accept: application/vnd.github.v3.diff",
    endpoint,
  ]);
  const chunks =
    rawDiff.match(/^diff --git .*?(?=^diff --git |$(?![\s\S]))/gms) ?? [];
  if (chunks.join("") !== rawDiff || chunks.length !== entries.length)
    throw new Error(
      "Incomplete or unrecognized PR diff: file count does not match",
    );

  const seen = new Set<string>();
  const files = entries.map((entry, index): DiffFile => {
    const path = str(entry.filename, `files[${index}].filename`);
    if (seen.has(path)) throw new Error(`Duplicate file path: ${path}`);

    seen.add(path);

    const status = str(entry.status, `files[${index}].status`);
    if (!["added", "removed", "modified", "renamed"].includes(status))
      throw new Error(`Unsupported file status ${status} for ${path}`);

    const oldName =
      status === "renamed"
        ? str(entry.previous_filename, `files[${index}].previous_filename`)
        : path;
    const additions = count(entry.additions, `files[${index}].additions`);
    const deletions = count(entry.deletions, `files[${index}].deletions`);
    const chunk = chunks[index];
    const header = chunk.split("\n", 1)[0].replace(/\r$/, "");
    if (
      header !== `diff --git ${gitPath(`a/${oldName}`)} ${gitPath(`b/${path}`)}`
    )
      throw new Error(`Diff header does not match file ${path}`);

    const binary = /^Binary files .* differ\r?$/m.test(chunk);
    const file: DiffFile = {
      id: `file-${index + 1}`,
      oldPath: status === "added" ? null : oldName,
      newPath: status === "removed" ? null : path,
      status: status === "removed" ? "deleted" : (status as DiffFile["status"]),
      diff: binary ? { kind: "binary" } : { kind: "text", unified: chunk },
    };
    if (binary) {
      if (additions || deletions || /^@@ /m.test(chunk))
        throw new Error(`Inconsistent binary diff for ${path}`);
    } else {
      const diff = parseDiff(file);
      if (diff.kind !== "text")
        throw new Error(`Expected text diff for ${path}`);

      const lines = diff.hunks.flatMap((hunk) => hunk.lines);
      if (
        lines.filter((line) => line.kind === "addition").length !== additions ||
        lines.filter((line) => line.kind === "deletion").length !== deletions
      )
        throw new Error(
          `Incomplete diff for ${path}: changed line counts do not match`,
        );
    }

    return file;
  });

  const last = await metadata();
  if (
    str(object(last.base, "base").sha, "base.sha") !== baseCommit ||
    str(object(last.head, "head").sha, "head.sha") !== headCommit
  )
    throw new Error("PR base or head commit changed during collection; retry");

  return { pullRequest, files };
}
