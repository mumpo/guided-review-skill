import { collectPullRequest } from "./index";

if (process.argv.length !== 3) {
  console.error(
    "Usage: bun run collect <https://github.com/OWNER/REPO/pull/NUMBER>",
  );
  process.exitCode = 1;
} else {
  try {
    console.log(
      JSON.stringify(await collectPullRequest(process.argv[2]), null, 2),
    );
  } catch (error) {
    console.error(
      `Collection failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
