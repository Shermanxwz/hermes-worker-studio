import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(testsDir, 'frontend_product_v3.mjs');
const generatedPath = path.join(testsDir, '.frontend_product_v3_core.generated.mjs');
const original = await fs.readFile(sourcePath, 'utf8');
const needle = "fs.readFile(path.join(root, 'dashboard/dist/gateway-native.js'), 'utf8')";
assert.equal(original.split(needle).length - 1, 1, 'Product 3 Gateway source-path contract changed');
const projected = original.replace(
  needle,
  "fs.readFile(path.join(root, 'dashboard/dist/gateway-native-core.js'), 'utf8')",
);
await fs.writeFile(generatedPath, projected, 'utf8');
try {
  await import(`${pathToFileURL(generatedPath).href}?seal=${Date.now()}`);
} finally {
  await fs.rm(generatedPath, { force: true });
}
