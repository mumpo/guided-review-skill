import { parentPort } from "node:worker_threads";
import { createSyntaxEngine } from "./highlight-engine";

const highlight = createSyntaxEngine();

parentPort?.on(
  "message",
  async ({
    id,
    source,
    language,
  }: {
    id: number;
    source: string;
    language: string;
  }) => {
    const colors = await highlight(source, language);
    parentPort?.postMessage({ id, colors });
  },
);
