import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initOtel, type RuntimeOtelConfig } from './otel';

const loadRuntimeOtelConfig = async (): Promise<RuntimeOtelConfig | undefined> => {
  const authToken = localStorage.getItem('authToken');
  const isAuthenticated = Boolean(authToken);

  // Authenticated-only server config is the source of truth for frontend OTEL.
  // Unauthenticated sessions never fetch protected config and never capture console logs.
  if (!isAuthenticated || !authToken) {
    return {
      enabled: false,
      captureConsoleLogs: false,
    };
  }

  try {
    const response = await fetch('/api/public-config', {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (response.ok) {
      const data = (await response.json()) as {
        captureFrontendLogs?: boolean;
        frontendOtelEnabled?: boolean;
      };
      return {
        enabled: typeof data?.frontendOtelEnabled === 'boolean' ? data.frontendOtelEnabled : false,
        captureConsoleLogs: typeof data?.captureFrontendLogs === 'boolean' ? data.captureFrontendLogs : false,
      };
    }
  } catch {
    // Ignore protected config errors.
  }

  return {
    enabled: false,
    captureConsoleLogs: false,
  };
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
