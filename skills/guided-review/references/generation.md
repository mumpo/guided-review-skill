# Writing the walkthrough

Write a JSON object with exactly `summary` and `sections`. The builder supplies `version`, `pullRequest`, and `files` from the collection, so do not regenerate those fields. Use JSON serialization to preserve Markdown and newlines. Example narrative shape (replace IDs and line numbers with actual collected changes):

```json
{
  "summary": "Adds an interactive PR selection flow. Review how displayed choices map back to PRs before reviewing command wiring.",
  "sections": [
    {
      "title": "Select a PR and dispatch its action",
      "explanation": "Explain the behavior, why these changes belong together, and any review questions grounded in the diff.",
      "diagram": "PR data -> selection -> action",
      "references": [
        { "kind": "lines", "fileId": "file-1", "side": "new", "startLine": 203, "endLine": 280 }
      ]
    }
  ]
}
```

`summary` and each section's `explanation` must be nonempty Markdown. Titles must be nonempty, and each section must reference actual changes. `diagram` is optional plain text, not an image or a required Mermaid renderer. The section array is the review order; there is no separate priority field. Choose the order using behavior, potential correctness/security/data risks, and dependencies, rather than alphabetical filenames or raw diff order. Be specific about changed behavior and useful review questions, without claiming tests were run or code outside the snapshot was inspected.

## Reference rules

- Use collected file IDs, never paths as IDs. A whole-file reference is `{ "kind": "file", "fileId": "file-1" }`. Use it when the file is one coherent change, or for binary, unavailable, and metadata-only changes.
- Inclusive one-based `lines` ranges use original source line numbers, not positions in the diff string. The old side selects deletions; the new side selects additions. A replacement needs both sides unless a whole-file reference already covers it. Context-only ranges are invalid. The diff hunk header gives the starting numbers; context advances both sides, `-` advances old, and `+` advances new.
- Use multiple references for multi-file sections or disjoint ranges. One file can belong to several sections. Avoid whole-file references when only part belongs to the section: they would hide missing grouping decisions behind apparent full coverage.
- Keep all captured changes visible, including deletions, renames, mode changes, and non-text markers. Binary/unavailable references acknowledge the marker; they do not mean the underlying content was reviewed. Say what cannot be inspected.
- If grouping is uncertain, use a final `Ungrouped changes` section and explain why. The builder also fills coverage gaps there, using exact uncovered line ranges or whole-file markers. Inspect this fallback so the reader understands the remaining uncertainty.

## Helper failures

The helper prints `Artifact failed: ...` to stderr and exits nonzero. JSON/read errors identify the input path. Structural errors include a field path, and bad diff references identify the section and reference indices. Fix the draft rather than altering collected changes. A collection mismatch means the artifact's captured metadata or files changed; rebuild from the original collection. Unsupported or malformed diffs must be fixed at collection time, not omitted. Existing output paths are protected to preserve earlier snapshots.
