import { expect, test } from "bun:test";
import { NativeImage } from "@opentui/core";
import { renderDiagram } from "./mermaid";
import { themes } from "./theme";

// Explicit opt-in: the ordinary offline suite requires neither mmdc nor a browser.
test.skipIf(process.env.GUIDED_REVIEW_MERMAID_INTEGRATION !== "1")(
  "local Mermaid worker renders flowchart and sequence fixtures in both themes, rejects malformed source, and cancels",
  async () => {
    for (const theme of Object.values(themes)) {
      for (const source of [
        "flowchart LR\n A[Captured diff] --> B[Explanation] --> C[Review]",
        "sequenceDiagram\n participant Agent\n participant Viewer\n Agent->>Viewer: Offline snapshot\n Viewer-->>Agent: Read only walkthrough",
      ]) {
        const png = await renderDiagram({
          source,
          theme,
          width: 640,
          signal: new AbortController().signal,
        });
        const image = NativeImage.decode(png);

        try {
          expect(image.width).toBeGreaterThan(20);
          expect(image.height).toBeGreaterThan(20);

          const pixel = image.raw().data.slice(0, 3);

          expect([...pixel]).toEqual(
            [1, 3, 5].map((offset) =>
              Number.parseInt(theme.background.slice(offset, offset + 2), 16),
            ),
          );
        } finally {
          image.dispose();
        }
      }
    }

    const request = {
      theme: themes["github-dark"],
      width: 640,
      signal: new AbortController().signal,
    };

    await expect(
      renderDiagram({ ...request, source: "this is not a Mermaid diagram" }),
    ).rejects.toThrow("Mermaid rendering failed");
    await expect(
      renderDiagram({
        ...request,
        source: "flowchart LR\nA-->B",
        signal: AbortSignal.timeout(100),
      }),
    ).rejects.toThrow();
  },
  45_000,
);
