#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

function usage() {
  console.log("usage: generate_release_sbom.mjs --version <version> --output <file> <package-lock.json>...");
}

const args = process.argv.slice(2);
let version = "";
let output = "";
const lockfiles = [];
while (args.length > 0) {
  const argument = args.shift();
  if (argument === "--version") {
    version = args.shift() ?? "";
  } else if (argument === "--output") {
    output = args.shift() ?? "";
  } else if (argument === "-h" || argument === "--help") {
    usage();
    process.exit(0);
  } else {
    lockfiles.push(argument);
  }
}

if (!version || !output || lockfiles.length === 0) {
  usage();
  process.exit(2);
}

// purl names must be percent-encoded without double-encoding the npm scope marker.
// Encoding the whole name and then repairing "%40" with String.replace() only fixes
// the first occurrence and is flagged as incomplete sanitization (CodeQL
// js/incomplete-sanitization) — encode the parts instead.
function purlNpmName(name) {
  return name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
}

const components = [];
for (const lockfile of lockfiles.sort()) {
  const lock = JSON.parse(await readFile(lockfile, "utf8"));
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== "object") {
    throw new Error(`Unsupported npm lockfile: ${lockfile}`);
  }
  const lockSource = typeof lock.packages[""]?.name === "string" ? lock.packages[""].name : "unnamed-npm-package";
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || !path.includes("node_modules/") || !entry?.version) continue;
    const name = entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    const properties = [
      { name: "project-ambient:lockfile-package", value: lockSource },
    ];
    if (typeof entry.integrity === "string") properties.push({ name: "project-ambient:npm-integrity", value: entry.integrity });
    if (typeof entry.resolved === "string") properties.push({ name: "project-ambient:npm-resolved", value: entry.resolved });
    components.push({
      type: "library",
      name,
      version: String(entry.version),
      purl: `pkg:npm/${purlNpmName(name)}@${encodeURIComponent(String(entry.version))}`,
      properties,
    });
  }
}

components.sort((left, right) =>
  `${left.name}\u0000${left.version}\u0000${left.purl}`.localeCompare(`${right.name}\u0000${right.version}\u0000${right.purl}`),
);

const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    component: {
      type: "application",
      name: "Project Ambient",
      version,
    },
    tools: [{ vendor: "Project Ambient", name: "generate_release_sbom.mjs", version: "1" }],
  },
  components,
};

await writeFile(output, `${JSON.stringify(bom, null, 2)}\n`);
