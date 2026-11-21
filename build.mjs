import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const base = fileURLToPath(new URL('.', import.meta.url));
const entries = [
  ['src/runtime.js', 'dist/index.mjs'],
  ['src/studio.jsx', 'dist/studio.js'],
];
for (const [entry, outfile] of entries) {
  await build({
    absWorkingDir: base,
    entryPoints: [entry],
    outfile,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    bundle: true,
    external: ['react', '@avg-studio/sdk', '@avg-studio/studio-ui'],
  });
}
