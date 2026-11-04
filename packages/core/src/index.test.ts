import { expect, test } from "bun:test";
import * as core from "./index";

test("the core package can be imported", () => {
  expect(core).toBeDefined();
});
