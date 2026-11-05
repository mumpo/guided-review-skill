import { realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const mermaidLimits = {
  source: 32_768,
  png: 4 * 1024 * 1024,
  dimension: 4096,
  timeout: 15_000,
};

export function checkMermaidSource(source: string) {
  if (typeof source !== "string" || !source.trim())
    throw new Error("empty Mermaid diagram");
  if (source.length > mermaidLimits.source)
    throw new Error("Mermaid source exceeds 32,768 characters");
  if (/%%\s*\{|^\s*---/m.test(source))
    throw new Error("Mermaid configuration directives are unsupported");
}

/** The CLI's synthetic origin serves installed assets, never the network. */
export async function allowedMermaidRequest(
  address: string,
  entry: string,
  roots: string[],
) {
  try {
    const url = new URL(address);
    if (url.protocol === "file:")
      return (await realpath(fileURLToPath(url))) === entry;
    if (url.origin !== "https://mermaid-cli-intercept.invalid") return false;
    const target = await realpath(decodeURIComponent(url.pathname));
    return (
      /\.(?:css|m?js|woff2)$/.test(target) &&
      roots.some((root) => {
        const path = relative(root, target);
        return path !== ".." && !path.startsWith("../") && !isAbsolute(path);
      })
    );
  } catch {
    return false;
  }
}
