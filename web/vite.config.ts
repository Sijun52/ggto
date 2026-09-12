import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // dev 에서는 vite 가 /api 를 서버로 넘긴다 (프로덕션은 같은 오리진이라 CORS 가 없다)
    proxy: {
      '/api': { target: 'http://127.0.0.1:7777', changeOrigin: false },
    },
  },
});
