# Optional permission customization

Plugin installation and use require no setup command. Normal host approval prompts work without any custom rules. The commands below are advanced, optional customization for users who explicitly want persistent helper approvals. Plugin caches move when versions change; any saved rules for an old installation must be reviewed again for the new paths.

Read this for explicit installation/setup requests or permission troubleshooting, not for ordinary artifact generation. Never install permission rules merely because a review command needs approval.

## Codex

From the full Guided Review clone (or the complete installed plugin's root), preview the exact two command-prefix rules:

```sh
bun run skills/guided-review/scripts/setup-permissions.ts
```

After reviewing the displayed helper paths, install them:

```sh
bun run skills/guided-review/scripts/setup-permissions.ts --install
```

Restart Codex afterward. The command creates `$CODEX_HOME/rules/guided-review.rules`, defaulting to `~/.codex/rules/guided-review.rules`. It does not change config.toml, default.rules, or other rules. Reinstalling identical rules is harmless; differing existing content is preserved and reported for manual review. Preview mode writes nothing.

The two allow rules match `bun run ABSOLUTE_SKILL_PATH/scripts/collect.ts` and `bun run ABSOLUTE_SKILL_PATH/scripts/open.ts`, with their arguments. Invoke these literal command prefixes directly. Shell assignments, variables, substitutions, redirection, or different executable/path spellings may prevent matching. Codex callers should use the real skill path; setup resolves discovery symlinks to that same path. If the clone moves, inspect and replace only this rules file, then run setup again.

The collector helper can access authenticated GitHub PR data and write its collection to an explicitly named output file. The launcher helper can launch the installed viewer, access a multiplexer socket, open a terminal, and execute a custom launcher configured by the user. These grants trust the installed helper code and its repository dependencies, including later edits, plus configured custom executables. They do not allow arbitrary Bun scripts, direct GitHub/Herdr commands, or installing more permissions. Local artifact construction stays within normal workspace/tmp access; an output elsewhere can still require approval.

Rules allow matching commands to run outside the sandbox without repeated prompts, subject to stricter managed/forbidden rules. They are not a skill-specific sandbox exemption and do not bypass OS automation permissions. To revoke them, remove `guided-review.rules` and restart Codex.

See [Codex rules](https://learn.chatgpt.com/docs/agent-configuration/rules).

## Claude Code

The shared SKILL.md declares `allowed-tools` for only these same two helpers, using `${CLAUDE_SKILL_DIR}`. Current Claude Code substitutes that directory in both the frontmatter Bash rules and the skill body. Keep that path spelling in commands, including a discovery symlink, so it matches the host's rule. No personal settings file needs to be modified.

The tool pre-approval lasts for the invoking turn and is applied again when the skill is invoked again. It does not widen other tools' permissions. Explicit ask/deny rules, managed restrictions, and the OS-level sandbox still apply. If sandboxing is enabled, its GitHub network and multiplexer-socket policy must separately permit the workflow; `allowed-tools` does not bypass it. Use the host's normal approval/settings mechanism when those restrictions apply rather than broadening access from the skill.

See [Claude skill pre-approval](https://code.claude.com/docs/en/skills#pre-approve-tools-for-a-skill), [skill path substitution](https://code.claude.com/docs/en/skills#available-string-substitutions), and [permissions versus sandboxing](https://code.claude.com/docs/en/permissions#how-permissions-interact-with-sandboxing).
