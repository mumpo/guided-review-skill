# Plugin distribution

The source repository owns one canonical skill and two host manifests. The source catalogs point to `guided-review` on the generated `plugins` branch of this same repository. That branch contains the complete runtime with production dependencies, and local-path catalogs for both hosts. Users install through their host; no setup command, clone, package-manager invocation, or automatic permission installer runs on their machine.

## Build and verify

Publisher prerequisites are Bun 1.3.14+, network access to the npm registry, and `zip`/`unzip`. From the source checkout:

```sh
bun run package:plugin
bun run test:plugin dist/plugin/guided-review-0.1.0.zip
```

Packaging defaults to `dist/plugin` and refuses to overwrite an existing output. For another build, pass a new directory: `bun run package:plugin /absolute/path/new-output`. Version numbers come from `plugin.json` and `.claude-plugin/plugin.json`; they must match. Increment both for each release.

The packager copies only the runtime trees, manifests, skill, documentation, license, preferences example, and locked dependency metadata. It excludes tests and existing dependency trees, then installs production dependencies in the package with a frozen lockfile, disabled lifecycle scripts, and all operating systems and architectures. Every optional OpenTUI native package must be present at its pinned version. Source-relative helpers and worker paths remain intact. Dependency licenses and assets remain with the installed modules. Symlinks must resolve inside the package; a link to a checkout or publisher cache fails the build.

Outputs:

- `dist/plugin/marketplace/`: ready-to-publish Git marketplace with both catalogs.
- `dist/plugin/marketplace/guided-review/`: complete plugin recognized by both hosts.
- `dist/plugin/guided-review-VERSION.zip`: the same complete plugin for directory submission or direct distribution.

The archive smoke check extracts into a temporary directory outside the checkout, including paths containing spaces. It uses an unrelated working directory, isolated home/config/cache, and a PATH containing only Bun. It builds and validates the real PR fixture, checks collection CLI errors and disabled launch behavior, and runs the packaged native test renderer in both themes/layouts with navigation and resizing. It also verifies the actual syntax worker and dynamically imported grammar produce colors, and that viewing leaves the artifact unchanged. No GitHub requests or comments are made. PR CI repeats this on Linux and macOS. Native Windows and musl libraries are packaged but not executed by that matrix.

The same check accepts an installed plugin directory: `bun run test:plugin /absolute/path/to/installed/plugin`. This verifies the host's cached copy rather than relying on the build directory. Both local Codex and Claude Code marketplace installation and their cached copies were verified during implementation; fresh agent generation and GitHub-backed installation remain release checks.

To test the host installation locally, register the generated `dist/plugin/marketplace` directory with each host's marketplace-add command, install `guided-review@mumpo-plugins`, and start a new session. Use an isolated host configuration when testing so an existing marketplace of the same name is not replaced. Validate Claude manifests with `claude plugin validate --strict dist/plugin/marketplace` and `claude plugin validate --strict dist/plugin/marketplace/guided-review`.

Graphical Mermaid support retains the existing optional external renderer/browser integration and offline source fallback. Browser downloads and Node.js are not needed for generation, diff viewing, syntax highlighting, or readable Mermaid source. This release does not bundle browsers or change that integration.

## Publish a release

Merge the reviewed source PR after its checks pass. In GitHub Actions, run **Release plugin** on `main`. This is an explicit maintainer action; PRs never publish. The repository must allow the workflow token to push the `plugins` branch and create releases.

The workflow runs the workspace checks, builds and smoke-tests the archive, commits the complete marketplace to `plugins`, then publishes `plugin-vVERSION` with the ZIP attached. The tag points to the source commit; the generated branch commit records that source SHA. It does not force-push. The catalogs on the source branch fetch the complete plugin from `plugins`, so the README's `mumpo/guided-review-skill` installation commands work after this first release. The generated branch is runtime distribution only; make edits on the source branch and rebuild.

An existing `plugin-vVERSION` tag blocks republishing that version. If publication fails after updating the distribution branch, inspect the branch and release state before retrying. Do not reuse a published version for changed content. CI credentials are used only by the release workflow and are not copied into the plugin or ZIP.

## Public directory listings

Git marketplace publication and directory approval are separate. The release workflow does not submit to either directory.

For Claude, submit the GitHub plugin source through [Anthropic's developer portal](https://claude.ai/directory/manage), using the generated runtime branch rather than the unbundled source branch. Check the portal's current component support and listing requirements; local terminal workflows target Claude Code. See [Claude's publishing guide](https://code.claude.com/docs/en/plugins/publish).

For OpenAI, upload the release ZIP through the [plugin submission flow](https://developers.openai.com/plugins/deploy/submission), resolve automated findings, submit for review, and publish after approval. The portable manifest sets `extensions.com.openai.requires_local_executor` because Guided Review invokes local programs. Follow [desktop-only requirements](https://developers.openai.com/plugins/deploy/desktop-only); installing on a cloud surface does not provide the user's local Bun, authenticated gh, or terminal.

Provide the requested publisher identity, listing artwork, review materials, and account-specific attestations in each portal. Local validation and passing CI establish package behavior; they do not guarantee directory approval.
