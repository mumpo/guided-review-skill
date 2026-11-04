/** A portable, self-contained review of a single pull request. */
export interface ReviewSnapshot {
  version: 1;
  pullRequest: {
    url: string;
    owner: string;
    repository: string;
    number: number;
    title: string;
    description: string;
    author: string;
    baseCommit: string;
    headCommit: string;
  };
  summary: string;
  files: DiffFile[];
  sections: ReviewSection[];
}

export interface DiffFile {
  id: string;
  oldPath: string | null;
  newPath: string | null;
  status: "added" | "modified" | "deleted" | "renamed";
  diff:
    | { kind: "text"; unified: string }
    | { kind: "binary" }
    | { kind: "unavailable"; reason: string };
}

export interface ReviewSection {
  title: string;
  explanation: string;
  diagram?: string;
  references: ChangeReference[];
}

export type ChangeReference = FileReference | LineReference;

export interface FileReference {
  kind: "file";
  fileId: string;
}

export interface LineReference {
  kind: "lines";
  fileId: string;
  side: "old" | "new";
  startLine: number;
  endLine: number;
}

export class SnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotValidationError";
  }
}

type ObjectValue = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new SnapshotValidationError(`${path}: ${message}`);
}

function object(value: unknown, path: string): ObjectValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "expected an object");
  }
  return value as ObjectValue;
}

function string(value: unknown, path: string, nonempty = false): string {
  if (typeof value !== "string" || (nonempty && value.trim().length === 0)) {
    return fail(
      path,
      nonempty ? "expected a non-empty string" : "expected a string",
    );
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return fail(path, "expected a positive safe integer");
  }
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) return fail(path, "expected an array");
  return value;
}

function choice(
  value: unknown,
  choices: readonly string[],
  path: string,
): string {
  if (typeof value !== "string" || !choices.includes(value)) {
    return fail(path, `expected one of: ${choices.join(", ")}`);
  }
  return value;
}

/** Validate an already-parsed value. Throws SnapshotValidationError on failure. */
export function validateSnapshot(value: unknown): ReviewSnapshot {
  const root = object(value, "$");
  if (root.version !== 1) fail("$.version", "unsupported version; expected 1");
  const pr = object(root.pullRequest, "$.pullRequest");
  for (const key of [
    "url",
    "owner",
    "repository",
    "title",
    "author",
    "baseCommit",
    "headCommit",
  ]) {
    string(pr[key], `$.pullRequest.${key}`, true);
  }
  string(pr.description, "$.pullRequest.description");
  positiveInteger(pr.number, "$.pullRequest.number");
  string(root.summary, "$.summary");

  const ids = new Set<string>();
  array(root.files, "$.files").forEach((entry, index) => {
    const path = `$.files[${index}]`;
    const file = object(entry, path);
    const id = string(file.id, `${path}.id`, true);
    if (ids.has(id))
      fail(`${path}.id`, `duplicate file ID ${JSON.stringify(id)}`);
    ids.add(id);
    for (const key of ["oldPath", "newPath"]) {
      if (file[key] !== null) string(file[key], `${path}.${key}`, true);
    }
    const status = choice(
      file.status,
      ["added", "modified", "deleted", "renamed"],
      `${path}.status`,
    );
    if (status === "added" && (file.oldPath !== null || file.newPath === null))
      fail(path, "added files require only newPath");
    if (
      status === "deleted" &&
      (file.oldPath === null || file.newPath !== null)
    )
      fail(path, "deleted files require only oldPath");
    if (
      (status === "modified" || status === "renamed") &&
      (file.oldPath === null || file.newPath === null)
    )
      fail(path, `${status} files require both paths`);
    const diff = object(file.diff, `${path}.diff`);
    const kind = choice(
      diff.kind,
      ["text", "binary", "unavailable"],
      `${path}.diff.kind`,
    );
    if (kind === "text") string(diff.unified, `${path}.diff.unified`, true);
    if (kind === "unavailable")
      string(diff.reason, `${path}.diff.reason`, true);
  });

  array(root.sections, "$.sections").forEach((entry, index) => {
    const path = `$.sections[${index}]`;
    const section = object(entry, path);
    string(section.title, `${path}.title`, true);
    string(section.explanation, `${path}.explanation`);
    if (section.diagram !== undefined)
      string(section.diagram, `${path}.diagram`);
    array(section.references, `${path}.references`).forEach(
      (entry, referenceIndex) => {
        const refPath = `${path}.references[${referenceIndex}]`;
        const ref = object(entry, refPath);
        const id = string(ref.fileId, `${refPath}.fileId`, true);
        if (!ids.has(id))
          fail(`${refPath}.fileId`, `unknown file ID ${JSON.stringify(id)}`);
        const kind = choice(ref.kind, ["file", "lines"], `${refPath}.kind`);
        if (kind === "file") return;
        choice(ref.side, ["old", "new"], `${refPath}.side`);
        const start = positiveInteger(ref.startLine, `${refPath}.startLine`);
        const end = positiveInteger(ref.endLine, `${refPath}.endLine`);
        if (end < start)
          fail(
            `${refPath}.endLine`,
            "must be greater than or equal to startLine",
          );
      },
    );
  });
  return value as ReviewSnapshot;
}

/** Parse and validate a snapshot from JSON. */
export function parseSnapshot(json: string): ReviewSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new SnapshotValidationError(
      `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return validateSnapshot(value);
}

export * from "./diff";
