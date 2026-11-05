import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

const expected = [...await sourceFiles(join(frontendRoot, "src")), join(frontendRoot, "vite.config.ts")];
const eslint = new ESLint({ cwd: frontendRoot });
const results = await eslint.lintFiles(["."]);
const discovered = new Set(results.map((result) => resolve(result.filePath)));
assert.deepEqual(
  expected.filter((path) => !discovered.has(path)),
  [],
  "ESLint discovery must include every TypeScript source and config file.",
);

for (const directory of ["dist", "coverage"]) {
  assert.equal(await eslint.isPathIgnored(join(frontendRoot, directory, "lint-probe.tsx")), true);
}

const [probe] = await eslint.lintText("const unusedLintProbe = 1;\n", {
  filePath: join(frontendRoot, "src", "lint-probe.ts"),
});
assert.ok(
  probe.messages.some((message) => message.ruleId === "@typescript-eslint/no-unused-vars" && message.severity === 2),
  "TypeScript lint violations must still be reported after dependency updates.",
);
console.log(`Lint configuration passed: ${expected.length} TS/TSX files, output ignores, and rule activation.`);
