# Guided Review

Guided Review will help people review GitHub pull requests through an ordered, Claude-generated walkthrough of the actual changes. A shared review artifact will support a terminal viewer and a GitHub-inspired web viewer without requiring a checkout of the PR repository.

This repository is a scaffold: the skill, artifact format, and viewers are not implemented yet. See [PLAN.md](PLAN.md) for the sequential implementation tasks.

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
