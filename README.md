# Guided Review

Guided Review will help people review GitHub pull requests through an ordered, Claude-generated walkthrough of the actual changes. A shared review artifact will support a terminal viewer and a GitHub-inspired web viewer without requiring a checkout of the PR repository.

The shared artifact contract is implemented; generation and the viewers are still planned. See [PLAN.md](PLAN.md) for the sequential implementation tasks.

## Review artifact (version 1)

A review artifact is a UTF-8 JSON document. The complete example is in [packages/core/fixtures/valid.json](packages/core/fixtures/valid.json). It contains:

- `version`: the number `1`. Other versions are rejected.
- `pullRequest`: URL, owner, repository, positive PR number, title, description, author, and the captured `baseCommit` and `headCommit` IDs.
- `summary`: Markdown overview; `sections` is an ordered array of titles, Markdown explanations, optional text `diagram`s, and references.
- `files`: the captured changes, each with a unique artifact-local `id`, `oldPath`, `newPath`, status (`added`, `modified`, `deleted`, or `renamed`), and `diff`. An added file has a null old path, a deleted file has a null new path, and modified or renamed files have both paths.
- `diff` is `{ "kind": "text", "unified": "..." }` for captured unified diff text, `{ "kind": "binary" }` for binary content, or `{ "kind": "unavailable", "reason": "..." }` when the diff could not be obtained. Text is preserved as supplied; producers must retain all available changes.
- References use the file's `id`. A `{ "kind": "lines", "fileId": "...", "side": "old" | "new", "startLine": 1, "endLine": 2 }` reference selects an inclusive, one-based range on that side of the diff. A `{ "kind": "file", "fileId": "..." }` reference identifies a whole file, including a binary or unavailable diff. Sections may reference several files, and a file may appear in several sections.

Import `parseSnapshot(json)` to parse and validate a JSON string, or `validateSnapshot(value)` to validate an already-parsed value; both return a `ReviewSnapshot` and throw `SnapshotValidationError` with a field path on invalid input. Validation checks the structure, IDs, and range syntax, but does not parse diffs, verify that ranges identify changed lines, or assess coverage. Those checks belong to diff processing. Unknown fields are retained and ignored by version 1 validation; a future incompatible contract must use a new version.

## Workspace

- `packages/core`: shared, runtime-independent review model and diff logic.
- `apps/tui`: terminal viewer, planned with OpenTUI.
- `apps/web`: browser viewer, planned with React and shadcn/ui.
- `skills/guided-review`: Claude Code skill placeholder.

## Development

Install [Bun](https://bun.sh/) 1.3.14 or later, then run `bun install`. The future generation workflow will also require Claude Code and an authenticated GitHub CLI (`gh`).

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
