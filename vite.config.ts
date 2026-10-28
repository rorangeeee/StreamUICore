import { defineConfig } from 'vite';
export default defineConfig({
  build: { rollupOptions: {
    input: { output: 'index.html', config: 'config.html', sdk: 'src/sdk/index.ts' },
    preserveEntrySignatures: 'strict',
    output: { entryFileNames: chunk => chunk.name === 'sdk' ? 'sdk/streamui.js' : 'assets/[name]-[hash].js' },
  } },
  server: { host: '127.0.0.1', port: 5373, strictPort: true, proxy: {
    '/api': { target: 'http://127.0.0.1:5281' },
    '/user': { target: 'http://127.0.0.1:5280' },
    '/ws': { target: 'ws://127.0.0.1:5280', ws: true },
  } },
});
