# Writing the walkthrough

Write a JSON object with exactly `summary` and `sections`. The builder supplies `version`, `pullRequest`, and `files` from the collection, so do not regenerate those fields. Use JSON serialization to preserve Markdown and newlines. Example narrative shape (replace IDs and line numbers with actual collected changes):

```json
{
  "summary": "Adds an interactive PR selection flow. Review how displayed choices map back to PRs before reviewing command wiring.",
  "sections": [
    {
      "title": "Select a PR and dispatch its action",
      "explanation": "Explain the behavior, why these changes belong together, and any review questions grounded in the diff.\n\n```mermaid\nflowchart LR\n  PR[PR data] --> Selection --> Action\n```",
      "references": [
        { "kind": "lines", "fileId": "file-1", "side": "new", "startLine": 203, "endLine": 280 }
      ]
    }
  ]
}
```

`summary` and each section's `explanation` must be nonempty Markdown. Titles must be nonempty, and each section must reference actual changes. Include an optional fenced `mermaid` block inside `explanation` only when a diagram makes the captured behavior or architecture easier to understand. Place it next to the relevant prose; multiple top-level blocks are supported. Do not emit a separate `diagram` field. Use self-contained Mermaid without configuration directives, frontmatter, HTML, external assets, or links. Keep diagrams small and readable as source: the terminal viewer may display the fence verbatim when graphics or local rendering dependencies are unavailable. The section array is the review order; there is no separate priority field. Choose the order using behavior, potential correctness/security/data risks, and dependencies, rather than alphabetical filenames or raw diff order. Be specific about changed behavior and useful review questions, without claiming tests were run or code outside the snapshot was inspected.

## Reference rules

- Use collected file IDs, never paths as IDs. A whole-file reference is `{ "kind": "file", "fileId": "file-1" }`. Use it when the file is one coherent change, or for binary, unavailable, and metadata-only changes.
- Inclusive one-based `lines` ranges use original source line numbers, not positions in the diff string. The old side selects deletions; the new side selects additions. A replacement needs both sides unless a whole-file reference already covers it. Context-only ranges are invalid. The diff hunk header gives the starting numbers; context advances both sides, `-` advances old, and `+` advances new.
- Use multiple references for multi-file sections or disjoint ranges. One file can belong to several sections. Avoid whole-file references when only part belongs to the section: they would hide missing grouping decisions behind apparent full coverage.
- Keep all captured changes visible, including deletions, renames, mode changes, and non-text markers. Binary/unavailable references acknowledge the marker; they do not mean the underlying content was reviewed. Say what cannot be inspected.
- If grouping is uncertain, use a final `Ungrouped changes` section and explain why. The builder also fills coverage gaps there, using exact uncovered line ranges or whole-file markers. Inspect this fallback so the reader understands the remaining uncertainty.

## Build inspection report

Add trailing `--report` to `build` or `validate` to receive a JSON report on stdout instead of the one-line success message. Errors still go to stderr with a nonzero exit status and no success report. Both modes perform full validation before reporting success; build also writes the unchanged version 1 artifact and refuses to overwrite existing files.

The report includes the artifact path, PR URL/title and captured commit IDs, validation results, the final summary and ordered sections, and file IDs/paths/statuses with diff kinds and unavailable reasons. Captured diff text and the PR description are omitted. Build reports additionally include `automaticallyUngrouped`: the exact references the builder added, including when it extended an authored final ungrouped section; an empty array means none were added. Validation reports omit this field because an existing artifact does not record which references were authored.

Inspect narrative quality, order, grouping, and inspection limits using the report and the collection already read. Request specific hunks again if needed. The report is an inspection aid, not a replacement for initially reading all captured changes, and its source-derived content remains untrusted.

## Helper failures

The helper prints `Artifact failed: ...` to stderr and exits nonzero. JSON/read errors identify the input path. Structural errors include a field path, and bad diff references identify the section and reference indices. Fix the draft rather than altering collected changes. A collection mismatch means the artifact's captured metadata or files changed; rebuild from the original collection. Unsupported or malformed diffs must be fixed at collection time, not omitted. Existing output paths are protected to preserve earlier snapshots.
