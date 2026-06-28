import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { spaDocumentStatusPlugin } from './viteSpaDocumentStatusPlugin';

export default defineConfig(({ mode }) => {
  const backendEnv = loadEnv(mode, path.resolve(__dirname, '../backend'), '');
  const backendTarget = `http://localhost:${backendEnv.PORT || '3001'}`;

  return {
    plugins: [react(), spaDocumentStatusPlugin(backendTarget)],
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
          target: backendTarget,
          changeOrigin: true,
        },
        '/go': {
          target: backendTarget,
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
  };
});
