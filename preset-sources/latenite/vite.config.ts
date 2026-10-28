import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({ root, base: './', build: {
  outDir: '../../presets/latenite/ui', emptyOutDir: true, target: 'es2022',
  rollupOptions: { input: root + 'index.html' },
} });
