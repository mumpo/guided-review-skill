import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewSnapshot } from "../../../packages/core/src";
import { loadReview } from "./load";

const fixture = new URL(
  "../../../packages/core/fixtures/valid.json",
  import.meta.url,
).pathname;

const temp = await mkdtemp(join(tmpdir(), "guided-review-tui-"));

afterAll(() => rm(temp, { recursive: true, force: true }));

test("loads the generated real PR example offline", async () => {
  const { snapshot, analysis } = await loadReview(
    new URL(
      "../../../skills/guided-review/fixtures/cli-pr-1.json",
      import.meta.url,
    ).pathname,
  );

  expect(snapshot.pullRequest.number).toBe(1);
  expect(snapshot.sections).toHaveLength(2);
  expect(analysis.invalidReferences).toEqual([]);
  expect(analysis.uncovered).toEqual([]);
});

test("reports missing files and malformed JSON with the input path", async () => {
  await expect(loadReview(join(temp, "missing.json"))).rejects.toThrow(
    /Cannot read artifact .*missing.json.*ENOENT/,
  );

  const path = join(temp, "malformed.json");

  await writeFile(path, "{");

  await expect(loadReview(path)).rejects.toThrow(
    /Invalid artifact .*malformed.json.*Invalid JSON/,
  );
});

test("rejects unsupported versions, invalid references, and malformed diffs", async () => {
  const original = (await loadReview(fixture)).snapshot;
  const cases: [string, (value: ReviewSnapshot) => unknown, RegExp][] = [
    ["version", (value) => Object.assign(value, { version: 2 }), /\$\.version/],
    [
      "reference",
      (value) => {
        value.sections[0].references = [
          {
            kind: "lines",
            fileId: "greeting",
            side: "new",
            startLine: 99,
            endLine: 99,
          },
        ];
      },
      /\$\.sections\[0\]\.references\[0\]/,
    ],
    [
      "diff",
      (value) => {
        value.files[0].diff = { kind: "text", unified: "@@ -1 +1 @@\n-old\n" };
      },
      /greeting/,
    ],
  ];

  for (const [name, mutate, message] of cases) {
    const snapshot = structuredClone(original);

    mutate(snapshot);

    const path = join(temp, `${name}.json`);

    await writeFile(path, JSON.stringify(snapshot));

    await expect(loadReview(path)).rejects.toThrow(message);
  }
});

test("CLI reports usage, invalid files, and noninteractive startup failures", async () => {
  async function run(
    args: string[],
    script = join(import.meta.dir, "index.ts"),
  ) {
    const child = Bun.spawn([process.execPath, script, ...args], {
      cwd: new URL("../../../", import.meta.url).pathname,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        XDG_CONFIG_HOME: temp,
        GUIDED_REVIEW_THEME: undefined,
      },
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    return { code, stdout, stderr };
  }

  expect(await run(["--help"])).toMatchObject({ code: 0, stderr: "" });
  expect(await run(["--theme=invalid", fixture])).toMatchObject({
    code: 1,
    stderr: expect.stringContaining(
      "--theme: expected auto, github-light, or github-dark",
    ),
  });

  for (const theme of ["auto", "github-light", "github-dark"]) {
    expect(await run(["--theme", theme, fixture])).toMatchObject({
      code: 1,
      stderr: expect.stringContaining("interactive terminal (TTY)"),
    });
  }

  expect(await run([])).toMatchObject({
    code: 1,
    stderr: expect.stringContaining("Usage:"),
  });
  expect(await run([join(temp, "missing.json")])).toMatchObject({
    code: 1,
    stderr: expect.stringContaining("Cannot read artifact"),
  });
  expect(await run([fixture])).toMatchObject({
    code: 1,
    stderr: expect.stringContaining("interactive terminal (TTY)"),
  });
  // The public launcher must preserve relative artifact paths from the caller.
  expect(
    await run(["dev:tui", "packages/core/fixtures/valid.json"], "run"),
  ).toMatchObject({
    code: 1,
    stderr: expect.stringContaining("interactive terminal (TTY)"),
  });
});
