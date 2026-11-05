import { describe, expect, test } from "bun:test";
import { collectPullRequest, type GhRunner } from "./index";

const url = "https://github.com/example/project/pull/12";

const metadata = {
  title: "A PR",
  body: null,
  user: { login: "author" },
  base: { sha: "base" },
  head: { sha: "head" },
  changed_files: 3,
};

const entries = [
  { filename: "new.txt", status: "added", additions: 1, deletions: 0 },
  {
    filename: "new name.txt",
    previous_filename: "old name.txt",
    status: "renamed",
    additions: 0,
    deletions: 1,
  },
  { filename: "image.png", status: "modified", additions: 0, deletions: 0 },
];

const diff =
  "diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+hello\n" +
  "diff --git a/old name.txt b/new name.txt\nsimilarity index 50%\nrename from old name.txt\nrename to new name.txt\n--- a/old name.txt\n+++ b/new name.txt\n@@ -1 +0,0 @@\n-goodbye\n" +
  "diff --git a/image.png b/image.png\nindex 123..456 100644\nBinary files a/image.png and b/image.png differ\n";

function runner(
  options: {
    first?: unknown;
    last?: unknown;
    files?: unknown;
    diff?: string;
  } = {},
): GhRunner {
  let metadataCalls = 0;

  return async (args) => {
    if (args.includes("-H")) return options.diff ?? diff;
    if (args[1].includes("/files?"))
      return JSON.stringify(options.files ?? entries);

    return JSON.stringify(
      metadataCalls++ === 0
        ? (options.first ?? metadata)
        : (options.last ?? metadata),
    );
  };
}

describe("collectPullRequest", () => {
  test("collects metadata, text, rename, and binary without losing text", async () => {
    const result = await collectPullRequest(url, runner());

    expect(result.pullRequest).toMatchObject({
      number: 12,
      description: "",
      baseCommit: "base",
      headCommit: "head",
    });
    expect(result.files.map((file) => file.status)).toEqual([
      "added",
      "renamed",
      "modified",
    ]);
    expect(result.files[1]).toMatchObject({
      oldPath: "old name.txt",
      newPath: "new name.txt",
    });
    expect(result.files[0].diff).toEqual({
      kind: "text",
      unified: diff.slice(0, diff.indexOf("diff --git a/old")),
    });
    expect(result.files[2].diff).toEqual({ kind: "binary" });
  });

  test("requests all pages of file data", async () => {
    const many = Array.from({ length: 101 }, (_, i) => ({
      filename: `f${i}`,
      status: "modified",
      additions: 0,
      deletions: 0,
    }));
    const manyDiff = many
      .map(
        ({ filename }) =>
          `diff --git a/${filename} b/${filename}\nold mode 100644\nnew mode 100755\n`,
      )
      .join("");
    const calls: string[] = [];
    const run: GhRunner = async (args) => {
      if (args.includes("-H")) return manyDiff;
      if (args[1].includes("/files?")) {
        calls.push(args[1]);

        return JSON.stringify(
          args[1].endsWith("page=1") ? many.slice(0, 100) : many.slice(100),
        );
      }

      return JSON.stringify({ ...metadata, changed_files: 101 });
    };

    expect((await collectPullRequest(url, run)).files).toHaveLength(101);
    expect(calls).toHaveLength(2);
  });

  test("reports access errors", async () => {
    await expect(
      collectPullRequest(url, async () => {
        throw new Error("gh failed: HTTP 401 authentication required");
      }),
    ).rejects.toThrow("authentication");
  });

  test("rejects incomplete data, diff, unsupported statuses, and changed commits", async () => {
    await expect(
      collectPullRequest(url, runner({ first: { ...metadata, title: null } })),
    ).rejects.toThrow("title");
    await expect(
      collectPullRequest(url, runner({ files: [] })),
    ).rejects.toThrow("file list");
    await expect(
      collectPullRequest(
        url,
        runner({ diff: diff.slice(0, diff.indexOf("diff --git a/image")) }),
      ),
    ).rejects.toThrow("file count");
    await expect(
      collectPullRequest(url, runner({ diff: diff.replace("+hello\n", "") })),
    ).rejects.toThrow("truncated hunk");
    await expect(
      collectPullRequest(
        url,
        runner({
          files: [{ ...entries[0], status: "copied" }, ...entries.slice(1)],
        }),
      ),
    ).rejects.toThrow("Unsupported file status");
    await expect(
      collectPullRequest(
        url,
        runner({ last: { ...metadata, head: { sha: "changed" } } }),
      ),
    ).rejects.toThrow("changed during collection");
    await expect(
      collectPullRequest(
        url,
        runner({ last: { ...metadata, base: { sha: "changed" } } }),
      ),
    ).rejects.toThrow("changed during collection");
  });

  test("rejects mismatched file headers and changed line counts", async () => {
    await expect(
      collectPullRequest(
        url,
        runner({ diff: diff.replace("a/new.txt", "a/wrong.txt") }),
      ),
    ).rejects.toThrow("header does not match");
    await expect(
      collectPullRequest(
        url,
        runner({
          files: [{ ...entries[0], additions: 2 }, ...entries.slice(1)],
        }),
      ),
    ).rejects.toThrow("changed line counts");
  });

  test("rejects non-PR and non-GitHub URLs", async () => {
    await expect(
      collectPullRequest(
        "https://github.com/example/project/issues/1",
        runner(),
      ),
    ).rejects.toThrow("pull request URL");
    await expect(
      collectPullRequest(
        "https://other.example/example/project/pull/1",
        runner(),
      ),
    ).rejects.toThrow("pull request URL");
  });
});
