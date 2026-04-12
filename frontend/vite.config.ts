import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3016',
        changeOrigin: true,
      },
      '/go': {
        target: 'http://localhost:3016',
        changeOrigin: true,
        bypass(req) {
          const u = req.url ?? '';
          // Vite: returning `false` from bypass sends404. Return the URL string to skip the proxy
          // and let the SPA / html fallback handle `/go/:slug/info`.
          if (/\/go\/[^/]+\/info\/?(\?|$)/.test(u)) {
            return u;
          }
        },
      },
    },
  },
});

