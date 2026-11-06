import { main } from "../../../packages/collector/src/cli";

try {
  console.log(await main());
} catch (error) {
  console.error(
    `Collection failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
