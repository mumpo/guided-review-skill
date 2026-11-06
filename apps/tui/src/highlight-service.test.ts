import { expect, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { Worker } from "node:worker_threads";
import { createSyntaxEngine, grammarLoaders } from "./highlight-engine";
import { HighlightService } from "./highlight-service";
import type { SourceColors } from "./highlight";

function colors(source: string): SourceColors {
  const lines = source.split("\n").map((text) => [{ text, color: "#123456" }]);

  return { "github-light": lines, "github-dark": lines };
}

class FakeWorker extends EventEmitter {
  sent: { id: number; source: string; language: string }[] = [];
  stopped = false;

  postMessage(message: (typeof this.sent)[number]) {
    this.sent.push(message);
  }

  reply(value?: SourceColors) {
    const request = this.sent[this.sent.length - 1];

    this.emit("message", {
      id: request.id,
      colors: value ?? colors(request.source),
    });
  }

  async terminate() {
    this.stopped = true;
    return 0;
  }
}

function setup(entries = 128, bytes = 16 * 1024 * 1024) {
  const worker = new FakeWorker();
  let starts = 0;
  const service = new HighlightService(entries, bytes, () => {
    starts++;
    return worker as unknown as Worker;
  });

  return { service, worker, starts: () => starts };
}

test("worker is lazy, requests deduplicate, and completed results reuse the exact-source cache", async () => {
  const { service, worker, starts } = setup();

  try {
    expect(starts()).toBe(0);
    expect(await service.highlight("plain", undefined)).toBeUndefined();
    expect(await service.highlight("plain", "constructor")).toBeUndefined();
    expect(starts()).toBe(0);

    const first = service.highlight("const answer = 42;", "typescript");
    const second = service.highlight("const answer = 42;", "typescript");

    expect(starts()).toBe(1);
    expect(worker.sent).toHaveLength(1);
    worker.reply();

    expect(await first).toEqual(await second);
    expect(await service.highlight("const answer = 42;", "typescript")).toEqual(
      await first,
    );
    expect(worker.sent).toHaveLength(1);

    const otherLanguage = service.highlight("const answer = 42;", "javascript");
    worker.reply();
    await otherLanguage;

    expect(worker.sent).toHaveLength(2);
  } finally {
    service.dispose();
  }
});

test("navigation removes obsolete queued work and canceled listeners ignore active replies", async () => {
  const { service, worker } = setup();
  const oldPage = new AbortController();

  try {
    const active = service.highlight("old", "typescript", oldPage.signal);
    const queued = service.highlight("obsolete", "python", oldPage.signal);
    oldPage.abort();
    const current = service.highlight("current", "typescript");
    const settled = service.settled();

    expect(await active).toBeUndefined();
    expect(await queued).toBeUndefined();
    worker.reply();

    expect(worker.sent.map((request) => request.source)).toEqual([
      "old",
      "current",
    ]);
    worker.reply();

    expect(await current).toEqual(colors("current"));
    await settled;
  } finally {
    service.dispose();
  }
});

test("cache eviction follows recent use and oversized results are not cached", async () => {
  const { service, worker } = setup(2);

  try {
    for (const source of ["one", "two"]) {
      const result = service.highlight(source, "typescript");
      worker.reply();
      await result;
    }
    await service.highlight("one", "typescript");
    const third = service.highlight("three", "typescript");
    worker.reply();
    await third;
    await service.highlight("one", "typescript");

    expect(worker.sent).toHaveLength(3);
    const evicted = service.highlight("two", "typescript");
    worker.reply();
    await evicted;

    expect(worker.sent).toHaveLength(4);
  } finally {
    service.dispose();
  }

  const small = setup(128, 1);
  try {
    for (let i = 0; i < 2; i++) {
      const result = small.service.highlight("large", "typescript");
      small.worker.reply();
      await result;
    }
    expect(small.worker.sent).toHaveLength(2);
  } finally {
    small.service.dispose();
  }
});

test("invalid worker tokens fall back, and worker failure settles all work without restarting", async () => {
  const { service, worker, starts } = setup();
  const malformed = service.highlight("original", "typescript");
  worker.reply(colors("changed"));

  expect(await malformed).toBeUndefined();
  expect(await service.highlight("original", "typescript")).toBeUndefined();
  expect(worker.sent).toHaveLength(1);

  const active = service.highlight("active", "typescript");
  const queued = service.highlight("queued", "python");
  worker.emit("error", new Error("failed"));

  expect(await active).toBeUndefined();
  expect(await queued).toBeUndefined();
  expect(await service.highlight("later", "typescript")).toBeUndefined();
  expect(worker.stopped).toBe(true);
  expect(starts()).toBe(1);
  service.dispose();
});

test("engine loads requested grammars once and includes required HTML dependencies", async () => {
  const ts = spyOn(grammarLoaders, "typescript");
  const python = spyOn(grammarLoaders, "python");
  const html = spyOn(grammarLoaders, "html");
  const js = spyOn(grammarLoaders, "javascript");
  const engine = createSyntaxEngine();

  try {
    expect(await engine('const value = "old";', "typescript")).toBeDefined();
    const second = await engine('const value = "new";', "typescript");

    expect(ts).toHaveBeenCalledTimes(1);
    expect(python).not.toHaveBeenCalled();
    expect(
      second?.["github-light"].flat().some((span) => span.text === '"new"'),
    ).toBe(true);

    expect(await engine("<script>const x = 1;</script>", "html")).toBeDefined();
    expect(await engine("const x = 1;", "javascript")).toBeDefined();
    expect(html).toHaveBeenCalledTimes(1);
    expect(js).not.toHaveBeenCalled();
    expect(await engine("unknown", "constructor")).toBeUndefined();
  } finally {
    ts.mockRestore();
    python.mockRestore();
    html.mockRestore();
    js.mockRestore();
  }
});

test("real worker highlights offline and disposal releases pending requests", async () => {
  const service = new HighlightService();

  try {
    const result = await service.highlight(
      'const value = "hello";',
      "typescript",
    );

    expect(
      result?.["github-light"]
        .flat()
        .map((span) => span.text)
        .join(""),
    ).toBe('const value = "hello";');
    expect(
      result?.["github-dark"].flat().some((span) => span.color === "#A5D6FF"),
    ).toBe(true);

    const pending = service.highlight("def hello(): return 42", "python");
    service.dispose();

    expect(await pending).toBeUndefined();
    await service.settled();
  } finally {
    service.dispose();
  }
});

test("failed grammar imports are not retried and other languages keep working", async () => {
  const python = spyOn(grammarLoaders, "python").mockRejectedValue(
    new Error("missing grammar"),
  );
  const engine = createSyntaxEngine();

  try {
    expect(await engine("def first(): pass", "python")).toBeUndefined();
    expect(await engine("def second(): pass", "python")).toBeUndefined();
    expect(python).toHaveBeenCalledTimes(1);
    expect(await engine('{"ok": true}', "json")).toBeDefined();
  } finally {
    python.mockRestore();
  }
});

test("startup warm-up reuses samples and visible requests jump ahead of queued languages", async () => {
  const { service, worker, starts } = setup();

  try {
    service.preload([
      { source: "first", language: "typescript" },
      { source: "background", language: "python" },
      { source: "current", language: "rust" },
    ]);
    expect(starts()).toBe(1);
    expect(worker.sent.map(({ source }) => source)).toEqual(["first"]);

    const visible = service.highlight("current", "rust");
    worker.reply();

    expect(worker.sent.map(({ source }) => source)).toEqual([
      "first",
      "current",
    ]);
    worker.reply();
    expect(await visible).toEqual(colors("current"));
    expect(worker.sent.map(({ source }) => source)).toEqual([
      "first",
      "current",
      "background",
    ]);
    worker.reply();
    await service.settled();
    expect(await service.highlight("first", "typescript")).toEqual(
      colors("first"),
    );
    expect(worker.sent).toHaveLength(3);
  } finally {
    service.dispose();
  }
});
