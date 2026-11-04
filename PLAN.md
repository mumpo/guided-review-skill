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

- [ ] Set up OpenTUI and implement opening and validating a local artifact, a summary view, and keyboard navigation through ordered sections.
- **Depends on:** tasks 1–2.
- **Boundary:** Keep generation separate; detailed diff review belongs to task 6.
- **Acceptance:** A fixture opens offline; summary and sections are navigable; invalid artifacts show useful errors; include appropriate interaction tests.

### 6. TUI diff review

- [ ] Render each section's referenced real unified diff with file names, line numbers, explanations, and optional diagrams. Support scrolling and narrow terminals.
- **Depends on:** task 5.
- **Boundary:** Read-only; no review comments or submission.
- **Acceptance:** Verify multi-file and split-file sections, ungrouped changes, scrolling, resizing, and offline use with fixtures.

### 7. Web foundation

- [ ] Set up React, Vite, Tailwind CSS, and shadcn/ui. Add a CLI that accepts a local artifact path, binds a server to localhost, serves only the viewer and selected artifact, and opens the browser.
- **Depends on:** tasks 1–2.
- **Boundary:** No remote hosting, GitHub authentication, or review submission.
- **Acceptance:** The command opens a valid fixture offline; invalid files produce actionable errors; server and browser-launch failures are reported clearly.

### 8. Web review experience

- [ ] Build the GitHub-inspired PR header and summary, ordered section navigation, explanations, optional diagrams, and unified diffs with file names and line numbers. Use the shared core for validation and diff resolution.
- **Depends on:** task 7.
- **Boundary:** Read-only; no GitHub comments or submission.
- **Acceptance:** Verify navigation, real diff content, split-file and multi-file sections, keyboard accessibility, and responsive layouts using representative fixtures.

### 9. End-to-end hardening

- [ ] Exercise generation and both viewers together, resolve integration gaps, and finish installation, usage, troubleshooting, and artifact documentation.
- **Depends on:** tasks 4, 6, and 8.
- **Boundary:** Do not add deferred commenting, review submission, or additional viewers.
- **Acceptance:** Generate a snapshot for an accessible real PR; compare metadata, commit IDs, and full diff coverage with GitHub; open it offline in both viewers; run the full workspace checks.

## Decisions and progress

- Initial scaffold: Bun workspace, TypeScript, Biome, a self-contained JSON snapshot, and separate generation and viewing steps. The web viewer is launched with a local artifact path.
- Task 1: Version 1 stores per-file unified diff text or an explicit binary/unavailable marker. Sections can reference whole files or inclusive, one-based old/new line ranges; structural validation checks file IDs and ranges, while diff resolution and coverage remain task 2. Unknown fields are preserved. Tests, lint, formatting, and typecheck pass.
- Task 2: Diff parsing preserves raw lines and rejects unsupported or incomplete content. Coverage tracks additions and deletions separately; line references select changed lines on their stated side, while whole-file references cover all available content or an explicit non-text marker. Unreferenced metadata-only files are also reported.
- Task 3: A separate Bun collector invokes `gh` without a checkout and emits PR metadata and per-file diffs as intermediate JSON. It reconciles the paginated file list, headers, and changed-line counts, rejects unsupported or incomplete data, and rechecks base and head commits. Tests and workspace checks pass; manual collection succeeded for `cli/cli#1`.
- Task 4: The Claude Code skill writes only narrative and references; its offline helper combines these with untouched collected metadata and files. Invalid references fail, and exact uncovered old/new ranges or non-text/metadata markers go into a final `Ungrouped changes` section. Finished artifacts are checked against the original collection for preservation and complete captured-change coverage; narrative quality and priority remain inspection responsibilities. Installation uses a symlink into a full clone. A fresh collection of `cli/cli#1` produced the committed example with two manually inspected, priority-ordered sections and full textual coverage. All 27 tests, workspace checks, and skill-format validation pass. Claude Code itself was not invoked during verification.
- Task 4 extension requested by the user: Codex and Claude Code share the canonical `skills/guided-review` directory through relative repository discovery links in `.agents/skills` and `.claude/skills`. Instructions read invocation input from the request and resolve their own directory without host-specific substitutions. README documents both invocation forms and optional personal links. Verified reference/collector resolution and offline artifact build/validation through both links from an unrelated working directory; all 27 tests, workspace checks, and skill-format validation pass. No new agent session was launched to test skill discovery.
