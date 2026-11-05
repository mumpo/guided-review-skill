import { expect, spyOn, test } from "bun:test";
import {
  checkMermaidSource,
  explanationBlocks,
  renderDiagram,
} from "./mermaid";
import { themes } from "./theme";
import { allowedMermaidRequest } from "./mermaid-policy";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const diagrams = [
  "flowchart LR\n A[Captured diff] --> B[Explanation] --> C[Review]",
  "sequenceDiagram\n participant Agent\n participant Viewer\n Agent->>Viewer: Offline snapshot\n Viewer-->>Agent: Read only walkthrough",
];

test("Mermaid fences preserve source and text order without inspecting other code fences", () => {
  const source = `Before\r\n\`\`\`mermaid\r\n${diagrams[0]}\r\n\`\`\`\r\nBetween\n~~~mermaid\n${diagrams[1]}\n~~~~\nAfter`;
  const blocks = explanationBlocks(source);
  expect(blocks.map((block) => block.kind)).toEqual([
    "text",
    "mermaid",
    "text",
    "mermaid",
    "text",
  ]);
  expect(blocks.map((block) => block.raw).join("")).toBe(source);
  expect(blocks[1]).toMatchObject({ source: `${diagrams[0]}\r\n` });
  for (const text of [
    "```mermaid\nflowchart LR\nA-->B",
    "````markdown\n```mermaid\nA-->B\n```\n````",
    "    ```mermaid\n    A-->B\n    ```",
    "> ```mermaid\n> A-->B\n> ```",
    "```javascript\nmermaid()\n```",
  ])
    expect(explanationBlocks(text)).toEqual([{ kind: "text", raw: text }]);
  expect(
    explanationBlocks("  ```mermaid\n  flowchart LR\n  A-->B\n  ```")[0],
  ).toMatchObject({ source: "flowchart LR\nA-->B\n" });
  expect(explanationBlocks("")).toEqual([]);
});

test("captured configuration and excessive diagrams are rejected before spawning a worker", () => {
  for (const source of [
    "",
    "x".repeat(32_769),
    "%%{init: {securityLevel: 'loose'}}%%\nflowchart LR\nA-->B",
    "---\nconfig:\n theme: dark\n---\nflowchart LR\nA-->B",
  ]) {
    expect(() => checkMermaidSource(source)).toThrow();
  }
  diagrams.forEach(checkMermaidSource);
});

test("missing optional CLI and cancellation have explicit failures", async () => {
  const which = spyOn(Bun, "which").mockReturnValue(null);
  try {
    const request = {
      source: diagrams[0],
      width: 640,
      theme: themes["github-light"],
      signal: new AbortController().signal,
    };
    await expect(renderDiagram(request)).rejects.toThrow("install Mermaid CLI");
    await expect(
      renderDiagram({ ...request, signal: AbortSignal.abort() }),
    ).rejects.toThrow();
  } finally {
    which.mockRestore();
  }
});

test("resource policy allows packaged assets and denies network, sibling paths, and symlink escapes", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "guided-review-mermaid-policy-"),
  );
  try {
    const root = join(directory, "assets");
    await mkdir(root);
    await mkdir(join(directory, "assets-escape"));
    const entry = join(root, "index.html");
    const asset = join(root, "mermaid.mjs");
    const outside = join(directory, "assets-escape", "secret.mjs");
    await Promise.all([
      writeFile(entry, ""),
      writeFile(asset, ""),
      writeFile(outside, ""),
      writeFile(join(root, "secret.json"), "{}"),
    ]);
    await symlink(outside, join(root, "escape.mjs"));
    const roots = [await realpath(root)];
    const origin = "https://mermaid-cli-intercept.invalid";
    const html = await realpath(entry);
    expect(
      await allowedMermaidRequest(pathToFileURL(html).href, html, roots),
    ).toBe(true);
    expect(
      await allowedMermaidRequest(
        `${origin}${await realpath(asset)}`,
        html,
        roots,
      ),
    ).toBe(true);
    for (const address of [
      "https://example.com/image.png",
      "http://127.0.0.1:1234/",
      "data:text/html,hello",
      "javascript:alert(1)",
      pathToFileURL(asset).href,
      `${origin}${outside}`,
      `${origin}${root}/escape.mjs`,
      `${origin}${root}/secret.json`,
      `${origin}${root}/missing.mjs`,
    ])
      expect(await allowedMermaidRequest(address, html, roots)).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
