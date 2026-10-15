import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { runBrowser } from "../browser.mjs";
test(
  "real Chromium fixture records a missing validation message and screenshot",
  { skip: process.env.TEST_BROWSER !== "1" },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proofrun-browser-"));
    try {
      const r = await runBrowser({ check: "validation" }, dir, { demo: true });
      assert.equal(r.checks.find((c) => c.name === "Page loads").passed, true);
      assert.equal(
        r.checks.find((c) => c.name === "Form validation").passed,
        false,
      );
      assert.equal(r.console.length, 1);
      assert.ok((await stat(path.join(dir, "screenshot.png"))).size > 1000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
