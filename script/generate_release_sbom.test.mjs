import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("./generate_release_sbom.mjs", import.meta.url).pathname;

function run(lock, version = "9.9.9") {
  const dir = mkdtempSync(join(tmpdir(), "sbom-"));
  const lockfile = join(dir, "package-lock.json");
  const out = join(dir, "sbom.json");
  writeFileSync(lockfile, JSON.stringify(lock));
  execFileSync("node", [script, "--version", version, "--output", out, lockfile], { encoding: "utf8" });
  return JSON.parse(readFileSync(out, "utf8"));
}

const lock = {
  lockfileVersion: 3,
  packages: {
    "": { name: "demo" },
    "node_modules/@scope/name": { name: "@scope/name", version: "1.2.3", integrity: "sha512-x" },
    "node_modules/lodash": { name: "lodash", version: "4.17.21" }
  }
};

test("scoped and unscoped npm components keep the purl the pre-fix generator emitted", () => {
  const bom = run(lock);
  const byName = Object.fromEntries(bom.components.map((c) => [c.name, c]));
  assert.equal(byName["@scope/name"].purl, "pkg:npm/@scope%2Fname@1.2.3");
  assert.equal(byName["lodash"].purl, "pkg:npm/lodash@4.17.21");
});

test("the generator stays deterministic across runs", () => {
  assert.deepEqual(run(lock), run(lock));
});

test("an unsupported lockfile version is rejected", () => {
  assert.throws(() => run({ lockfileVersion: 2, packages: {} }), /Unsupported npm lockfile/);
});
