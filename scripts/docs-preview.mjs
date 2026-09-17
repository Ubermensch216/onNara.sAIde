// Documentation-only preview. Never included in the extension build.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({
  configFile: false,
  root: `${root}/docs/preview`,
  plugins: [react()],
  resolve: { alias: { '@': `${root}/src` } },
  server: { host: '127.0.0.1', port: 4175, strictPort: true, fs: { allow: [root] } },
});
await server.listen();
server.printUrls();
