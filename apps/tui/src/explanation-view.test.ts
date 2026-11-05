import { expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import {
  ImageRenderable,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import {
  createTestRenderer,
  setRendererCapabilities,
} from "@opentui/core/testing";
import { ExplanationView } from "./explanation-view";
import type { DiagramRequest } from "./mermaid";
import { themes } from "./theme";

// Deterministic tall PNG, generated locally without browser or image dependencies.
function png() {
  function chunk(type: string, data: Buffer) {
    const body = Buffer.concat([Buffer.from(type), data]);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(Bun.hash.crc32(body));
    return Buffer.concat([size, body, crc]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(80, 0);
  header.writeUInt32BE(800, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc(800 * (80 * 4 + 1), 255);
  for (let y = 0; y < 800; y++) pixels[y * (80 * 4 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const content =
  "# Before\n**formatted narrative**\n```mermaid\nflowchart LR\nA-->B\n```\nAfter";
function deferred() {
  let resolve!: (value: Uint8Array) => void;
  const promise = new Promise<Uint8Array>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const theme of Object.values(themes)) {
  test(`${theme.name}: unsupported graphics preserve ordered fenced source and never invoke the renderer`, async () => {
    const ui = await createTestRenderer({ width: 60, height: 15 });
    try {
      const body = new ScrollBoxRenderable(ui.renderer, {
        width: "100%",
        height: "100%",
        scrollY: true,
      });
      ui.renderer.root.add(body);
      const view = new ExplanationView(ui.renderer, body, theme, async () => {
        throw new Error("must not render");
      });
      body.add(view);
      view.setContent(content);
      await ui.renderOnce();
      const frame = ui.captureCharFrame();
      expect(frame).toContain("```mermaid");
      expect(frame).not.toContain("# Before");
      expect(frame).not.toContain("**formatted narrative**");
      expect(frame).toContain("formatted narrative");
      expect(frame).toContain("A-->B");
      expect(frame.indexOf("Before")).toBeLessThan(frame.indexOf("After"));
      expect(frame).toContain("terminal graphics unavailable");
      ui.resize(30, 15);
      view.resizeLayout();
      await new Promise((resolve) => setTimeout(resolve, 130));
      await ui.renderOnce();
      expect(ui.captureCharFrame()).toContain("A-->B");
    } finally {
      await ui.dispose();
    }
  });

  test(`${theme.name}: Kitty images scroll, clip, resize, cache, recolor, and release on navigation`, async () => {
    const ui = await createTestRenderer({ width: 60, height: 15 });
    try {
      Object.defineProperty(ui.renderer, "resolution", {
        configurable: true,
        get: () => ({
          width: ui.renderer.width * 8,
          height: ui.renderer.height * 16,
        }),
      });
      setRendererCapabilities(ui.renderer, { kitty_graphics: true });
      const body = new ScrollBoxRenderable(ui.renderer, {
        width: "100%",
        height: 12,
        scrollY: true,
      });
      ui.renderer.root.add(body);
      const footer = new TextRenderable(ui.renderer, {
        content: "Fixed footer",
        height: 1,
        position: "absolute",
        top: 13,
      });
      ui.renderer.root.add(footer);
      const requests: DiagramRequest[] = [];
      const view = new ExplanationView(
        ui.renderer,
        body,
        theme,
        async (request) => {
          requests.push(request);
          return png();
        },
      );
      body.add(view);
      view.setContent(content);
      await ui.waitFor(() =>
        view
          .getChildren()
          .some((block) =>
            block
              .getChildren()
              .some((node) => node instanceof ImageRenderable && !node.loading),
          ),
      );
      await ui.renderOnce();
      const images = () =>
        view
          .getChildren()
          .flatMap((node) => node.getChildren())
          .filter((node) => node instanceof ImageRenderable);
      const image = images()[0];
      expect(image.effectiveProtocol).toBe("kitty");
      expect(image.height).toBe(50);
      expect(ui.captureCharFrame()).toContain("Fixed footer");
      expect(ui.captureCharFrame()).not.toContain("After");
      const initialY = image.y;
      body.scrollBy(8);
      await ui.renderOnce();
      expect(image.y).toBe(initialY - 8);
      expect(ui.captureCharFrame()).toContain("Fixed footer");
      body.scrollTo(Infinity);
      await ui.renderOnce();
      expect(ui.captureCharFrame()).toContain("After");
      view.setTheme(theme);
      await ui.renderOnce();
      expect(requests).toHaveLength(1);
      ui.resize(35, 15);
      view.resizeLayout();
      await new Promise((resolve) => setTimeout(resolve, 130));
      await ui.waitFor(
        () =>
          requests.length === 2 &&
          images().length === 1 &&
          !images()[0].loading,
      );
      expect(image.isDestroyed).toBe(true);
      const otherTheme =
        theme.name === "github-light"
          ? themes["github-dark"]
          : themes["github-light"];
      view.setTheme(otherTheme);
      await ui.waitFor(
        () =>
          requests.length === 3 &&
          images().length === 1 &&
          !images()[0].loading,
      );
      expect(requests[2].theme).toBe(otherTheme);
      view.setTheme(theme);
      await ui.waitFor(() => images().length === 1 && !images()[0].loading);
      expect(requests).toHaveLength(3);
      const last = images()[0];
      view.setContent("Next section");
      await ui.renderOnce();
      expect(last.isDestroyed).toBe(true);
      expect(ui.captureCharFrame()).toContain("Next section");
      expect(requests.every((request) => request.signal.aborted)).toBe(true);
    } finally {
      await ui.dispose();
    }
  });
}

test("stale render results cannot overwrite a new page; malformed images and dependencies retain source", async () => {
  const ui = await createTestRenderer({ width: 80, height: 20 });
  try {
    Object.defineProperty(ui.renderer, "resolution", {
      get: () => ({ width: 640, height: 320 }),
    });
    setRendererCapabilities(ui.renderer, { kitty_graphics: true });
    const body = new ScrollBoxRenderable(ui.renderer, {
      width: "100%",
      height: "100%",
    });
    ui.renderer.root.add(body);
    const pending = deferred();
    let request: DiagramRequest | undefined;
    const view = new ExplanationView(
      ui.renderer,
      body,
      themes["github-dark"],
      async (value) => {
        request = value;
        return pending.promise;
      },
    );
    body.add(view);
    view.setContent(content);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("rendering");
    view.setContent("New page");
    pending.resolve(png());
    await ui.renderOnce();
    expect(request?.signal.aborted).toBe(true);
    expect(ui.captureCharFrame()).toContain("New page");
    expect(ui.captureCharFrame()).not.toContain("Before");
    view.destroyRecursively();
    for (const failure of [
      "install Mermaid CLI and its browser",
      "Mermaid rendering timed out",
      "Mermaid syntax error",
      "unknown browser error",
    ]) {
      const failed = new ExplanationView(
        ui.renderer,
        body,
        themes["github-dark"],
        async () => {
          throw new Error(failure);
        },
      );
      body.add(failed);
      failed.setContent(content);
      await ui.waitForFrame(
        (frame) =>
          frame.includes("Mermaid source:") &&
          !frame.includes("source: rendering]"),
      );
      expect(ui.captureCharFrame()).toContain("A-->B");
      expect(ui.captureCharFrame()).toContain("After");
      failed.destroyRecursively();
    }
    const invalid = new ExplanationView(
      ui.renderer,
      body,
      themes["github-dark"],
      async () => new Uint8Array([0]),
    );
    body.add(invalid);
    invalid.setContent(content);
    await ui.waitForFrame((frame) =>
      frame.includes("source: rendering failed"),
    );
  } finally {
    await ui.dispose();
  }
});

test("late pixel replies enable graphics and asynchronous images preserve scrolled narrative", async () => {
  const ui = await createTestRenderer({ width: 60, height: 15 });
  try {
    let resolution: { width: number; height: number } | null = null;
    Object.defineProperty(ui.renderer, "resolution", { get: () => resolution });
    setRendererCapabilities(ui.renderer, { kitty_graphics: true });
    const body = new ScrollBoxRenderable(ui.renderer, {
      width: "100%",
      height: 12,
      scrollY: true,
    });
    ui.renderer.root.add(body);
    const pending = deferred();
    let called = false;
    const view = new ExplanationView(
      ui.renderer,
      body,
      themes["github-dark"],
      async () => {
        called = true;
        return pending.promise;
      },
    );
    body.add(view);
    view.setContent(
      content +
        Array.from({ length: 80 }, (_, i) => `\nNarrative line ${i}`).join(""),
    );
    await ui.renderOnce();
    expect(called).toBe(false);
    resolution = { width: 480, height: 240 };
    await ui.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 140));
    await ui.renderOnce();
    expect(called).toBe(true);
    body.scrollTo(22);
    await ui.renderOnce();
    const before = ui.captureCharFrame();
    expect(before).toContain("Narrative line");
    pending.resolve(png());
    await ui.waitFor(() =>
      view
        .getChildren()
        .some((block) =>
          block
            .getChildren()
            .some((node) => node instanceof ImageRenderable && !node.loading),
        ),
    );
    await ui.renderOnce();
    const narrative = (frame: string) =>
      frame
        .split("\n")
        .map((line) => line.slice(0, -2).trimEnd())
        .join("\n");
    expect(narrative(ui.captureCharFrame())).toBe(narrative(before));
    view.destroyRecursively();
    expect(ui.renderer.listenerCount("frame")).toBe(0);
  } finally {
    await ui.dispose();
  }
});
