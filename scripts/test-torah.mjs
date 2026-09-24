import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const resolverPath = path.resolve(__dirname, 'torah-resolver.mjs');
const testSuitePath = path.resolve(__dirname, 'test-torah-suite.mjs');

const res = spawnSync(process.execPath, [
  '--experimental-strip-types',
  '--loader',
  `file:///${resolverPath.replace(/\\/g, '/')}`,
  testSuitePath,
], {
  stdio: 'inherit',
  cwd: repoRoot,
});

process.exit(res.status ?? 0);
