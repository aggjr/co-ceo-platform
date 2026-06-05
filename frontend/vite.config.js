import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import solidPlugin from 'vite-plugin-solid';

function copyPublicAssetsSkippingDesktopIni() {
  const publicRoot = path.resolve(__dirname, 'public');
  const distRoot = path.resolve(__dirname, 'dist');

  function copyDir(src, dest) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (entry.name.toLowerCase() === 'desktop.ini') continue;
      const from = path.join(src, entry.name);
      const to = path.join(dest, entry.name);
      if (entry.isDirectory()) copyDir(from, to);
      else fs.copyFileSync(from, to);
    }
  }

  return {
    name: 'copy-public-assets-skipping-desktop-ini',
    closeBundle() {
      copyDir(publicRoot, distRoot);
    },
  };
}

export default defineConfig({
  plugins: [solidPlugin(), copyPublicAssetsSkippingDesktopIni()],
  appType: 'spa',
  root: path.resolve(__dirname),
  publicDir: false,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    /** Se 5173 estiver ocupada (Vite antigo), usa 5174 em vez de falhar. */
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
