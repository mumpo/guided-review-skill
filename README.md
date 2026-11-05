# Guided Review

Guided Review will help people review GitHub pull requests through an ordered, agent-generated walkthrough of the actual changes. A shared review artifact will support a terminal viewer and a GitHub-inspired web viewer without requiring a checkout of the PR repository.

The shared artifact contract, GitHub collection helper, generation skill for Codex and Claude Code, and terminal diff viewer are implemented. The web viewer is still planned. See [PLAN.md](PLAN.md) for the sequential implementation tasks.

## Generate a guided review

Keep a full clone of this repository and install its dependencies with `bun install`. Install Bun, Codex or Claude Code, and an authenticated GitHub CLI. When working in this repository, both agents discover the same skill through checked-in links:

| Agent | Discovery path | Invocation |
| --- | --- | --- |
| Codex | `.agents/skills/guided-review` | `$guided-review https://github.com/OWNER/REPO/pull/NUMBER /absolute/path/review.json` |
| Claude Code | `.claude/skills/guided-review` | `/guided-review https://github.com/OWNER/REPO/pull/NUMBER /absolute/path/review.json` |

Both links point to `skills/guided-review`, which contains the single shared instructions, generation reference, and helpers. No personal installation is needed to use the skill in this repository. If Codex does not show the newly added skill, restart the session. See the official [Codex skill documentation](https://learn.chatgpt.com/docs/build-skills) and [Claude Code skill documentation](https://code.claude.com/docs/en/skills) for discovery and invocation.

To make the skill available from other projects, optionally link it into the relevant personal skills directory. Run the commands for your agent from this repository's root. For Codex:

```sh
mkdir -p ~/.agents/skills
ln -s "$PWD/skills/guided-review" ~/.agents/skills/guided-review
```

For Claude Code:

```sh
mkdir -p ~/.claude/skills
ln -s "$PWD/skills/guided-review" ~/.claude/skills/guided-review
```

Keep the clone at that location: the skill's helpers use the shared core and collector in the repository. Copying just the skill folder will not work. If `guided-review` already exists in your skills directory, choose which installation to keep before linking. A personal link may show a duplicate skill entry when working in this repository, where the repository link also applies.

The output path is optional; the default is `review-OWNER-REPO-NUMBER.json` in your working directory. The agent collects the real diff, writes a summary and ordered narrative sections, then builds and validates the artifact. The workflow does not execute PR code or submit reviews. Important behavior and review questions come first; related changes can span files or cover separate parts of one file. Changes that cannot be confidently grouped appear in a final `Ungrouped changes` section. Binary and unavailable markers explicitly retain inspection limits. The resulting artifact needs no GitHub access to read.

The [skill instructions](skills/guided-review/SKILL.md) and [generation reference](skills/guided-review/references/generation.md) define the workflow. The helper takes the collector's JSON and a separate narrative JSON containing only `summary` and `sections`:

```sh
bun run skills/guided-review/scripts/artifact.ts build collection.json narrative.json review.json
bun run skills/guided-review/scripts/artifact.ts validate collection.json review.json
```

Building preserves collected metadata and diff text, rejects invalid references, and adds uncovered changes to `Ungrouped changes`. Validation compares the finished artifact with the original collection and checks every reference and captured change. Both commands work offline. They exit nonzero with actionable errors for malformed inputs, changed source data, or invalid references; building refuses to overwrite an existing output. Use a new output path for a revision. Section priority and narrative accuracy still require human/model inspection; validation establishes structural validity and coverage.

A generated example for `cli/cli#1` is in [skills/guided-review/fixtures/cli-pr-1.json](skills/guided-review/fixtures/cli-pr-1.json), with selection/action behavior ordered before command wiring and both parts of the file covered.

## Open a review in the terminal

After `bun install`, run from the repository root in an interactive terminal:

```sh
bun run dev:tui path/to/review.json
```

Try the committed example with `bun run dev:tui skills/guided-review/fixtures/cli-pr-1.json`. Paths are relative to your current directory; absolute paths also work. Viewing works offline, without `gh`, authentication, or a PR checkout.

The viewer opens on the PR summary, including captured commit IDs, the description, and an ordered section list. Each section shows its explanation, optional text diagram, and referenced real diff with file paths, change status, and old/new line numbers. Markdown and diagrams are displayed as plain source text.

Line references show only selected changes, with original hunk headers and explicit omission markers; whole-file references also show context. Overlapping references in a section are combined in original diff order. Renames show both paths, while binary, unavailable, and metadata-only diffs have explicit markers. Ungrouped sections use the same diff display. Code wraps at the terminal width; scroll to read long sections and wrapped lines.

| Keys | Action |
| --- | --- |
| `n`, `→`, `Tab` | Next section (from the summary, open the first). |
| `p`, `←`, `Shift+Tab` | Previous section (from the first, return to summary). |
| `s`, `Home` | Return to summary. |
| `End` | Open the last section. |
| `↑`/`↓`, `k`/`j`, `PageUp`/`PageDown` | Scroll the current page. |
| `d` | Cycle diff preference: auto → inline → side-by-side → auto (session only). |
| `q`, `Ctrl+C` | Quit and restore the terminal. |

Missing or malformed files, unsupported versions, malformed diffs, and invalid change references produce an error with the artifact path and relevant field or file before the terminal UI starts. Uncovered captured changes and binary/unavailable diff limits appear on the summary. A TTY error means the command is being piped or run outside an interactive terminal. Dependencies must already be installed for offline use.

### Diff layouts

Diffs support `auto` (default), `inline`, and `side-by-side`. Automatic selection examines each file’s selected changes in the current section: additions-only or deletions-only uses inline; selections containing both use side-by-side. Below 100 available diff columns (103 terminal columns with the current margins and scrollbar), automatic mode uses inline. Binary, unavailable, and metadata-only content remains a full-width message.

```sh
bun run dev:tui --diff-mode inline path/to/review.json
bun run dev:tui path/to/review.json --diff-mode=side-by-side
```

Set `"diffMode": "side-by-side"` in the same user config file described below for a persistent default. Precedence is `--diff-mode` → config file → `auto`; an explicit `auto` overrides a fixed config preference. Press `d` to cycle the session preference without changing the config file. Help shows the preference, and each file header labels its effective layout. Invalid values and duplicate flags fail before terminal initialization.

Inline mode displays the unified diff with old/new line numbers. Side-by-side mode displays old lines on the left and new lines on the right, with separate line numbers and visible `-`/`+` signs. Lines pair in original order within each contiguous selected change block; unmatched lines leave the other pane blank. Context appears on both sides. Omission markers prevent pairing across unselected changes, and no unselected lines are added to fill a pane. Both panes wrap independently and stay aligned; forced side-by-side remains split at narrow widths. Mode switches and resizing retain the current section and anchor the visible diff row where possible.

### Changed spans

Paired old/new lines emphasize their changed words with stronger green/red backgrounds in both layouts, alongside syntax colors. Comparison follows the same positional pairs as side-by-side layout and uses only selected changes within each contiguous block. Context, omissions, and hunk boundaries stop comparison; unmatched lines keep whole-line styling. Signs, line numbers, and padding retain their existing colors.

Comparison uses Unicode word boundaries, emphasizing a whole changed word even when only one character differs. CamelCase and snake_case identifiers stay whole; punctuation and whitespace segments participate in comparison without changing the source or adding visible markers. Combining characters and emoji sequences remain intact. Inserted or deleted words emphasize only the side containing them; changed whitespace runs are emphasized on both sides. For expensive comparisons exceeding 250,000 segment-pair cells after shared prefix/suffix trimming, the remaining differing region receives emphasis as a whole. Viewing remains offline, and layout/theme changes reuse the computed ranges.

### Syntax highlighting

Both diff layouts highlight code using bundled language grammars and the active GitHub Light or GitHub Dark token palette. Supported languages are JavaScript, TypeScript (including declaration files), JSX, TSX, Python, Go, Rust, Java, C/C++, JSON, YAML, HTML, CSS, shell, SQL, and Markdown. Language selection uses captured filename extensions, including common aliases such as `.mjs`, `.cts`, `.hpp`, `.yml`, and `.bash`. Unknown extensions and extensionless paths remain plain text; source is never executed.

Highlighting works offline after dependencies are installed, without a checkout or language server. Old and new source are highlighted independently using their respective paths, including renames. Each selected fragment starts with fresh syntax state at hunk and omission boundaries, so highlighting of incomplete constructs is best effort. Omitted source is never fetched or reconstructed. Highlighting failures retain readable plain text.

Syntax colors affect code foregrounds only, including over the stronger changed-span backgrounds. Addition/deletion backgrounds, signs, gutters, line numbers, and markers retain their diff styling. Token colors that lack sufficient contrast against a row's background are darkened on light backgrounds or lightened on dark backgrounds while retaining their hue. GitHub's current default syntax palettes provide the base colors, including `#cf222e` for light-theme keywords. Theme changes recolor the current diff without resetting navigation or scrolling; layout changes reuse the highlighted source.

### Terminal themes

The viewer includes `github-light` and `github-dark`. By default, `auto` follows the terminal's reported light/dark appearance through OpenTUI. It waits up to 300 ms for initial detection, then uses GitHub Dark if no setting is available. Late replies and subsequent appearance changes update the colors without resetting your current section or scroll position. Detection reads the terminal's background color using OSC queries; supporting terminals can notify OpenTUI when their appearance changes. This follows the terminal appearance, which can differ from the operating system setting. Unsupported terminals or multiplexers that do not forward replies use the fallback; no OS-specific tools are required.

Choose a fixed theme for a launch:

```sh
bun run dev:tui --theme github-light path/to/review.json
bun run dev:tui path/to/review.json --theme=github-dark
```

For a persistent preference, set `GUIDED_REVIEW_THEME` in your shell or create `$XDG_CONFIG_HOME/guided-review/config.json` (default: `~/.config/guided-review/config.json`):

```json
{ "theme": "github-light", "diffMode": "auto" }
```

Precedence is `--theme` → `GUIDED_REVIEW_THEME` → config file → `auto`. All sources accept `auto`, `github-light`, or `github-dark`; an explicit `auto` restores automatic selection even when a lower-priority source names a fixed theme. Fixed themes ignore terminal appearance changes. A missing config file is normal and the viewer never creates one. Malformed/unreadable config files, unknown keys, and invalid theme or diff-mode values produce errors before terminal initialization, including when another source overrides them. An empty environment value is invalid; unset it to use the config file. `--help` works without loading configuration.

Both palettes set text and background colors explicitly for the viewport, navigation, narrative, diagrams, diffs, help, and scrollbars. Added and deleted lines use distinct foregrounds and full-row backgrounds (full-pane backgrounds in side-by-side mode), including wrapped continuations. Line-number gutters use GitHub’s green or red background colors on changed lines, replacing pipe separators; context gutters use the theme’s neutral surface. Context, file/hunk headers, line numbers, omission markers, and non-text messages use semantic theme colors. Markdown formatting remains planned separately.

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
- `apps/tui`: OpenTUI terminal viewer with local validation, summary, section navigation, and referenced unified diffs.
- `apps/web`: browser viewer, planned with React and shadcn/ui.
- `skills/guided-review`: shared Codex and Claude Code generation skill, offline build/validation helper, and a real-PR example.

## Development

Install [Bun](https://bun.sh/) 1.3.14 or later, then run `bun install`. Generation also requires Codex or Claude Code and an authenticated GitHub CLI (`gh`).

| Command | Purpose |
| --- | --- |
| `bun run dev <artifact.json>` or `bun run dev:tui <artifact.json>` | Open a local artifact in the terminal viewer. |
| `bun run dev:web` | Web development placeholder. |
| `bun run test` | Run the test suite. |
| `bun run lint` | Check code with Biome. |
| `bun run format:check` | Check formatting with Biome. |
| `bun run format` | Apply Biome formatting. |
| `bun run typecheck` | Type-check the workspace. |

The web development command currently prints a placeholder message and exits.

Pull requests run the test suite, lint, formatting, and type checks in GitHub Actions.
