import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initOtel, type RuntimeOtelConfig } from './otel';

const loadRuntimeOtelConfig = async (): Promise<RuntimeOtelConfig | undefined> => {
  try {
    const response = await fetch('/otel-config.json', { cache: 'no-store' });
    if (!response.ok) return undefined;
    const data = (await response.json()) as RuntimeOtelConfig;
    if (!data || typeof data !== 'object') return undefined;
    return data;
  } catch {
    return undefined;
  }
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

