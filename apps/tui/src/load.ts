import { readFile } from "node:fs/promises";
import {
  analyzeDiffs,
  type DiffAnalysis,
  parseSnapshot,
  type ReviewSnapshot,
} from "../../../packages/core/src";

export interface LoadedReview {
  snapshot: ReviewSnapshot;
  analysis: DiffAnalysis;
}

/** Only local file access; viewing never fetches or executes artifact content. */
export async function loadReview(path: string): Promise<LoadedReview> {
  let json: string;
  try {
    json = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot read artifact ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    const snapshot = parseSnapshot(json);
    const analysis = analyzeDiffs(snapshot);
    if (analysis.invalidReferences.length > 0) {
      throw new Error(
        analysis.invalidReferences
          .map(
            ({ sectionIndex, referenceIndex, message }) =>
              `$.sections[${sectionIndex}].references[${referenceIndex}]: ${message}`,
          )
          .join("\n"),
      );
    }
    return { snapshot, analysis };
  } catch (error) {
    throw new Error(
      `Invalid artifact ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
