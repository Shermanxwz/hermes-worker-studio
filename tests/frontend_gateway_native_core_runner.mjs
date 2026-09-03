import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(testsDir, 'frontend_gateway_native.mjs');
const generatedPath = path.join(testsDir, '.frontend_gateway_native_core.generated.mjs');
const original = await fs.readFile(sourcePath, 'utf8');
const needle = "path.join(root, 'dashboard/dist/gateway-native.js')";
assert.equal(original.split(needle).length - 1, 1, 'gateway-native source path contract changed');
const projected = original.replace(needle, "path.join(root, 'dashboard/dist/gateway-native-core.js')");
await fs.writeFile(generatedPath, projected, 'utf8');
try {
  await import(`${pathToFileURL(generatedPath).href}?seal=${Date.now()}`);
} finally {
  await fs.rm(generatedPath, { force: true });
}
