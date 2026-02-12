import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initOtel, type RuntimeOtelConfig } from './otel';

const loadRuntimeOtelConfig = async (): Promise<RuntimeOtelConfig | undefined> => {
  let runtimeConfig: RuntimeOtelConfig | undefined;

  try {
    const response = await fetch('/otel-config.json', { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json()) as RuntimeOtelConfig;
      if (data && typeof data === 'object') {
        runtimeConfig = data;
      }
    }
  } catch {
    runtimeConfig = undefined;
  }

  // Server config is the source of truth for frontend OTEL. If we can't reach it,
  // default to disabled to avoid failed telemetry requests (e.g. CORS errors).
  let gotServerConfig = false;
  try {
    const response = await fetch('/api/public-config', { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json()) as {
        captureFrontendLogs?: boolean;
        frontendOtelEnabled?: boolean;
      };
      gotServerConfig = true;
      if (typeof data?.frontendOtelEnabled === 'boolean') {
        runtimeConfig = runtimeConfig || {};
        runtimeConfig.enabled = data.frontendOtelEnabled;
      }
      if (typeof data?.captureFrontendLogs === 'boolean') {
        runtimeConfig = runtimeConfig || {};
        runtimeConfig.captureConsoleLogs = data.captureFrontendLogs;
      }
    }
  } catch {
    // Ignore public config errors.
  }

  if (!gotServerConfig) {
    runtimeConfig = runtimeConfig || {};
    runtimeConfig.enabled = false;
  }

  return runtimeConfig;
};

const startApp = async () => {
  const runtimeConfig = await loadRuntimeOtelConfig();
  initOtel(runtimeConfig);

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

void startApp();

