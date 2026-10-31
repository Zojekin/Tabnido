import { build } from 'vite';
import { resolve } from 'node:path';

const root = process.cwd();

await build({
  configFile: false,
  root,
  base: './',
  build: {
    target: 'chrome120',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: resolve(root, 'popup.html') },
  },
});

for (const [entry, file] of [
  ['src/background/index.ts', 'background.js'],
  ['src/content/activity.ts', 'content-scripts/activity.js'],
  ['src/content/archive.ts', 'content-scripts/archive.js'],
]) {
  await build({
    configFile: false,
    root,
    publicDir: false,
    build: {
      target: 'chrome120',
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(root, entry),
        output: {
          format: 'iife',
          entryFileNames: file,
          extend: false,
        },
      },
    },
  });
}
