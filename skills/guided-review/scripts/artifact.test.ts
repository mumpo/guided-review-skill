import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fixture from "../../../packages/core/fixtures/valid.json";
import {
  analyzeDiffs,
  type ReviewSnapshot,
  validateSnapshot,
} from "../../../packages/core/src/index";
import {
  buildArtifact,
  buildArtifactWithReport,
  verifyArtifact,
} from "./artifact";
import realPrFixture from "../fixtures/cli-pr-1.json";

const typedFixture = validateSnapshot(fixture);

const collection = {
  pullRequest: typedFixture.pullRequest,
  files: typedFixture.files,
};

const narrative = {
  summary: typedFixture.summary,
  sections: typedFixture.sections,
};

describe("artifact generation", () => {
  test("report preserves the final narrative and inspection limits without captured diff text", () => {
    const { snapshot, report } = buildArtifactWithReport(collection, narrative);

    expect(snapshot).toEqual(buildArtifact(collection, narrative));
    expect(report).toMatchObject({
      validation: {
        collectionPreserved: true,
        referencesValid: true,
        completeCoverage: true,
      },
      summary: snapshot.summary,
      sections: snapshot.sections.map(({ title, explanation, references }) => ({
        title,
        explanation,
        references,
      })),
      automaticallyUngrouped: [
        {
          kind: "lines",
          fileId: "guide",
          side: "old",
          startLine: 1,
          endLine: 1,
        },
      ],
    });
    expect(report.files).toEqual(
      snapshot.files.map(({ id, oldPath, newPath, status, diff }) => ({
        id,
        oldPath,
        newPath,
        status,
        diff:
          diff.kind === "unavailable"
            ? { kind: diff.kind, reason: diff.reason }
            : { kind: diff.kind },
      })),
    );
    expect(report.files.some((file) => file.diff.kind === "binary")).toBe(true);
    expect(report.files.some((file) => file.diff.kind === "unavailable")).toBe(
      true,
    );
    expect(report.files.every((file) => !("unified" in file.diff))).toBe(true);
    expect(JSON.stringify(report).length).toBeLessThan(
      JSON.stringify(snapshot).length,
    );
  });

  test("report distinguishes authored ungrouped references from automatically added ones", () => {
    const draft = {
      summary: "Grouping is uncertain.",
      sections: [
        {
          title: "Ungrouped changes",
          explanation: "Image intent is unknown.",
          references: [{ kind: "file", fileId: "image" }],
        },
      ],
    };
    const original = structuredClone(draft);
    const { snapshot, report } = buildArtifactWithReport(collection, draft);

    expect(report.automaticallyUngrouped).toEqual(
      snapshot.sections[0].references.slice(1),
    );
    expect(report.automaticallyUngrouped).not.toContainEqual({
      kind: "file",
      fileId: "image",
    });
    expect(draft).toEqual(original);

    const complete = buildArtifactWithReport(collection, {
      summary: snapshot.summary,
      sections: snapshot.sections,
    });

    expect(complete.report.automaticallyUngrouped).toEqual([]);
  });

  test("round-trips the real cli/cli#1 walkthrough with complete split-file coverage", () => {
    const expected = validateSnapshot(realPrFixture);
    const source = { pullRequest: expected.pullRequest, files: expected.files };
    const draft = { summary: expected.summary, sections: expected.sections };
    const result = buildArtifact(source, draft);

    expect(result).toEqual(expected);
    expect(result.sections).toHaveLength(2);
    expect(analyzeDiffs(result)).toMatchObject({
      invalidReferences: [],
      uncovered: [],
    });
  });

  test("coalesces contiguous fallback ranges across additions and deletions", () => {
    const source: Pick<ReviewSnapshot, "pullRequest" | "files"> = {
      ...collection,
      files: [
        {
          id: "replace",
          oldPath: "a",
          newPath: "a",
          status: "modified",
          diff: {
            kind: "text",
            unified:
              "@@ -1,2 +1,2 @@\n-one\n-two\n+three\n+four\n\\ No newline at end of file\n",
          },
        },
      ],
    };
    const result = buildArtifact(source, {
      summary: "Uncertain replacement.",
      sections: [],
    });

    expect(result.sections[0].references).toEqual([
      {
        kind: "lines",
        fileId: "replace",
        side: "old",
        startLine: 1,
        endLine: 2,
      },
      {
        kind: "lines",
        fileId: "replace",
        side: "new",
        startLine: 1,
        endLine: 2,
      },
    ]);
    expect(result.files).toEqual(source.files);
  });

  test("preserves source data, split-file/multi-file section ordering, and explanation fences", () => {
    const draft = structuredClone(narrative);
    draft.sections[0].explanation += "\n\n```mermaid\nflowchart LR\nA-->B\n```";

    const original = structuredClone(draft);
    const result = buildArtifact(collection, draft);

    expect(result.pullRequest).toEqual(collection.pullRequest);
    expect(result.files).toEqual(collection.files);
    expect(result.sections.slice(0, 3)).toEqual(draft.sections);
    expect(draft).toEqual(original);
    expect(result.sections.at(-1)).toMatchObject({
      title: "Ungrouped changes",
      references: [
        {
          kind: "lines",
          fileId: "guide",
          side: "old",
          startLine: 1,
          endLine: 1,
        },
      ],
    });
    expect(analyzeDiffs(result).uncovered).toEqual([]);
    expect(
      verifyArtifact(collection, JSON.parse(JSON.stringify(result))),
    ).toEqual(result);
  });

  test("adds exact missing old/new ranges and binary/unavailable/metadata markers", () => {
    const withMode = structuredClone(collection);

    withMode.files.push({
      id: "mode",
      oldPath: "run.sh",
      newPath: "run.sh",
      status: "modified",
      diff: {
        kind: "text",
        unified:
          "diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n",
      },
    });

    const result = buildArtifact(withMode, {
      summary: "Grouping is uncertain.",
      sections: [],
    });

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].title).toBe("Ungrouped changes");
    expect(result.sections[0].references).toEqual([
      {
        kind: "lines",
        fileId: "greeting",
        side: "old",
        startLine: 1,
        endLine: 1,
      },
      {
        kind: "lines",
        fileId: "greeting",
        side: "old",
        startLine: 10,
        endLine: 10,
      },
      {
        kind: "lines",
        fileId: "greeting",
        side: "new",
        startLine: 1,
        endLine: 1,
      },
      {
        kind: "lines",
        fileId: "greeting",
        side: "new",
        startLine: 10,
        endLine: 10,
      },
      { kind: "lines", fileId: "guide", side: "old", startLine: 1, endLine: 1 },
      { kind: "lines", fileId: "guide", side: "new", startLine: 1, endLine: 1 },
      { kind: "file", fileId: "image" },
      { kind: "file", fileId: "large" },
      { kind: "file", fileId: "mode" },
    ]);
  });

  test("extends an existing final ungrouped section without mutating the draft", () => {
    const draft = {
      summary: "Some changes are uncertain.",
      sections: [
        {
          title: "Ungrouped changes",
          explanation: "Image intent is unknown.",
          references: [{ kind: "file", fileId: "image" }],
        },
      ],
    };
    const result = buildArtifact(collection, draft);

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].explanation).toContain(
      "Image intent is unknown.",
    );
    expect(result.sections[0].references.length).toBeGreaterThan(1);
    expect(draft.sections[0].references).toHaveLength(1);
  });

  test("rejects context-only, unknown, and non-text references with useful locations", () => {
    const draft = () => structuredClone(narrative);

    const context = draft();
    context.sections[0].references = [
      {
        kind: "lines",
        fileId: "greeting",
        side: "new",
        startLine: 2,
        endLine: 2,
      },
    ];

    expect(() => buildArtifact(collection, context)).toThrow(
      "$.sections[0].references[0]: Range selects no changed new lines",
    );

    const unknown = draft();
    unknown.sections[0].references[0].fileId = "missing";

    expect(() => buildArtifact(collection, unknown)).toThrow("unknown file ID");

    context.sections[0].references[0].fileId = "image";

    expect(() => buildArtifact(collection, context)).toThrow(
      "Line reference requires a text diff",
    );
  });

  test("rejects malformed narratives, bad fallback ordering, and source field overrides", () => {
    expect(() =>
      buildArtifact(collection, { ...narrative, summary: " " }),
    ).toThrow("$.summary");
    expect(() =>
      buildArtifact(collection, { ...narrative, files: [] }),
    ).toThrow("narrative.files");

    const blank = structuredClone(narrative);
    blank.sections[0].explanation = "";

    expect(() => buildArtifact(collection, blank)).toThrow(
      "$.sections[0].explanation",
    );

    blank.sections[0].explanation = "A change.";
    blank.sections[0].references = [];

    expect(() => buildArtifact(collection, blank)).toThrow(
      "expected actual changes",
    );

    blank.sections[0].title = "Ungrouped changes";
    blank.sections[0].references = narrative.sections[0].references;

    expect(() => buildArtifact(collection, blank)).toThrow(
      "Ungrouped changes must be last",
    );
  });

  test("offline validation detects source tampering and missing coverage", () => {
    const result = buildArtifact(collection, narrative);

    for (const mutate of [
      (value: ReviewSnapshot) => {
        value.pullRequest.headCommit = "different";
      },
      (value: ReviewSnapshot) => {
        value.files.pop();
      },
      (value: ReviewSnapshot) => {
        value.files[0].diff = { kind: "unavailable", reason: "omitted" };
      },
    ]) {
      const altered = structuredClone(result);
      // Removing sections keeps the tamper check independent of invalid file references.
      altered.sections = [];
      mutate(altered);

      expect(() => verifyArtifact(collection, altered)).toThrow(
        "differ from collection",
      );
    }

    result.sections.pop();

    expect(() => verifyArtifact(collection, result)).toThrow(
      "Uncovered changes in guide",
    );
  });

  test("CLI builds and validates offline, reports failures, and protects existing files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "guided-review-"));
    const source = join(directory, "collection.json");
    const draft = join(directory, "narrative.json");
    const output = join(directory, "artifact.json");
    const cli = async (...args: string[]) => {
      const process = Bun.spawn(
        [processExecPath, join(import.meta.dir, "artifact.ts"), ...args],
        { stdout: "pipe", stderr: "pipe", cwd: directory },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
      ]);

      return { stdout, stderr, code };
    };

    const processExecPath = process.execPath;

    try {
      await writeFile(source, JSON.stringify(collection));
      await writeFile(draft, JSON.stringify(narrative));

      expect((await cli("build", source, draft, output)).code).toBe(0);

      const reportOutput = join(directory, "reported.json");
      const built = await cli("build", source, draft, reportOutput, "--report");

      expect(built).toMatchObject({ code: 0, stderr: "" });

      const report = JSON.parse(built.stdout);
      const written = await Bun.file(reportOutput).json();

      expect(written).toEqual(await Bun.file(output).json());
      expect(report).toMatchObject({
        artifactPath: reportOutput,
        summary: written.summary,
        sections: written.sections.map(
          ({
            title,
            explanation,
            references,
          }: ReviewSnapshot["sections"][number]) => ({
            title,
            explanation,
            references,
          }),
        ),
        automaticallyUngrouped: written.sections.at(-1).references,
      });

      const validated = await cli("validate", source, reportOutput, "--report");

      expect(validated).toMatchObject({ code: 0, stderr: "" });

      const { automaticallyUngrouped: _added, ...expectedReport } = report;

      expect(JSON.parse(validated.stdout)).toEqual(expectedReport);

      written.pullRequest.headCommit = "tampered";
      await writeFile(reportOutput, JSON.stringify(written));

      expect(
        await cli("validate", source, reportOutput, "--report"),
      ).toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining("differ from collection"),
      });
      expect(await cli("validate", source, output)).toMatchObject({
        code: 0,
        stderr: "",
      });
      expect(await cli("build", source, draft, output)).toMatchObject({
        code: 1,
        stderr: expect.stringContaining("EEXIST"),
      });
      expect(
        await cli("build", source, draft, output, "--report"),
      ).toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining("EEXIST"),
      });
      expect((await cli("validate", source, output, "extra")).stderr).toContain(
        "Usage:",
      );

      await writeFile(draft, "{");

      const invalid = await cli(
        "build",
        source,
        draft,
        join(directory, "bad.json"),
      );

      expect(invalid.code).toBe(1);
      expect(invalid.stderr).toContain(draft);
      expect(await Bun.file(join(directory, "bad.json")).exists()).toBe(false);
      expect(
        (await cli("validate", source, join(directory, "missing.json"))).stderr,
      ).toContain("missing.json");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
