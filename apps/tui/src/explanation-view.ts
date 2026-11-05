import {
  BoxRenderable,
  type CliRenderer,
  ImageRenderable,
  imageInfo,
  type ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import {
  type DiagramRenderer,
  type ExplanationBlock,
  explanationBlocks,
  mermaidLimits,
  renderDiagram,
} from "./mermaid";
import type { Theme } from "./theme";

/** Diagram presentation only. Narrative remains literal Markdown until task 12. */
export class ExplanationView extends BoxRenderable {
  private blocks: { block: ExplanationBlock; node: BoxRenderable }[] = [];
  private controller = new AbortController();
  private cache = new Map<string, Uint8Array>();
  private signature = "";
  private timer?: ReturnType<typeof setTimeout>;
  private palette: Theme;
  private onFrame = () => {
    if (
      !this.timer &&
      this.blocks.some(({ block }) => block.kind === "mermaid") &&
      this.signature !== this.geometrySignature()
    )
      this.resizeLayout();
  };

  constructor(
    private renderer: CliRenderer,
    private body: ScrollBoxRenderable,
    theme: Theme,
    private render: DiagramRenderer = renderDiagram,
  ) {
    super(renderer, {
      id: "explanation",
      width: "100%",
      flexDirection: "column",
      flexShrink: 0,
    });
    this.palette = theme;
    // Pixel replies request a frame but do not emit a capabilities/resize event.
    renderer.on("frame", this.onFrame);
  }

  setContent(content: string) {
    this.controller.abort();
    for (const child of this.getChildren()) child.destroyRecursively();
    this.blocks = explanationBlocks(content).map((block) => {
      const node = new BoxRenderable(this.renderer, {
        width: "100%",
        flexDirection: "column",
        flexShrink: 0,
      });
      this.add(node);
      return { block, node };
    });
    this.refresh(true);
  }

  setTheme(theme: Theme) {
    this.palette = theme;
    this.refresh();
  }

  resizeLayout() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.refresh();
    }, 120);
  }

  private geometrySignature() {
    return JSON.stringify([this.palette.name, this.geometry()]);
  }

  private geometry() {
    const resolution = this.renderer.resolution;
    const columns = Math.max(1, this.renderer.width - 3);
    const cellWidth = resolution ? resolution.width / this.renderer.width : 0;
    const cellHeight = resolution
      ? resolution.height / this.renderer.height
      : 0;
    return {
      columns,
      cellWidth,
      cellHeight,
      supported:
        !!this.renderer.capabilities?.kitty_graphics &&
        cellWidth > 0 &&
        cellHeight > 0,
    };
  }

  private preserve(change: () => void) {
    // Native anchoring follows explicit user scrolls while a layout is pending.
    const top = this.body.viewport.y;
    const candidates = [
      ...this.blocks.map(({ node }) => node),
      ...this.body.getChildren().filter((node) => node !== this),
    ];
    const anchor = candidates.find(
      (node) => node.y <= top && node.y + node.height > top,
    );
    const release = anchor ? this.body.anchor(anchor) : undefined;
    change();
    if (release) this.body.afterLayout(release);
  }

  private text(node: BoxRenderable, content: string, diagram: boolean) {
    for (const child of node.getChildren()) child.destroyRecursively();
    node.add(
      new TextRenderable(this.renderer, {
        content,
        wrapMode: "word",
        flexShrink: 0,
        fg: diagram
          ? this.palette.diagram.foreground
          : this.palette.markdown.text,
        bg: diagram ? this.palette.diagram.background : this.palette.background,
      }),
    );
  }

  private refresh(force = false) {
    if (this.isDestroyed) return;
    const geometry = this.geometry();
    const signature = this.geometrySignature();
    if (!force && this.signature === signature) return;
    this.signature = signature;
    this.controller.abort();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.preserve(() => {
      for (const { node, block } of this.blocks) {
        const reason = geometry.supported
          ? "rendering"
          : "terminal graphics unavailable";
        this.text(
          node,
          block.raw +
            (block.kind === "mermaid" ? `\n[Mermaid source: ${reason}]\n` : ""),
          block.kind === "mermaid",
        );
      }
    });
    if (geometry.supported) void this.renderBlocks(signal, geometry);
  }

  private async renderBlocks(
    signal: AbortSignal,
    geometry: ReturnType<ExplanationView["geometry"]>,
  ) {
    for (const { node, block } of this.blocks) {
      if (signal.aborted) return;
      if (block.kind !== "mermaid") continue;
      try {
        const width = Math.min(
          2048,
          Math.round(geometry.columns * geometry.cellWidth),
        );
        const key = JSON.stringify([block.source, this.palette.name, width]);
        let png = this.cache.get(key);
        if (!png) {
          png = await this.render({
            source: block.source,
            theme: this.palette,
            width,
            signal,
          });
          if (signal.aborted) return;
          const info = imageInfo(png);
          if (
            png.length > mermaidLimits.png ||
            info.width > mermaidLimits.dimension ||
            info.height > mermaidLimits.dimension
          )
            throw new Error("Mermaid image exceeds size limit");
          this.cache.set(key, png);
          while (this.cache.size > 4)
            this.cache.delete(this.cache.keys().next().value as string);
        }
        if (signal.aborted) return;
        const info = imageInfo(png);
        const columns = Math.max(
          1,
          Math.min(
            geometry.columns,
            Math.ceil(info.width / geometry.cellWidth),
          ),
        );
        const height = Math.max(
          1,
          Math.ceil(
            (info.height * ((columns * geometry.cellWidth) / info.width)) /
              geometry.cellHeight,
          ),
        );
        this.preserve(() => {
          for (const child of node.getChildren()) child.destroyRecursively();
          node.add(
            new ImageRenderable(this.renderer, {
              source: png,
              width: columns,
              height,
              flexShrink: 0,
              fit: "fit",
              protocol: "kitty",
              onError: () => {
                if (!signal.aborted && !node.isDestroyed)
                  this.preserve(() =>
                    this.text(
                      node,
                      `${block.raw}\n[Mermaid source: image display failed]\n`,
                      true,
                    ),
                  );
              },
            }),
          );
        });
      } catch (error) {
        if (signal.aborted || node.isDestroyed) return;
        // Only our controlled diagnostics reach the terminal, never browser stderr.
        const reason =
          error instanceof Error &&
          /^(install Mermaid|Mermaid |empty Mermaid)/.test(error.message)
            ? error.message
            : "rendering failed";
        this.preserve(() =>
          this.text(node, `${block.raw}\n[Mermaid source: ${reason}]\n`, true),
        );
      }
    }
  }

  protected destroySelf() {
    this.renderer.off("frame", this.onFrame);
    clearTimeout(this.timer);
    this.controller.abort();
    this.cache.clear();
    super.destroySelf();
  }
}
