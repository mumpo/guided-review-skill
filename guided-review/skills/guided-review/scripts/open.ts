import { main } from "../../../apps/launcher/src";

try {
  await main();
} catch (error) {
  console.error(
    `Launch failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
