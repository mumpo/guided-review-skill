import { isDeepStrictEqual } from "node:util";
import {
  analyzeDiffs,
  type ChangeReference,
  type DiffAnalysis,
  type ReviewSnapshot,
  validateSnapshot,
} from "../../../packages/core/src/index";

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label}: expected an object`);
  return value as Record<string, unknown>;
}

function collectionSnapshot(value: unknown): ReviewSnapshot {
  const collection = object(value, "collection");
  return validateSnapshot({
    version: 1,
    pullRequest: collection.pullRequest,
    files: collection.files,
    summary: "",
    sections: [],
  });
}

function checkNarrative(snapshot: ReviewSnapshot) {
  if (!snapshot.summary.trim())
    throw new Error("$.summary: expected non-empty Markdown");
  snapshot.sections.forEach((section, index) => {
    if (!section.explanation.trim())
      throw new Error(
        `$.sections[${index}].explanation: expected non-empty Markdown`,
      );
    if (!section.references.length)
      throw new Error(
        `$.sections[${index}].references: expected actual changes`,
      );
    if (
      section.title === "Ungrouped changes" &&
      index !== snapshot.sections.length - 1
    )
      throw new Error(`$.sections[${index}]: Ungrouped changes must be last`);
  });
}

function checkReferences(analysis: DiffAnalysis) {
  if (analysis.invalidReferences.length)
    throw new Error(
      analysis.invalidReferences
        .map(
          (issue) =>
            `$.sections[${issue.sectionIndex}].references[${issue.referenceIndex}]: ${issue.message}`,
        )
        .join("\n"),
    );
}

/** Verify the finished artifact against the original collection, entirely offline. */
export function verifyArtifact(
  collection: unknown,
  value: unknown,
): ReviewSnapshot {
  const original = collectionSnapshot(collection);
  const snapshot = validateSnapshot(value);
  if (
    !isDeepStrictEqual(snapshot.pullRequest, original.pullRequest) ||
    !isDeepStrictEqual(snapshot.files, original.files)
  )
    throw new Error(
      "Artifact metadata or files differ from collection; rebuild from the original collection",
    );
  checkNarrative(snapshot);
  const analysis = analyzeDiffs(snapshot);
  checkReferences(analysis);
  if (analysis.uncovered.length)
    throw new Error(
      `Uncovered changes in ${analysis.uncovered.map((file) => file.fileId).join(", ")}; rebuild to include Ungrouped changes`,
    );
  return snapshot;
}

/** Compose model-written narrative with untouched collected data and explicit fallback coverage. */
export function buildArtifact(
  collection: unknown,
  value: unknown,
): ReviewSnapshot {
  const original = collectionSnapshot(collection);
  const draft = object(value, "narrative");
  for (const key of Object.keys(draft)) {
    if (key !== "summary" && key !== "sections")
      throw new Error(
        `narrative.${key}: only summary and sections are allowed`,
      );
  }
  const snapshot = structuredClone(
    validateSnapshot({
      ...original,
      ...draft,
      summary: draft.summary,
      sections: draft.sections,
    }),
  );
  checkNarrative(snapshot);
  const analysis = analyzeDiffs(snapshot);
  checkReferences(analysis);
  const references: ChangeReference[] = [];
  for (const file of analysis.uncovered) {
    if (!file.lines.length) {
      references.push({ kind: "file", fileId: file.fileId });
      continue;
    }
    for (const side of ["old", "new"] as const) {
      let range: Extract<ChangeReference, { kind: "lines" }> | undefined;
      for (const line of file.lines) {
        const number = side === "old" ? line.oldLine : line.newLine;
        if (number === null) continue;
        if (range && number === range.endLine + 1) range.endLine = number;
        else {
          range = {
            kind: "lines",
            fileId: file.fileId,
            side,
            startLine: number,
            endLine: number,
          };
          references.push(range);
        }
      }
    }
  }
  if (references.length) {
    let ungrouped = snapshot.sections.at(-1);
    const explanation =
      "These captured changes were not assigned to a confident narrative group. Inspect them separately; binary or unavailable markers do not expose their underlying content.";
    if (ungrouped?.title !== "Ungrouped changes") {
      ungrouped = { title: "Ungrouped changes", explanation, references: [] };
      snapshot.sections.push(ungrouped);
    } else {
      ungrouped.explanation += `\n\n${explanation}`;
    }
    ungrouped.references.push(...references);
  }
  return verifyArtifact(collection, snapshot);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await Bun.file(path).text());
  } catch (error) {
    throw new Error(
      `${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (import.meta.main) {
  try {
    const [command, collectionPath, inputPath, outputPath, ...extra] =
      process.argv.slice(2);
    if (
      !collectionPath ||
      !inputPath ||
      extra.length ||
      (command !== "build" && command !== "validate") ||
      (command === "build" ? !outputPath : outputPath !== undefined)
    )
      throw new Error(
        "Usage: bun run artifact.ts build <collection.json> <narrative.json> <output.json> | validate <collection.json> <artifact.json>",
      );
    const collection = await readJson(collectionPath);
    const input = await readJson(inputPath);
    const snapshot =
      command === "build"
        ? buildArtifact(collection, input)
        : verifyArtifact(collection, input);
    if (command === "build") {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
        flag: "wx",
      });
    }
    console.log(
      `Artifact ${command === "build" ? "built" : "valid"}: ${snapshot.files.length} files, ${snapshot.sections.length} ordered sections; full captured-change coverage`,
    );
  } catch (error) {
    console.error(
      `Artifact failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
