# Implementation plan

## Goal and constraints

Help a person review a GitHub pull request using an agent-generated walkthrough of the real diff. A shared Codex and Claude Code skill will accept a PR URL and generate a self-contained, versioned JSON snapshot without requiring a checkout. The snapshot will contain PR metadata, base and head commit IDs, the actual diff, Markdown explanations, optional Mermaid diagrams within section explanations, and ordered sections referencing the diff. Related changes may span files, and separate parts of a file may belong to different sections. Order important changes first while retaining a useful architectural narrative.

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

- [x] Add language-aware syntax highlighting to code in both inline and side-by-side diff layouts, using the captured file paths to identify supported languages and the active GitHub theme for token colors.
- **Depends on:** task 8.
- **Boundary:** Keep viewing offline and preserve captured text, selected changes, line numbers, signs, omission markers, and coverage semantics. Preserve addition/deletion backgrounds and readable gutters. Handle partial hunks without assuming omitted source is available; unsupported languages or highlighting failures must retain readable plain text. Do not execute source content.
- **Acceptance:** Verify representative languages and unknown extensions in GitHub Light and GitHub Dark, including additions, deletions, context, split-file sections, incomplete syntax across hunks, wrapped lines, scrolling, resizing, and live theme/layout changes. Confirm no source content is lost or changed and highlighting works without a checkout or network access.

### 10. Highlight changed spans within line changes

- [x] Highlight the specific changed spans within paired old/new lines in both inline and side-by-side layouts, so replacements are easier to compare than with whole-line coloring alone. Combine span emphasis with syntax highlighting and the existing addition/deletion backgrounds.
- **Depends on:** tasks 8–9.
- **Boundary:** Derive span comparisons only from selected, paired changes within the existing contiguous change blocks; never compare across omission, context, or hunk boundaries or reveal unselected source. Preserve raw text, signs, line numbers, pairing, and coverage semantics. Unpaired additions/deletions retain readable whole-line styling.
- **Acceptance:** Verify insertions, deletions, replacements, unequal change blocks, whitespace-only changes, repeated text, Unicode, and long wrapped lines in both themes and layouts. Check split-file selections, scrolling, resizing, and live theme/layout changes; changed spans must remain distinguishable alongside syntax colors without altering displayed source content.

### 11. Mermaid diagram rendering

- [x] Adopt Mermaid for generated diagrams and investigate rendering them in the terminal using the Kitty graphics protocol. Record feasibility, required local dependencies, terminal capability detection, and behavior during scrolling and resizing. Implement the supported rendering path with a readable source fallback.
- **Depends on:** tasks 4 and 7.
- **Boundary:** Keep artifacts self-contained and viewing offline. Per the requested artifact change, remove the separate `diagram` field from the supported interface and generation guidance; use optional fenced Mermaid blocks inside section explanations. Older artifacts still load, preserving legacy fields as unknown data while ignoring them in viewers. Treat diagram source as untrusted content. Kitty graphics support is an investigation outcome, not a requirement to exclude terminals that lack it.
- **Acceptance:** Use representative Mermaid fixtures to verify light/dark styling, offline rendering, and clear handling of malformed diagrams or missing rendering dependencies. Demonstrate graphics rendering, scrolling, resizing, and cleanup in a compatible terminal if feasible; otherwise record the blocker and chosen fallback. Verify readable fallback in unsupported terminals and that older artifacts load while ignoring separate legacy diagrams.

### 12. Markdown formatting in the TUI

- [x] Add basic themed Markdown formatting for the summary, PR description, and section explanations: headings, paragraphs, lists, emphasis, inline code, fenced code blocks, and links. Preserve task 11’s Mermaid block parsing/rendering while formatting surrounding narrative; diagrams remain separate renderables within explanation order.
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

## Additional todos

- [ ] Speed up review artifact creation: compact inspection report implemented; benchmark model latency/quality and evaluate reference/format changes before selecting fast-model defaults.
- [ ] Add a commenting feature.
- [x] Review Vim motions: `j`/`k` scroll by line, `Ctrl+u`/`Ctrl+d` scroll by half the current viewport, and `h`/`l` navigate previous/next sections.
- [ ] Redesign the main TUI layout and sections.
- [ ] Launch the TUI automatically from the skill.

## Decisions and progress

- TUI Vim motions: Added `h`/`l` section navigation with existing summary/end boundaries and scroll reset, plus `Ctrl+u`/`Ctrl+d` half-viewport scrolling (rounded down, minimum one row). Existing `j`/`k`, navigation keys, and plain `d` layout cycling remain available. Help and README document the bindings.

- TUI file-header refinement: Replace visible raw Git metadata, hunk labels, and layout labels with a bordered filename header, clickable collapse chevron, and full captured-file addition/deletion counts. Keep selected source, line numbers, omission markers, and internal hunk boundaries; separate displayed hunks with a blank row. Renames retain both paths. `c` toggles the first file intersecting the viewport. Collapse state survives layout/theme/width changes and resets on section navigation. No artifact, coverage, or planned web-task changes.

- Generation performance follow-up: Added optional trailing `--report` to artifact build/validation. It returns the final narrative, file identities and non-text limits, commit IDs, and successful validation results without captured diff text. Build reports identify the exact automatically added ungrouped references; validation reports omit provenance unavailable from an existing artifact. The shared skill now inspects this report against the complete collection already read and reopens specific hunks when needed. Successful builds already run full verification; standalone validation remains required after later artifact edits. Artifact version 1, default CLI output, collection completeness, and coverage semantics are unchanged. Offline replay of three local review snapshots reduced post-build inspection bytes by 80–86% versus formatted artifacts (79–85% versus compact JSON); this is a byte comparison, not a measured model latency or quality result. The committed real-PR fixture reduced inspection bytes by 62%. Faster-model and format experiments remain open.

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

- Task 9: Added offline syntax highlighting using pinned Shiki 4.6.0, its synchronous JavaScript regex engine, bundled common-language grammars, and GitHub Light/Dark token palettes. Supported paths cover JavaScript/TypeScript (including JSX, TSX, and declaration files), Python, Go, Rust, Java, C/C++, JSON, YAML, HTML, CSS, shell, SQL, and Markdown. Captured old/new paths select each side's language independently; selected context participates in both streams and inline context uses the new side. Syntax state resets at every hunk and omission boundary without reading omitted source or a checkout. Token output must exactly reconstruct each selected source body; unknown paths, engine failures, and invalid token output preserve plain-text styling. Cached current-section tokens survive layout/width changes and provide both theme palettes for live recoloring. Syntax affects source foregrounds only; existing signs, gutters, backgrounds, markers, line numbers, and coverage remain intact. Token colors below 4.5:1 contrast against their actual row background use its existing readable foreground. All 67 tests, lint, formatting, and typecheck pass, including every bundled language, independent syntax state, fragment resets, Unicode/whitespace preservation, failure fallbacks, contrast, rendered colors, wrapping, and live updates. Offline PTY smoke checks passed for a temporary TypeScript/Python/unknown-extension artifact and the committed real PR fixture in both themes, including navigation, scrolling, layout cycling, resizing, and terminal restoration. No physical-terminal visual inspection was performed. No artifact, shared-core, generation, or CLI/config changes. Task 10 is next.

- Task 9 color follow-up: Use Shiki's current GitHub default palettes (including light keyword red `#cf222e`) under the existing theme names. Low-contrast syntax foregrounds are adjusted toward black or white to reach 4.5:1 against the actual diff background while preserving their hue; they no longer inherit the addition/deletion foreground. Missing token colors still use the normal text foreground. Regression checks verify red keywords remain red in both layouts, adjustment in both brightness directions, and unchanged colors that already meet the threshold. All 68 local tests, lint, formatting, typecheck, and diff checks pass. GitHub Actions follow-up remains deferred at the user's request.

- Task 10: Both layouts now emphasize changed source graphemes within the existing positional old/new pairs. Shared pairing preserves selected contiguous block boundaries, source identities, no-newline markers, and viewport anchors. Unicode-aware LCS comparison uses deletion-first ties and a 250,000-cell budget after common prefix/suffix trimming; larger comparisons emphasize the remaining differing region. Ranges are cached per selected section and intersected with syntax tokens, using stronger semantic backgrounds and foreground contrast adjustment against the actual span background. Unpaired lines keep whole-line styling. README documents behavior and fallback. All 76 tests, lint, formatting, typecheck, and diff checks pass, covering exact ranges, whitespace, repeated text, Unicode, unequal blocks, selection gaps, bounded comparison, syntax/plain text colors, wrapping, scrolling, resizing, and live layout/theme changes. Offline PTY smoke checks passed for the real PR fixture and a temporary TypeScript/emoji replacement fixture in both themes, including layout cycling and terminal restoration. No physical-terminal visual inspection was performed. No artifact, core, generation, or configuration changes. Task 11 is next.

- Task 10 word-level follow-up requested by the user: Changed comparison segmentation from Unicode graphemes to Unicode words to avoid fragmented emphasis within identifiers. CamelCase and snake_case identifiers remain whole; punctuation and whitespace segments still participate without rewriting source. The existing LCS, deterministic ties, selected-pair boundaries, and fallback remain, with the budget now measured in segment-pair cells. Updated exact-range and fallback fixtures and added rendered whole-identifier regression checks in both themes/layouts. All 77 tests, lint, formatting, typecheck, and diff checks pass. README documents the new behavior.

- Task 11: Section explanations now support optional top-level fenced Mermaid blocks in narrative order. At the user’s request, removed the separate `ReviewSection.diagram` field and its validation; version 1 retains unknown legacy data but viewers ignore that field. Updated canonical generation guidance and README. OpenTUI 0.8.2 already provides Kitty capability detection, pixel resolution, clipped image rendering, and native scroll anchoring, so no custom graphics protocol or new workspace dependency was needed. A strict TypeScript adapter is compiled once in memory and launched as a temporary Node.js worker, discovering the optional local Mermaid CLI through `mmdc`, uses its programmatic API and Puppeteer headless-shell browser, and returns themed PNGs. Strict configuration, rejected source directives/frontmatter, packaged-asset request allowlisting with realpath checks, source/edge/image limits, timeouts, cancellation, and bounded caching keep viewing offline and responsive. Unsupported terminals, missing dependencies, malformed diagrams, and failures retain fenced source with a short reason. Late pixel replies, resizing, and live themes refresh presentation without replacing the active section; native anchoring preserves visible narrative. Automated renderer checks cover both themes, image clipping/scrolling, resizing, caching, navigation cleanup, stale results, and late detection. Opt-in integration passed with local Mermaid CLI 11.17.0: flowchart and sequence PNGs in both themes, background colors, malformed source, and cancellation. Resource-policy tests cover external URLs, arbitrary files, sibling paths, and symlink escapes. All 88 default tests pass (the optional browser test is skipped by default and passed separately), along with lint, formatting, typecheck, and diff checks. Offline PTY smoke checks passed in both themes with source fallback, section navigation, scrolling, layout cycling, and terminal restoration. Physical Kitty-terminal visual verification is unavailable in this environment; actual terminal graphics display remains a manual verification limitation. Task 12 is next.

- Task 12: Summary, PR description, and section explanations now use themed Markdown headings, paragraphs, nested ordered/unordered lists, bold/italic emphasis, inline code, fenced code, and passive links with visible destinations. Added a direct pinned dependency on the already-installed marked 17.0.1 parser and render through OpenTUI styled text rather than its default Markdown renderer, keeping destinations visible regardless of terminal hyperlink support and avoiding another highlighting path. Fenced code shares the diff viewer's validated offline Shiki tokenizer, bundled language names/aliases, both cached palettes, and contrast adjustment; unknown languages and failures retain themed plain code. Code whitespace follows Markdown indentation handling and is preserved through wrapping; soft narrative line breaks remain visible. Unsupported HTML, images, tables, blockquotes, task lists, and unclosed fences remain readable source. Metadata and titles remain literal, and reference definitions are scoped to each Markdown field while resolving across Mermaid blocks in explanations. Mermaid extraction, fallback, image lifecycle, and native anchoring are preserved; live themes recolor narrative nodes in place. Nine new regression tests and expanded Mermaid lifecycle fixtures cover both themes, nested formatting/lists, visible long links with hyperlink capability enabled, Unicode/whitespace, aliases and failures, narrow wrapping, scrolling/resizing, live themes, independent fields, diagrams, and adjacent real diffs. All 99 tests pass (one optional browser integration test skipped), along with lint, formatting, typecheck, and diff checks. Offline PTY smoke checks passed for the committed real PR example and a temporary Markdown/TypeScript/Python/Mermaid fixture under both themes, including navigation, scrolling, layout cycling, resizing, clean exit, and restored terminal attributes. Physical-terminal visual inspection remains unavailable; the unchanged optional Mermaid browser integration was not rerun. No artifact, core, generation, CLI/configuration, or web changes. Task 13 is next.
