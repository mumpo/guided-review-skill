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
bun run skills/guided-review/scripts/artifact.ts build collection.json narrative.json review.json --report
bun run skills/guided-review/scripts/artifact.ts validate collection.json review.json
```

Building preserves collected metadata and diff text, rejects invalid references, and adds uncovered changes to `Ungrouped changes`. Validation compares the finished artifact with the original collection and checks every reference and captured change. Both commands work offline. They exit nonzero with actionable errors for malformed inputs, changed source data, or invalid references; building refuses to overwrite an existing output. Use a new output path for a revision. Section priority and narrative accuracy still require human/model inspection; validation establishes structural validity and coverage. Add trailing `--report` to either command for a JSON inspection report instead of the default one-line success message. The report includes the final narrative, references, file identities and binary/unavailable limits, captured commit IDs, and validation results, without repeating diff text. Build reports also identify exact references automatically added to `Ungrouped changes`. The skill inspects this report against the collection already read, reopening specific hunks when needed. A successful build already validates the artifact; standalone validation is needed after subsequent artifact edits. The version 1 artifact and offline viewing are unchanged.

A generated example for `cli/cli#1` is in [skills/guided-review/fixtures/cli-pr-1.json](skills/guided-review/fixtures/cli-pr-1.json), with selection/action behavior ordered before command wiring and both parts of the file covered.

## One-time permission setup

For Codex, preview and install narrow permissions for the installed collector and launcher helpers:

```sh
bun run skills/guided-review/scripts/setup-permissions.ts
bun run skills/guided-review/scripts/setup-permissions.ts --install
```

Review the preview before installing, then restart Codex. Setup writes only `$CODEX_HOME/rules/guided-review.rules` (default `~/.codex/rules/guided-review.rules`), resolves the clone's real path, and preserves unrelated rules. It refuses to replace differing existing content. The rules approve those two helper prefixes outside the sandbox, including their repository dependencies and user-configured custom launcher. They do not grant blanket Bun, GitHub CLI, Herdr, or shell access. Moving the clone requires reviewing/replacing its dedicated rules file. Remove that file and restart Codex to revoke the grants.

Claude Code uses the shared skill's `allowed-tools` declarations for those same two helpers, with its installed skill-directory substitution. No separate settings install is needed. These declarations do not override explicit ask/deny rules, managed restrictions, or OS sandbox/network/socket restrictions. OS automation permissions and artifact output outside writable locations can still require approval in either host. See [permission setup details](skills/guided-review/references/permissions.md).

The collector now supports writing its output directly, without shell redirection:

```sh
bun run collect https://github.com/OWNER/REPO/pull/NUMBER --output collection.json
```

Omitting `--output` preserves JSON on stdout. Existing output files are never overwritten. Skill invocations use the stable `scripts/collect.ts` and `scripts/open.ts` helper paths directly so saved approvals can match; ordinary reviews never install additional permissions.

## Automatic viewer launch

After generating and inspecting a valid artifact, the shared Codex/Claude Code skill calls the local launcher. It opens a user-facing terminal and returns control to the agent. Explicit requests to generate without opening skip this step. Host permissions still apply; the skill cannot bypass sandbox or operating-system approval requirements.

Create `$XDG_CONFIG_HOME/guided-review/config.toml` (default `~/.config/guided-review/config.toml`) using [config.example.toml](config.example.toml) as a starting point. Installation and viewing never write personal configuration. Use `--config PATH` on either launcher or TUI to select another file, or set `GUIDED_REVIEW_CONFIG`; precedence is CLI path → environment path → default path. Explicit paths must exist. Paths are resolved from the caller's working directory.

```toml
viewer = "tui"
auto_open = true

[tui]
theme = "auto"
light_theme = "github-light"
dark_theme = "github-dark"
diff_mode = "auto"
launch = "auto"
```

Only `tui` is implemented; selecting `web` reports an error. Themes are selected from bundled `github-light` and `github-dark`; custom palettes are planned. In `auto` appearance, terminal light/dark reports select `light_theme`/`dark_theme`, including live changes and the dark fallback. A fixed `theme` bypasses this mapping.

| `tui.launch` | Behavior |
| --- | --- |
| `auto` | Calling Herdr pane → new Herdr tab; otherwise calling tmux pane → tmux window; otherwise local macOS → Terminal window. Other environments receive setup guidance. |
| `terminal-window` | New macOS Terminal window. Other apps/platforms use `custom`; SSH sessions cannot use this target. |
| `tmux-window` | New window in the calling tmux session. |
| `tmux-pane` | Split the calling tmux pane. |
| `tmux-popup` | Floating popup in an attached tmux client. |
| `herdr-tab` | New tab in the calling Herdr workspace. |
| `herdr-pane` | Split the calling Herdr pane. |
| `custom` | Execute the configured argument array for another terminal app. |

Built-in tmux and Herdr targets require an existing calling session on macOS/Linux. Herdr tabs and splits use the CLI's returned new pane ID. Quitting a review successfully closes that review pane; Herdr also closes the tab when its last pane closes. Additional panes you open in that tab are preserved. Viewer failures leave the pane open for error inspection. Native Herdr popups/overlays are deferred. Targets focus the new review. Auto-detection uses calling-pane environment markers, including `HERDR_ACTIVE_PANE_ID` when available; it does not start a multiplexer or choose an unrelated running session.

For split placement and popup size:

```toml
[tui.pane]
direction = "right" # "right" or "down"
size = 50           # percentage occupied by the new split

[tui.popup]
width = 90
height = 90
```

Sizes are integer percentages from 1 to 99. For another terminal, set `launch = "custom"` under `[tui]` and provide an executable and arguments:

```toml
[tui.custom]
command = ["kitty", "--title", "Guided Review", "{viewer}"]
```

The single standalone `{viewer}` entry expands into the absolute Bun executable, viewer entrypoint, resolved preferences, and absolute artifact path as separate arguments. No shell expansion is performed. Use your terminal's execute-command option where required; the custom executable must create an interactive terminal. Its working directory is the caller's directory.

Open an existing artifact with your configured placement:

```sh
bun run open:review path/to/review.json
bun run open:review --config /absolute/path/config.toml path/to/review.json
```

`auto_open = false` disables skill-triggered opening; explicit `open:review` still opens. Launch failures preserve the artifact and print a manual command. Explicit targets never fall back. Detached launchers return after observing immediate startup errors; success acknowledges the launch request, without confirming viewer initialization or later errors.

Previous `config.json` files are no longer loaded. If the default TOML file is absent and a sibling JSON file exists, viewing reports migration instructions. Translate `{ "theme": "github-light", "diffMode": "auto" }` into `[tui]` with `theme = "github-light"` and `diff_mode = "auto"`; no files are rewritten. When both exist, TOML is used.

## Open a review in the terminal

After `bun install`, run from the repository root in an interactive terminal:

```sh
bun run dev:tui path/to/review.json
```

Try the committed example with `bun run dev:tui skills/guided-review/fixtures/cli-pr-1.json`. Paths are relative to your current directory; absolute paths also work. Viewing works offline, without `gh`, authentication, or a PR checkout.

The viewer opens on the PR summary, including captured commit IDs, the description, and an ordered section list. Each section shows its explanation and referenced real diff with file paths and old/new line numbers. Each file has a bordered header with a clickable collapse chevron and green addition/red deletion counts for the full captured file. Renames show both paths. Press `c` to toggle the first file intersecting the visible viewport; collapse state survives theme, layout, and width changes, and resets when navigating sections. Optional fenced Mermaid diagrams appear within section explanations. Narrative Markdown uses themed formatting; Mermaid can render as graphics with the optional local setup below.

Line references show only selected changes, with explicit omission markers; whole-file references also show context. Overlapping references in a section are combined in original diff order. Raw Git metadata, hunk labels, and layout labels are hidden; separate hunks retain a blank separator. Binary, unavailable, and metadata-only diffs have explicit markers. Ungrouped sections use the same diff display. Code wraps at the terminal width; scroll to read long sections and wrapped lines.

| Keys | Action |
| --- | --- |
| `n`, `l`, `→`, `Tab` | Next section (from the summary, open the first). |
| `p`, `h`, `←`, `Shift+Tab` | Previous section (from the first, return to summary). |
| `s`, `Home` | Return to summary. |
| `End` | Open the last section. |
| `↑`/`↓`, `k`/`j`, `PageUp`/`PageDown` | Scroll the current page. |
| `Ctrl+u`/`Ctrl+d` | Scroll up/down half the current viewport height. |
| `c` | Collapse or expand the first file intersecting the visible viewport. |
| `d` | Cycle diff preference: auto → inline → side-by-side → auto (session only). |
| `q`, `Ctrl+C` | Quit and restore the terminal. |

Missing or malformed files, unsupported versions, malformed diffs, and invalid change references produce an error with the artifact path and relevant field or file before the terminal UI starts. Uncovered captured changes and binary/unavailable diff limits appear on the summary. A TTY error means the command is being piped or run outside an interactive terminal. Dependencies must already be installed for offline use.

### Markdown formatting

The summary, PR description, and section explanations support headings, paragraphs, nested ordered and unordered lists, bold and italic emphasis, inline code, fenced code blocks, and links. Titles, metadata, coverage notices, and section navigation remain literal text. Links show their destinations alongside their labels, including on terminals with hyperlink support; the viewer does not open them. Reference-style links resolve within each Markdown field, including across diagrams in explanations.

Fenced code uses the same bundled offline Shiki languages and GitHub palettes as the diff viewer. Fence info strings accept language names and common aliases such as `ts`, `py`, `c++`, and `bash`; unsupported or absent languages and highlighting failures use themed plain code. Code whitespace is preserved after Markdown indentation handling, long lines wrap, and low-contrast syntax colors are adjusted against the code background. Inline code has a distinct background. Soft narrative line breaks remain visible, and lists retain their indentation on wrapped continuations.

Unsupported constructs, including HTML, images, tables, blockquotes, and task lists, remain readable source. No embedded code or HTML is executed, and no linked images or other external resources are loaded. Unclosed fences remain source. Mermaid graphics are limited to eligible fences in section explanations; elsewhere their fences remain literal source. Theme changes recolor narrative in place, and normal scrolling, resizing, and section navigation apply.

### Mermaid diagrams

The generation agent may include top-level fenced `mermaid` blocks inside a section's `explanation`, alongside the relevant prose. Multiple diagrams retain their narrative order. Mermaid in summaries, PR descriptions, other code fences, blockquotes, and indented code remains literal text. An unclosed fence also remains text. Existing separate `diagram` fields are ignored; no migration or artifact rewrite is performed.

Graphics require a terminal reporting Kitty graphics support and pixel dimensions, plus an optional local [Mermaid CLI](https://github.com/mermaid-js/mermaid-cli) installation with Node.js, Puppeteer, and its headless-shell browser. The normal workspace installation does not include these dependencies. For example, install them separately before viewing:

```sh
npm install --global @mermaid-js/mermaid-cli@11.17.0 puppeteer
npx --yes --package puppeteer puppeteer browsers install chrome-headless-shell
```

Ensure `mmdc` and `node` are on `PATH`. Viewing never installs packages or downloads a browser. A missing installation, browser failure, invalid diagram, unsupported terminal, missing pixel dimensions, or rendering limit leaves readable fenced source with a short reason. Source remains visible while rendering. General narrative and diff navigation continue to work during rendering.

The renderer uses local packaged assets with external requests and arbitrary local file requests blocked. It disables HTML labels and rejects Mermaid configuration directives and frontmatter. Source is limited to 32,768 UTF-16 code units and 200 edges; each render has a 15-second deadline, a 4 MiB PNG limit, and a 4,096-pixel limit per dimension. Results use the active light/dark theme, fit the available width, scroll inside the body, and are released on navigation or exit. Resizing rerenders after a short debounce; the session caches up to four PNGs (at most 16 MiB). No images are embedded in or written back to artifacts.

The optional browser integration check is `GUIDED_REVIEW_MERMAID_INTEGRATION=1 bun test apps/tui/src/mermaid.integration.test.ts`. It exercises flowchart and sequence fixtures in both themes, malformed diagrams, and cancellation. The normal test suite skips this check and uses synthetic images for terminal lifecycle tests.

### Diff layouts

Diffs support `auto` (default), `inline`, and `side-by-side`. Automatic selection examines each file’s selected changes in the current section: additions-only or deletions-only uses inline; selections containing both use side-by-side. Below 100 available diff columns (103 terminal columns with the current margins and scrollbar), automatic mode uses inline. Binary, unavailable, and metadata-only content remains a full-width message.

```sh
bun run dev:tui --diff-mode inline path/to/review.json
bun run dev:tui path/to/review.json --diff-mode=side-by-side
```

Set `diff_mode = "side-by-side"` under `[tui]` in the user config file described below for a persistent default. Precedence is `--diff-mode` → config file → `auto`; an explicit `auto` overrides a fixed config preference. Press `d` to cycle the session preference without changing the config file. Help shows the preference. Invalid values and duplicate flags fail before terminal initialization.

Inline mode displays the unified diff with old/new line numbers. Side-by-side mode displays old lines on the left and new lines on the right, with separate line numbers and visible `-`/`+` signs. Lines pair in original order within each contiguous selected change block; unmatched lines leave the other pane blank. Context appears on both sides. Omission markers prevent pairing across unselected changes, and no unselected lines are added to fill a pane. Both panes wrap independently and stay aligned; forced side-by-side remains split at narrow widths. Mode switches and resizing retain the current section and anchor the visible diff row where possible.

### Changed spans

Paired old/new lines emphasize their changed words with stronger green/red backgrounds in both layouts, alongside syntax colors. Comparison follows the same positional pairs as side-by-side layout and uses only selected changes within each contiguous block. Context, omissions, and hunk boundaries stop comparison; unmatched lines keep whole-line styling. Signs, line numbers, and padding retain their existing colors.

Comparison uses Unicode word boundaries, emphasizing a whole changed word even when only one character differs. CamelCase and snake_case identifiers stay whole; punctuation and whitespace segments participate in comparison without changing the source or adding visible markers. Combining characters and emoji sequences remain intact. Inserted or deleted words emphasize only the side containing them; changed whitespace runs are emphasized on both sides. For expensive comparisons exceeding 250,000 segment-pair cells after shared prefix/suffix trimming, the remaining differing region receives emphasis as a whole. Viewing remains offline, and layout/theme changes reuse the computed ranges.

### Syntax highlighting

Both diff layouts highlight code using bundled language grammars and the active GitHub Light or GitHub Dark token palette. Supported languages are JavaScript, TypeScript (including declaration files), JSX, TSX, Python, Go, Rust, Java, C/C++, JSON, YAML, HTML, CSS, shell, SQL, and Markdown. Language selection uses captured filename extensions, including common aliases such as `.mjs`, `.cts`, `.hpp`, `.yml`, and `.bash`. Unknown extensions and extensionless paths remain plain text; source is never executed.

Highlighting works offline after dependencies are installed, without a checkout or language server. Diffs and narrative code blocks appear immediately with plain code styling, then receive syntax colors asynchronously from one background worker per viewer session. While the summary is open, the worker starts loading languages found in captured old/new paths and eligible narrative code fences, including required embedded-language dependencies (for example, HTML also needs JavaScript and CSS). A selected source sample per language also warms lazy regex compilation; the summary never waits for this work. Visible highlighting requests take priority over queued warm-up work, and other source is still highlighted on demand. Exact-source results for both themes are reused across sections and navigation in a session-local cache capped at 128 entries and approximately 16 MiB; oversized results are displayed without caching. Navigation discards obsolete queued work, and late results never alter a different section. Highlighting failures leave readable plain code. Old and new source are highlighted independently using their respective paths, including renames. Each selected fragment starts with fresh syntax state at hunk and omission boundaries, so highlighting of incomplete constructs is best effort. Omitted source is never fetched or reconstructed. Highlighting failures retain readable plain text.

Syntax colors affect code foregrounds only, including over the stronger changed-span backgrounds. Addition/deletion backgrounds, signs, gutters, line numbers, and markers retain their diff styling. Token colors that lack sufficient contrast against a row's background are darkened on light backgrounds or lightened on dark backgrounds while retaining their hue. GitHub's current default syntax palettes provide the base colors, including `#cf222e` for light-theme keywords. Theme changes recolor the current diff without resetting navigation or scrolling; layout changes reuse the highlighted source.

### Terminal themes

The viewer includes `github-light` and `github-dark`. By default, `auto` follows the terminal's reported light/dark appearance through OpenTUI. It waits up to 300 ms for initial detection, then uses GitHub Dark if no setting is available. Late replies and subsequent appearance changes update the colors without resetting your current section or scroll position. Detection reads the terminal's background color using OSC queries; supporting terminals can notify OpenTUI when their appearance changes. This follows the terminal appearance, which can differ from the operating system setting. Unsupported terminals or multiplexers that do not forward replies use the fallback; no OS-specific tools are required.

Choose a fixed theme for a launch:

```sh
bun run dev:tui --theme github-light path/to/review.json
bun run dev:tui path/to/review.json --theme=github-dark
```

For a persistent preference, set `GUIDED_REVIEW_THEME` in your shell or create `$XDG_CONFIG_HOME/guided-review/config.toml` (default: `~/.config/guided-review/config.toml`):

```toml
[tui]
theme = "github-light"
diff_mode = "auto"
```

Precedence is `--theme` → `GUIDED_REVIEW_THEME` → config file → `auto`. All sources accept `auto`, `github-light`, or `github-dark`; an explicit `auto` restores automatic selection even when a lower-priority source names a fixed theme. Fixed themes ignore terminal appearance changes. A missing default config file is normal and the viewer never creates one. Malformed/unreadable config files, unknown keys, and invalid settings produce errors before terminal initialization, including when another source overrides them. An empty environment value is invalid; unset it to use the config file. `--help` works without loading configuration.

Both palettes set text and background colors explicitly for the viewport, navigation, narrative, diagrams, diffs, help, and scrollbars. Added and deleted lines use distinct foregrounds and full-row backgrounds (full-pane backgrounds in side-by-side mode), including wrapped continuations. Line-number gutters use GitHub’s green or red background colors on changed lines, replacing pipe separators; context gutters use the theme’s neutral surface. Context, file/hunk headers, line numbers, omission markers, and non-text messages use semantic theme colors. Narrative Markdown uses the same active theme.

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
- `summary`: Markdown overview; `sections` is an ordered array of titles, Markdown explanations (optionally containing fenced Mermaid diagrams), and references. The former separate `diagram` field is ignored as unknown data; older artifacts still load, but those separate diagrams are no longer displayed.
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
- `packages/preferences`: local TOML configuration shared by launchers and the TUI.
- `apps/launcher`: terminal, tmux, Herdr, and custom viewer launch adapters.
- `apps/tui`: OpenTUI terminal viewer with local validation, summary, section navigation, and referenced unified diffs.
- `apps/web`: browser viewer, planned with React and shadcn/ui.
- `skills/guided-review`: shared Codex and Claude Code generation skill, offline build/validation helper, and a real-PR example.

## Development

Install [Bun](https://bun.sh/) 1.3.14 or later, then run `bun install`. Generation also requires Codex or Claude Code and an authenticated GitHub CLI (`gh`).

| Command | Purpose |
| --- | --- |
| `bun run open:review <artifact.json>` | Open a local artifact using configured terminal placement. |
| `bun run dev <artifact.json>` or `bun run dev:tui <artifact.json>` | Open a local artifact in the terminal viewer. |
| `bun run dev:web` | Web development placeholder. |
| `bun run test` | Run the test suite. |
| `bun run lint` | Check code with Biome. |
| `bun run format:check` | Check formatting with Biome. |
| `bun run format` | Apply Biome formatting. |
| `bun run typecheck` | Type-check the workspace. |

The web development command currently prints a placeholder message and exits.

Pull requests run the test suite, lint, formatting, and type checks in GitHub Actions.
