import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('monaco-editor')) {
            return 'monaco';
          }
          if (id.includes('@toast-ui')) {
            return 'toast-ui';
          }
          if (id.includes('@opentelemetry')) {
            return 'otel';
          }
          if (id.includes('@dnd-kit')) {
            return 'dnd-kit';
          }
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
    },
  },
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

