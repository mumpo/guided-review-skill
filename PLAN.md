# Implementation plan

## Goal and constraints

Help a person review a GitHub pull request using an agent-generated walkthrough of the real diff. A shared Codex and Claude Code skill will accept a PR URL and generate a self-contained, versioned JSON snapshot without requiring a checkout. The snapshot will contain PR metadata, base and head commit IDs, the actual diff, Markdown explanations, optional text-based diagrams, and ordered sections referencing the diff. Related changes may span files, and separate parts of a file may belong to different sections. Order important changes first while retaining a useful architectural narrative.

Both a keyboard-driven OpenTUI viewer and a GitHub-inspired React and shadcn/ui web viewer will consume the same artifact through a runtime-independent TypeScript core. The web CLI will open a selected artifact in a localhost browser session. Both viewers are read-only and must work without GitHub access after generation. GitHub comments, review submission, and a Neovim viewer are deferred.

## Agent workflow

Work through the unchecked tasks in order. Pick only the first available task, respect its boundaries, run its acceptance checks and the applicable workspace checks, and open a small PR. Merge it only after the required review and checks, then start the next task. Update the checkbox and record material implementation decisions in this file as part of the task's PR. Do not mark a task complete until its acceptance checks pass. If blocked, record the blocker and avoid silently expanding scope.

## Tasks

### 1. Shared artifact contract

- [x] Define the versioned JSON snapshot and runtime validation in the shared core, including PR identity, commit IDs, diff data, ordered sections, narrative, optional diagram, and references to actual changes. Add representative valid and invalid fixtures.
- **Depends on:** scaffold.
- **Boundary:** No GitHub fetching or viewer interface.
- **Acceptance:** Round-trip valid fixtures; reject malformed and unsupported versions with actionable errors; document the contract for future viewers.

### 2. Diff processing and coverage

- [x] Parse unified diffs into browser-compatible structures, resolve section references, and detect uncovered changed lines and invalid references. Account for additions, deletions, renames, multiple sections per file, and binary or unavailable diffs.
- **Depends on:** task 1.
- **Boundary:** No model-generated groupings or GitHub access.
- **Acceptance:** Tests demonstrate exact real-diff rendering data, coverage detection, and clear handling of unsupported content without silently losing changes.

### 3. GitHub snapshot collection

- [x] Add a local collection command or helper using authenticated `gh` to fetch a PR by URL, its description, metadata, and diff without a checkout. Capture base and head IDs and verify they remain stable during collection.
- **Depends on:** tasks 1–2.
- **Boundary:** Do not generate narrative or build a viewer. Keep process and filesystem access outside the browser-compatible core.
- **Acceptance:** Automated tests cover authentication/access errors, incomplete data, and changed commit IDs; document prerequisites and manually verify against an accessible PR.

### 4. Shared generation skill

- [x] Implement the shared Codex and Claude Code skill and its supporting instructions to collect a snapshot, generate summary and ordered sections, reference real changes, and validate the finished artifact. Put changes that cannot be confidently grouped in an explicit ungrouped section.
- **Depends on:** tasks 1–3.
- **Boundary:** No autonomous GitHub comments or review submission.
- **Acceptance:** Generate a valid artifact for a representative PR; verify section ordering, references, full textual change coverage, and clear failure messages.

### 5. TUI foundation

- [x] Set up OpenTUI and implement opening and validating a local artifact, a summary view, and keyboard navigation through ordered sections.
- **Depends on:** tasks 1–2.
- **Boundary:** Keep generation separate; detailed diff review belongs to task 6.
- **Acceptance:** A fixture opens offline; summary and sections are navigable; invalid artifacts show useful errors; include appropriate interaction tests.

### 6. TUI diff review

- [x] Render each section's referenced real unified diff with file names, line numbers, explanations, and optional diagrams. Support scrolling and narrow terminals.
- **Depends on:** task 5.
- **Boundary:** Read-only; no review comments or submission.
- **Acceptance:** Verify multi-file and split-file sections, ungrouped changes, scrolling, resizing, and offline use with fixtures.

### 7. TUI theming

- [x] Make the UI configurable through provided themes, starting with GitHub Light and GitHub Dark. Default to the theme matching the system light/dark setting, with an explicit user override. Define reusable theme colors for text, backgrounds, navigation, diffs, diagrams, and Markdown.
- **Depends on:** task 6.
- **Boundary:** Establish theme configuration and readable UI colors; detailed diff styling belongs to task 8. Keep terminal/system detection outside the runtime-independent core.
- **Acceptance:** Verify readable foreground/background combinations in light and dark terminals, automatic selection matching the system setting, explicit theme selection, and useful errors for invalid configuration. Document detection behavior and a predictable fallback when the setting cannot be detected. Include theme-selection and rendered UI checks.

### 8. Themed diff rendering and layouts

- [x] Apply theme colors to additions, deletions, context, hunk headers, file headers, line numbers, omission markers, and non-text diff messages. Support inline and side-by-side layouts with automatic selection per file’s selected changes in the current section: single-sided changes use inline, mixed changes use side-by-side, and auto falls back to inline below 100 available diff columns. Add `--diff-mode`, config `diffMode`, and live `d` cycling with CLI → config → auto precedence; forced side-by-side remains split at narrow widths.
- **Depends on:** tasks 6–7.
- **Boundary:** Preserve the real diff text, reference selection, line numbers, and coverage semantics. Keep additions/deletions distinguishable by their existing signs as well as color.
- **Acceptance:** Verify representative multi-file, split-file, and ungrouped diffs in GitHub Light and GitHub Dark, including wrapped lines, scrolling, resizing, and binary/unavailable markers. Confirm both layouts preserve selected source content and coverage. Verify positional pairing within contiguous selected change blocks, unmatched cells, wrapped-row alignment, configuration validation, live mode switching, the width threshold, and viewport anchoring.

### 9. Syntax highlighting for the diff viewer

- [ ] Add language-aware syntax highlighting to code in both inline and side-by-side diff layouts, using the captured file paths to identify supported languages and the active GitHub theme for token colors.
- **Depends on:** task 8.
- **Boundary:** Keep viewing offline and preserve captured text, selected changes, line numbers, signs, omission markers, and coverage semantics. Preserve addition/deletion backgrounds and readable gutters. Handle partial hunks without assuming omitted source is available; unsupported languages or highlighting failures must retain readable plain text. Do not execute source content.
- **Acceptance:** Verify representative languages and unknown extensions in GitHub Light and GitHub Dark, including additions, deletions, context, split-file sections, incomplete syntax across hunks, wrapped lines, scrolling, resizing, and live theme/layout changes. Confirm no source content is lost or changed and highlighting works without a checkout or network access.

### 10. Highlight changed spans within line changes

- [ ] Highlight the specific changed spans within paired old/new lines in both inline and side-by-side layouts, so replacements are easier to compare than with whole-line coloring alone. Combine span emphasis with syntax highlighting and the existing addition/deletion backgrounds.
- **Depends on:** tasks 8–9.
- **Boundary:** Derive span comparisons only from selected, paired changes within the existing contiguous change blocks; never compare across omission, context, or hunk boundaries or reveal unselected source. Preserve raw text, signs, line numbers, pairing, and coverage semantics. Unpaired additions/deletions retain readable whole-line styling.
- **Acceptance:** Verify insertions, deletions, replacements, unequal change blocks, whitespace-only changes, repeated text, Unicode, and long wrapped lines in both themes and layouts. Check split-file selections, scrolling, resizing, and live theme/layout changes; changed spans must remain distinguishable alongside syntax colors without altering displayed source content.

### 11. Mermaid diagram rendering

- [ ] Adopt Mermaid for generated diagrams and investigate rendering them in the terminal using the Kitty graphics protocol. Record feasibility, required local dependencies, terminal capability detection, and behavior during scrolling and resizing. Implement the supported rendering path with a readable source fallback.
- **Depends on:** tasks 4 and 7.
- **Boundary:** Keep artifacts self-contained and viewing offline. Preserve existing plain-text diagrams; update generation guidance and document how Mermaid is distinguished from legacy text. Treat diagram source as untrusted content. Kitty graphics support is an investigation outcome, not a requirement to exclude terminals that lack it.
- **Acceptance:** Use representative Mermaid fixtures to verify light/dark styling, offline rendering, and clear handling of malformed diagrams or missing rendering dependencies. Demonstrate graphics rendering, scrolling, resizing, and cleanup in a compatible terminal if feasible; otherwise record the blocker and chosen fallback. Verify readable fallback in unsupported terminals and compatibility with existing text diagrams.

### 12. Markdown formatting in the TUI

- [ ] Add basic themed Markdown formatting for the summary, PR description, and section explanations: headings, paragraphs, lists, emphasis, inline code, fenced code blocks, and links. Keep diagram rendering separate from narrative formatting.
- **Depends on:** task 7.
- **Boundary:** Read-only presentation; do not execute embedded code or HTML. Preserve readable text for unsupported Markdown constructs and keep link destinations visible without automatically opening them.
- **Acceptance:** Verify representative Markdown fixtures in both default themes, including nested lists, code blocks, long links, narrow terminals, scrolling, and resizing. Ensure formatted narrative remains readable alongside section diffs and diagrams, with no lost content or navigation regressions.

### 13. Web foundation

- [ ] Set up React, Vite, Tailwind CSS, and shadcn/ui. Add a CLI that accepts a local artifact path, binds a server to localhost, serves only the viewer and selected artifact, and opens the browser.
- **Depends on:** tasks 1–2.
- **Boundary:** No remote hosting, GitHub authentication, or review submission.
- **Acceptance:** The command opens a valid fixture offline; invalid files produce actionable errors; server and browser-launch failures are reported clearly.

### 14. Web review experience

- [ ] Build the GitHub-inspired PR header and summary, ordered section navigation, explanations, optional diagrams, and unified diffs with file names and line numbers. Use the shared core for validation and diff resolution.
- **Depends on:** task 13.
- **Boundary:** Read-only; no GitHub comments or submission.
- **Acceptance:** Verify navigation, real diff content, split-file and multi-file sections, keyboard accessibility, and responsive layouts using representative fixtures.

### 15. End-to-end hardening

- [ ] Exercise generation and both viewers together, resolve integration gaps, and finish installation, usage, troubleshooting, and artifact documentation.
- **Depends on:** tasks 4, 6–12, and 14.
- **Boundary:** Do not add deferred commenting, review submission, or additional viewers.
- **Acceptance:** Generate a snapshot for an accessible real PR; compare metadata, commit IDs, and full diff coverage with GitHub; open it offline in both viewers; run the full workspace checks.

## Decisions and progress

- Planning update: Before starting the web foundation, complete TUI theming, themed diffs, Mermaid diagram rendering with a Kitty graphics feasibility investigation, and basic Markdown formatting. GitHub Light and GitHub Dark are the initial provided themes, selected automatically from the system setting unless overridden. Existing artifact content and offline viewing remain supported. Former tasks 7–9 are now tasks 11–13; task 7 is the next implementation task.
- Initial scaffold: Bun workspace, TypeScript, Biome, a self-contained JSON snapshot, and separate generation and viewing steps. The web viewer is launched with a local artifact path.
- Task 1: Version 1 stores per-file unified diff text or an explicit binary/unavailable marker. Sections can reference whole files or inclusive, one-based old/new line ranges; structural validation checks file IDs and ranges, while diff resolution and coverage remain task 2. Unknown fields are preserved. Tests, lint, formatting, and typecheck pass.
- Task 2: Diff parsing preserves raw lines and rejects unsupported or incomplete content. Coverage tracks additions and deletions separately; line references select changed lines on their stated side, while whole-file references cover all available content or an explicit non-text marker. Unreferenced metadata-only files are also reported.
- Task 3: A separate Bun collector invokes `gh` without a checkout and emits PR metadata and per-file diffs as intermediate JSON. It reconciles the paginated file list, headers, and changed-line counts, rejects unsupported or incomplete data, and rechecks base and head commits. Tests and workspace checks pass; manual collection succeeded for `cli/cli#1`.
- Task 4: The Claude Code skill writes only narrative and references; its offline helper combines these with untouched collected metadata and files. Invalid references fail, and exact uncovered old/new ranges or non-text/metadata markers go into a final `Ungrouped changes` section. Finished artifacts are checked against the original collection for preservation and complete captured-change coverage; narrative quality and priority remain inspection responsibilities. Installation uses a symlink into a full clone. A fresh collection of `cli/cli#1` produced the committed example with two manually inspected, priority-ordered sections and full textual coverage. All 27 tests, workspace checks, and skill-format validation pass. Claude Code itself was not invoked during verification.
- Task 4 extension requested by the user: Codex and Claude Code share the canonical `skills/guided-review` directory through relative repository discovery links in `.agents/skills` and `.claude/skills`. Instructions read invocation input from the request and resolve their own directory without host-specific substitutions. README documents both invocation forms and optional personal links. Verified reference/collector resolution and offline artifact build/validation through both links from an unrelated working directory; all 27 tests, workspace checks, and skill-format validation pass. No new agent session was launched to test skill discovery.
- Task 5: Pinned OpenTUI core 0.8.2 and added a local artifact CLI that validates structure, diffs, and references before initializing the terminal. The summary includes PR metadata, captured commits, ordered section titles, coverage gaps, and non-text diff limits. Keyboard navigation preserves artifact order, with scrolling for long narrative and clean quit/terminal restoration. Narrative is displayed as plain Markdown source; detailed diffs and diagrams remain task 6. The root launcher invokes the CLI directly because Bun's workspace filter changes working directory and pipes terminal output. Seven new tests cover offline loading, actionable failures, public launcher path handling, rendered keyboard interactions, scrolling, resizing, empty sections, and shutdown. All 34 tests, lint, formatting, and typecheck pass. Manually opened the real `cli/cli#1` fixture from the root command in a PTY, navigated to a section, and quit successfully without GitHub access.
- Task 6: Sections now show their explanation, optional plain-text diagram, and real diff excerpts from the shared core's resolved references. References to the same file are merged without duplicate lines and rendered in original hunk/line order; file order follows first reference. Old/new line numbers, rename paths, original diff headers, no-newline markers, and explicit binary/unavailable/metadata-only messages retain captured details. Partial references show original hunk headers with labeled omission markers, so excluded context or other sections' changes are not presented as adjacent lines. Code wraps by character in narrow terminals and uses the existing vertical scrolling controls. Four new tests plus expanded interaction assertions verify multi-file/split-file sections, overlapping references, ungrouped changes, markers, long code, scrolling, resizing, and section reset. All 38 tests, lint, formatting, and typecheck pass. Manually opened the committed real PR fixture in a PTY, navigated both sections, scrolled its numbered diff, and quit without GitHub access. No generation, web, or review-submission changes.
- Task 7: Added GitHub Light/Dark semantic palettes for text, backgrounds, navigation, scrollbars, diffs, diagrams, and Markdown. Per the agreed implementation plan, automatic selection follows the terminal's reported appearance through OpenTUI 0.8.2 rather than OS-specific settings. Initial detection waits up to 300 ms, falls back to GitHub Dark, and follows late replies/live changes without resetting navigation or scrolling. Fixed overrides use `--theme` → `GUIDED_REVIEW_THEME` → optional `$XDG_CONFIG_HOME/guided-review/config.json` (default `~/.config/guided-review/config.json`) → `auto`. Invalid sources fail before UI initialization, even when overridden. README documents detection, fallback, configuration, and precedence. All 49 tests, lint, formatting, and typecheck pass, including palette contrast (at least 4.5:1), actual rendered colors, detection lifecycle, precedence, errors, and interaction preservation. Opened the real PR fixture in a PTY under both fixed themes, navigated/scrolled and quit cleanly; injected OSC background replies switched automatic mode light/dark. No physical terminal appearance toggle was exercised. Detailed per-line diff coloring remains task 8, the next task.

- Task 8: Added semantic diff rows and themed inline/side-by-side presentation without changing artifact data, reference selection, or coverage. Auto chooses per file’s selected section changes: both additions and deletions use side-by-side at 100 available diff columns or wider; single-sided selections and narrower widths use inline. Side-by-side pairs changes positionally within contiguous selected blocks, preserves omissions/hunk boundaries, duplicates selected context, and associates no-newline markers with their side. Added/deleted backgrounds fill each row or pane, including wrapped continuations and unequal paired heights. `--diff-mode` overrides optional config `diffMode`, then defaults to `auto`; `d` cycles the session preference, file headers label the effective layout, and forced side-by-side stays split at narrow widths. Configuration is read once with existing theme precedence preserved. Mode/width changes anchor visible diff rows where possible, and theme changes recolor in place. All 58 tests, lint, formatting, and typecheck pass, including actual rendered colors/background extent, alignment, the width threshold, configuration errors, scrolling/resizing, markers, empty sections, and navigation. Manually opened the committed real PR fixture offline in PTYs under both themes, navigated both sections, scrolled, switched layouts, and quit cleanly; no physical-terminal visual inspection was performed. Task 9 is next.

- Planning update: Finish diff-viewer syntax highlighting (task 9), then changed-span highlighting within line changes (task 10), before continuing to Mermaid diagrams and Markdown formatting. Former tasks 9–13 are now tasks 11–15; later dependencies are updated accordingly. Syntax highlighting is the next implementation task.

- Task 8 follow-up: Replaced rendered line-number pipe separators with shaded gutters in both layouts, using GitHub’s supplied light colors (`#aceebb` additions, `#ffcecb` deletions) and dark alpha colors (`#2ea04366` additions, `#f8514966` deletions). Dark colors are composited over the diff canvas for terminal rendering; context gutters use the neutral surface. Captured source text, including literal pipes, remains intact. All 59 tests, lint, formatting, and typecheck pass, including rendered gutter colors, alpha compositing, and contrast.
