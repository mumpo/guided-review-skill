// Separate process: optional browser dependencies never enter the viewer runtime.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFile, realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  allowedMermaidRequest,
  checkMermaidSource,
  mermaidLimits,
} from "./mermaid-policy";

const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
const timer = setTimeout(() => controller.abort(), mermaidLimits.timeout);
let closeBrowser: (() => Promise<void>) | undefined;

try {
  const chunks: Uint8Array[] = [];

  for await (const chunk of process.stdin) chunks.push(chunk);

  const input = Buffer.concat(chunks).toString();
  if (input.length > mermaidLimits.source * 7)
    throw new Error("worker input exceeds limit");

  const { cli, source, theme, width } = JSON.parse(input);

  checkMermaidSource(source);

  const require = createRequire(cli);
  const packageRoot = dirname(dirname(cli));
  const entry = await realpath(join(packageRoot, "dist/index.html"));

  // Resolve individual dependency roots for both hoisted and nested npm layouts.
  async function dependencyRoot(specifier: string) {
    let directory = dirname(require.resolve(specifier));

    while (directory !== dirname(directory)) {
      try {
        await readFile(join(directory, "package.json"));

        return await realpath(directory);
      } catch {
        directory = dirname(directory);
      }
    }

    throw new Error("cannot resolve packaged Mermaid assets");
  }

  const roots = [await realpath(packageRoot)];

  for (const specifier of [
    "mermaid",
    "@mermaid-js/layout-elk",
    "@mermaid-js/mermaid-zenuml",
    "katex",
    "@fortawesome/fontawesome-free/css/fontawesome.css",
    "@mermaid-js/layout-tidy-tree",
  ]) {
    try {
      roots.push(await dependencyRoot(specifier));
    } catch {
      /* Optional assets may be absent. */
    }
  }

  const { renderMermaid } = await import(
    pathToFileURL(join(packageRoot, "src/index.js")).href
  );
  const { default: puppeteer } = await import(
    pathToFileURL(require.resolve("puppeteer")).href
  );

  controller.signal.throwIfAborted();

  const browser = await puppeteer.launch({
    headless: "shell",
    signal: controller.signal,
  });
  closeBrowser = () => browser.close();
  controller.signal.addEventListener(
    "abort",
    () => {
      void closeBrowser?.().catch(() => {});
    },
    { once: true },
  );

  // Install interception before the CLI navigates or evaluates diagram content.
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async () => {
    const page = await newPage();

    await page.setRequestInterception(true);
    page.on(
      "request",
      (request: {
        url(): string;
        abort(reason: string, priority: number): Promise<void>;
        continue(overrides: object, priority: number): Promise<void>;
      }) => {
        return (async () => {
          const allowed = await allowedMermaidRequest(
            request.url(),
            entry,
            roots,
          );
          // Higher priority than the CLI's own packaged-asset interception.
          if (!allowed) await request.abort("blockedbyclient", 100);
          else await request.continue({}, -1);
        })()
          .catch(() => request.abort("blockedbyclient", 100))
          .catch(() => {});
      },
    );

    return page;
  };

  const { data } = await renderMermaid(browser, source, "png", {
    viewport: {
      width: Math.max(64, Math.min(2048, Math.round(width))),
      height: 600,
      deviceScaleFactor: 1,
    },
    backgroundColor: theme.background,
    mermaidConfig: {
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
      maxTextSize: mermaidLimits.source,
      maxEdges: 200,
      theme: "base",
      themeVariables: {
        darkMode: theme.name === "github-dark",
        background: theme.background,
        primaryColor: theme.surface,
        primaryTextColor: theme.text,
        primaryBorderColor: theme.diagram.accent,
        lineColor: theme.text,
        secondaryColor: theme.surface,
        tertiaryColor: theme.background,
        fontFamily: "sans-serif",
      },
    },
  });
  if (
    data.length > mermaidLimits.png ||
    Buffer.from(data).readUInt32BE(16) > mermaidLimits.dimension ||
    Buffer.from(data).readUInt32BE(20) > mermaidLimits.dimension
  )
    throw new Error("Mermaid image exceeds size limit");

  console.log(JSON.stringify({ png: Buffer.from(data).toString("base64") }));
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Mermaid worker failed",
  );
  console.log(
    JSON.stringify({
      error: controller.signal.aborted
        ? "Mermaid rendering timed out or was cancelled"
        : "Mermaid rendering failed; check diagram syntax and local browser installation",
    }),
  );
} finally {
  clearTimeout(timer);
  await closeBrowser?.().catch(() => {});
}
