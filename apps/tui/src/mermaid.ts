import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Theme } from "./theme";
import { checkMermaidSource, mermaidLimits } from "./mermaid-policy";
export { checkMermaidSource, mermaidLimits } from "./mermaid-policy";

export type ExplanationBlock =
  | { kind: "text"; raw: string }
  | { kind: "mermaid"; raw: string; source: string };

/** Only top-level, closed fences are eligible. Other fenced code is opaque. */
export function explanationBlocks(text: string): ExplanationBlock[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const blocks: ExplanationBlock[] = [];
  let pending = "";
  for (let index = 0; index < lines.length; index++) {
    const open = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)\r?\n?$/.exec(lines[index]);
    if (!open || (open[2][0] === "`" && open[3].includes("`"))) {
      pending += lines[index];
      continue;
    }
    const end = new RegExp(
      `^ {0,3}${open[2][0]}{${open[2].length},}[ \\t]*\\r?\\n?$`,
    );
    let last = index + 1;
    while (last < lines.length && !end.test(lines[last])) last++;
    if (last === lines.length) {
      pending += lines.slice(index).join("");
      break;
    }
    const raw = lines.slice(index, last + 1).join("");
    if (open[3].trim() === "mermaid") {
      if (pending) blocks.push({ kind: "text", raw: pending });
      pending = "";
      blocks.push({
        kind: "mermaid",
        raw,
        source: lines
          .slice(index + 1, last)
          .map((line) =>
            line.replace(new RegExp(`^ {0,${open[1].length}}`), ""),
          )
          .join(""),
      });
    } else pending += raw;
    index = last;
  }
  if (pending) blocks.push({ kind: "text", raw: pending });
  return blocks;
}

export type DiagramRequest = {
  source: string;
  theme: Theme;
  width: number;
  signal: AbortSignal;
};
export type DiagramRenderer = (request: DiagramRequest) => Promise<Uint8Array>;

let workerModule: Promise<Blob> | undefined;
function compiledWorker(): Promise<Blob> {
  // Compile our trusted TypeScript adapter once; captured Mermaid remains data.
  workerModule ??= Bun.build({
    entrypoints: [
      fileURLToPath(new URL("./mermaid-worker.ts", import.meta.url)),
    ],
    target: "node",
    format: "esm",
  }).then((result) => {
    if (!result.success) throw new Error("Mermaid worker compilation failed");
    return result.outputs[0];
  });
  return workerModule;
}

async function boundedRead(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Mermaid worker output exceeds limit");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString();
  } finally {
    reader.releaseLock();
  }
}

/** Optional local installation only; no npx, package downloads, or shell interpolation. */
export const renderDiagram: DiagramRenderer = async ({
  source,
  theme,
  width,
  signal,
}) => {
  checkMermaidSource(source);
  signal.throwIfAborted();
  const executable = Bun.which("mmdc");
  if (!executable)
    throw new Error("install Mermaid CLI and its browser to render diagrams");
  const cli = await realpath(executable);
  const node = Bun.which("node");
  if (!node)
    throw new Error("install Mermaid CLI and Node.js to render diagrams");
  signal.throwIfAborted();
  const module = await compiledWorker();
  signal.throwIfAborted();
  const directory = await mkdtemp(
    join(tmpdir(), "guided-review-mermaid-worker-"),
  );
  const workerPath = join(directory, "worker.mjs");
  try {
    await Bun.write(workerPath, module);
    signal.throwIfAborted();
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  let child: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>;
  try {
    child = Bun.spawn([node, workerPath], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  let forced: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (child.exitCode !== null || forced) return;
    child.kill("SIGTERM");
    forced = setTimeout(() => child.kill("SIGKILL"), 2000);
    forced.unref();
  };
  signal.addEventListener("abort", stop, { once: true });
  const timeout = setTimeout(stop, mermaidLimits.timeout + 2000);
  try {
    child.stdin.write(JSON.stringify({ cli, source, theme, width }));
    child.stdin.end();
    const [output, , code] = await Promise.all([
      boundedRead(child.stdout, Math.ceil((mermaidLimits.png * 4) / 3) + 4096),
      boundedRead(child.stderr, 16_384),
      child.exited,
    ]);
    signal.throwIfAborted();
    if (code !== 0)
      throw new Error(
        "Mermaid renderer failed or timed out; check the local CLI/browser installation",
      );
    const result = JSON.parse(output);
    if (typeof result.error === "string") throw new Error(result.error);
    if (typeof result.png !== "string")
      throw new Error("invalid Mermaid renderer output");
    return Buffer.from(result.png, "base64");
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", stop);
    stop();
    void child.exited
      .finally(async () => {
        clearTimeout(forced);
        await rm(directory, { recursive: true, force: true });
      })
      .catch(() => {});
  }
};
