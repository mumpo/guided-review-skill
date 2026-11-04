# Guided Review

Guided Review will help people review GitHub pull requests through an ordered, Claude-generated walkthrough of the actual changes. A shared review artifact will support a terminal viewer and a GitHub-inspired web viewer without requiring a checkout of the PR repository.

The shared artifact contract, GitHub collection helper, and Claude Code generation skill are implemented; the viewers are still planned. See [PLAN.md](PLAN.md) for the sequential implementation tasks.

## Generate a guided review

Keep a full clone of this repository and install its dependencies with `bun install`. Install Bun, Claude Code, and an authenticated GitHub CLI. From the repository root, link the skill into Claude Code's personal skills directory:

```sh
mkdir -p ~/.claude/skills
ln -s "$PWD/skills/guided-review" ~/.claude/skills/guided-review
```

Keep the clone at that location: the skill's helpers use the shared core and collector in the repository. Copying just the skill folder will not work. If `guided-review` already exists in your skills directory, choose which installation to keep before linking. Claude Code's [skill documentation](https://code.claude.com/docs/en/skills) describes discovery and invocation.

In Claude Code, run:

```text
/guided-review https://github.com/OWNER/REPO/pull/NUMBER /absolute/path/review.json
```

The output path is optional; the default is `review-OWNER-REPO-NUMBER.json` in your working directory. Claude collects the real diff, writes a summary and ordered narrative sections, then builds and validates the artifact. The workflow does not execute PR code or submit reviews. Important behavior and review questions come first; related changes can span files or cover separate parts of one file. Changes that cannot be confidently grouped appear in a final `Ungrouped changes` section. Binary and unavailable markers explicitly retain inspection limits. The resulting artifact needs no GitHub access to read.

The [skill instructions](skills/guided-review/SKILL.md) and [generation reference](skills/guided-review/references/generation.md) define the workflow. The helper takes the collector's JSON and a separate narrative JSON containing only `summary` and `sections`:

```sh
bun run skills/guided-review/scripts/artifact.ts build collection.json narrative.json review.json
bun run skills/guided-review/scripts/artifact.ts validate collection.json review.json
```

Building preserves collected metadata and diff text, rejects invalid references, and adds uncovered changes to `Ungrouped changes`. Validation compares the finished artifact with the original collection and checks every reference and captured change. Both commands work offline. They exit nonzero with actionable errors for malformed inputs, changed source data, or invalid references; building refuses to overwrite an existing output. Use a new output path for a revision. Section priority and narrative accuracy still require human/model inspection; validation establishes structural validity and coverage.

A generated example for `cli/cli#1` is in [skills/guided-review/fixtures/cli-pr-1.json](skills/guided-review/fixtures/cli-pr-1.json), with selection/action behavior ordered before command wiring and both parts of the file covered.

## Collect a pull request

Install Bun and the [GitHub CLI](https://cli.github.com/), and authenticate with `gh auth login` using an account that can access the PR. Run:

```sh
bun run collect https://github.com/OWNER/REPO/pull/NUMBER > collection.json
```

No checkout is needed. The command writes JSON containing `pullRequest` metadata and `files` to standard output. This is intermediate input for creating an artifact: it does not include a summary or review sections. Errors go to standard error and produce a nonzero exit status. The collector checks the file list, diff and changed-line counts for completeness, and verifies that the base and head commits remain unchanged during collection. Retry if the commits change. GitHub's 3,000-file API limit and unsupported file statuses prevent collection rather than silently omitting changes. Only GitHub.com PR URLs are supported.

## Review artifact (version 1)

A review artifact is a UTF-8 JSON document. The complete example is in [packages/core/fixtures/valid.json](packages/core/fixtures/valid.json). It contains:

- `version`: the number `1`. Other versions are rejected.
- `pullRequest`: URL, owner, repository, positive PR number, title, description, author, and the captured `baseCommit` and `headCommit` IDs.
- `summary`: Markdown overview; `sections` is an ordered array of titles, Markdown explanations, optional text `diagram`s, and references.
- `files`: the captured changes, each with a unique artifact-local `id`, `oldPath`, `newPath`, status (`added`, `modified`, `deleted`, or `renamed`), and `diff`. An added file has a null old path, a deleted file has a null new path, and modified or renamed files have both paths.
- `diff` is `{ "kind": "text", "unified": "..." }` for captured unified diff text, `{ "kind": "binary" }` for binary content, or `{ "kind": "unavailable", "reason": "..." }` when the diff could not be obtained. Text is preserved as supplied; producers must retain all available changes.
- References use the file's `id`. A `{ "kind": "lines", "fileId": "...", "side": "old" | "new", "startLine": 1, "endLine": 2 }` reference selects an inclusive, one-based range on that side of the diff. A `{ "kind": "file", "fileId": "..." }` reference identifies a whole file, including a binary or unavailable diff. Sections may reference several files, and a file may appear in several sections.

Import `parseSnapshot(json)` to parse and validate a JSON string, or `validateSnapshot(value)` to validate an already-parsed value; both return a `ReviewSnapshot` and throw `SnapshotValidationError` with a field path on invalid input. Validation checks the structure, IDs, and range syntax, but does not parse diffs, verify that ranges identify changed lines, or assess coverage. Those checks belong to diff processing. Unknown fields are retained and ignored by version 1 validation; a future incompatible contract must use a new version.

## Diff processing

`parseDiff(file)` parses a file's unified diff into headers, hunks, and lines with old and new line numbers. Raw strings retain their original line endings, including no-newline markers. Binary and unavailable files retain their explicit markers. Malformed, truncated, multi-file, and unsupported text raises `DiffParseError` with the file ID. The parser accepts hunk-only and standard single-file Git unified diffs, including metadata-only changes.

`analyzeDiffs(snapshot)` parses every file, resolves each section's references, and returns `files`, ordered `sections`, `invalidReferences`, and `uncovered`. Validate the snapshot first. Whole-file references select all hunks or the binary/unavailable marker. A line reference selects additions on the new side or deletions on the old side within its inclusive range; context-only or non-text references are invalid. Selected hunks retain their original headers but contain only selected lines and their no-newline markers, so their original counts may exceed the selected content. The parsed file retains the full context.

Coverage counts each addition and deletion independently, even when they replace one another. Overlapping references are allowed. Unreferenced binary, unavailable, and metadata-only files appear in `uncovered` with an empty line list; an unavailable marker does not imply its unknown contents were inspected. A whole-file reference covers the available content or marker.

## Workspace

- `packages/core`: shared, runtime-independent review model and diff logic.
- `packages/collector`: local GitHub CLI collection helper.
- `apps/tui`: terminal viewer, planned with OpenTUI.
- `apps/web`: browser viewer, planned with React and shadcn/ui.
- `skills/guided-review`: Claude Code generation skill, offline build/validation helper, and a real-PR example.

## Development

Install [Bun](https://bun.sh/) 1.3.14 or later, then run `bun install`. Generation also requires Claude Code and an authenticated GitHub CLI (`gh`).

| Command | Purpose |
| --- | --- |
| `bun run dev` or `bun run dev:tui` | TUI development placeholder. |
| `bun run dev:web` | Web development placeholder. |
| `bun run test` | Run the test suite. |
| `bun run lint` | Check code with Biome. |
| `bun run format:check` | Check formatting with Biome. |
| `bun run format` | Apply Biome formatting. |
| `bun run typecheck` | Type-check the workspace. |

The development commands currently print a placeholder message and exit; they do not start a viewer or server.

Pull requests run the test suite, lint, formatting, and type checks in GitHub Actions.
