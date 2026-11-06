import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { main, parseArgs } from "./cli";
import type { CollectedPullRequest } from ".";

const temp = await mkdtemp(join(tmpdir(), "review-collector-cli-"));
afterAll(() => rm(temp, { recursive: true, force: true }));
const snapshot = await Bun.file(
  resolve(import.meta.dir, "../../core/fixtures/valid.json"),
).json();
const collection: CollectedPullRequest = {
  pullRequest: snapshot.pullRequest,
  files: snapshot.files,
};
const collect = async () => collection;
const url = "https://github.com/example/project/pull/12";

test("collector retains stdout JSON and writes equivalent JSON with --output", async () => {
  const output = join(temp, "collection ' $.json");

  const stdout = await main([url], collect);
  const message = await main([url, "--output", output], collect);

  expect(JSON.parse(stdout)).toEqual(collection);
  expect(JSON.parse(await Bun.file(output).text())).toEqual(collection);
  expect(message).toContain(output);
  expect(message).not.toContain('"files"');
  expect(parseArgs([`--output=${output}`, url])).toEqual({
    help: false,
    url,
    output,
  });
});

test("failed collection never creates output and existing collections are not overwritten", async () => {
  const output = join(temp, "protected.json");
  await expect(
    main([url, "--output", output], async () => {
      throw new Error("authentication failed");
    }),
  ).rejects.toThrow("authentication failed");
  expect(await Bun.file(output).exists()).toBe(false);

  await writeFile(output, "original");

  await expect(main([url, "--output", output], collect)).rejects.toThrow(
    "Cannot write collection",
  );
  expect(await Bun.file(output).text()).toBe("original");
});

test("collector parses help without GitHub and rejects malformed output options", async () => {
  expect(
    await main(["--help"], async () => {
      throw new Error("unexpected collection");
    }),
  ).toContain("--output");

  for (const args of [
    [],
    [url, "--output"],
    [url, "--output="],
    [url, "--output", "--unknown"],
    [url, "--output", "a", "--output", "b"],
    [url, "another"],
    [url, "--unknown"],
  ]) {
    expect(() => parseArgs(args)).toThrow();
  }
});
