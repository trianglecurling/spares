import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const accessToken = localStorage.getItem('accessToken') || localStorage.getItem('authToken');

const scheduleDeferredOtelInit = () => {
  if (!accessToken) {
    return;
  }

  const run = () => {
    void (async () => {
      let runtimeConfig: import('./otel').RuntimeOtelConfig = {
        enabled: false,
        captureConsoleLogs: false,
      };

      try {
        const response = await fetch('/api/public-config', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (response.ok) {
          const data = (await response.json()) as {
            captureFrontendLogs?: boolean;
            frontendOtelEnabled?: boolean;
          };
          runtimeConfig = {
            enabled:
              typeof data?.frontendOtelEnabled === 'boolean' ? data.frontendOtelEnabled : false,
            captureConsoleLogs:
              typeof data?.captureFrontendLogs === 'boolean' ? data.captureFrontendLogs : false,
          };
        }
      } catch {
        // Ignore protected config errors.
      }

      const { initOtel } = await import('./otel');
      initOtel(runtimeConfig);
    })();
  };

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 3000 });
  } else {
    window.setTimeout(run, 0);
  }
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

scheduleDeferredOtelInit();
