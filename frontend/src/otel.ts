import 'zone.js';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { Resource } from '@opentelemetry/resources';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type RuntimeOtelConfig = {
  enabled?: boolean | string;
  serviceName?: string;
  exporterOtlpEndpoint?: string;
  exporterOtlpLogsEndpoint?: string;
  backendOrigin?: string;
  appVersion?: string;
  captureConsoleLogs?: boolean | string;
};

let frontendLogCaptureEnabled = true;

export const setFrontendLogCaptureEnabled = (enabled: boolean) => {
  frontendLogCaptureEnabled = enabled;
};

const toBoolean = (value: boolean | string | undefined, fallback: boolean) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value !== 'false';
  return fallback;
};

const isLocalhost = () => {
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  return host === 'localhost' || host === '127.0.0.1' || host === '';
};

const isRemoteUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1';
  } catch {
    return false;
  }
};

export const initOtel = (runtimeConfig?: RuntimeOtelConfig) => {
  const otelEnabled = toBoolean(
    runtimeConfig?.enabled,
    import.meta.env.VITE_OTEL_ENABLED !== 'false'
  );

  if (!otelEnabled) return;

  const otlpEndpoint =
    runtimeConfig?.exporterOtlpEndpoint ||
    import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT ||
    'http://localhost:4318/v1/traces';

  // Skip when running on localhost with a remote collector; these requests fail with CORS.
  if (isLocalhost() && isRemoteUrl(otlpEndpoint)) return;

  const logsEndpoint =
    runtimeConfig?.exporterOtlpLogsEndpoint ||
    import.meta.env.VITE_OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ||
    (() => {
      const normalized = otlpEndpoint.replace(/\/$/, '');
      if (normalized.endsWith('/v1/logs')) return normalized;
      if (normalized.endsWith('/v1/traces')) {
        return normalized.replace(/\/v1\/traces$/, '/v1/logs');
      }
      return `${normalized}/v1/logs`;
    })();

  const captureConsoleLogs = toBoolean(
    runtimeConfig?.captureConsoleLogs,
    import.meta.env.VITE_OTEL_CAPTURE_CONSOLE_LOGS !== 'false'
  );
  frontendLogCaptureEnabled = captureConsoleLogs;

  const backendOrigin = runtimeConfig?.backendOrigin || import.meta.env.VITE_OTEL_BACKEND_ORIGIN;
  const propagateTraceHeaderCorsUrls: Array<string | RegExp> = [/^\/api/];

  if (backendOrigin) {
    propagateTraceHeaderCorsUrls.push(new RegExp(`^${escapeRegExp(backendOrigin)}`));
  }

  const provider = new WebTracerProvider({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]:
        runtimeConfig?.serviceName || import.meta.env.VITE_OTEL_SERVICE_NAME || 'spares-frontend',
      [SEMRESATTRS_SERVICE_VERSION]:
        runtimeConfig?.appVersion || import.meta.env.VITE_APP_VERSION || 'unknown',
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: import.meta.env.MODE,
    }),
  });

  provider.addSpanProcessor(
    new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: otlpEndpoint,
      })
    )
  );

  provider.register({
    contextManager: new ZoneContextManager(),
  });

  registerInstrumentations({
    instrumentations: [
      new DocumentLoadInstrumentation(),
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls,
        clearTimingResources: true,
      }),
      new XMLHttpRequestInstrumentation({
        propagateTraceHeaderCorsUrls,
      }),
    ],
  });

  const loggerProvider = new LoggerProvider({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]:
        runtimeConfig?.serviceName || import.meta.env.VITE_OTEL_SERVICE_NAME || 'spares-frontend',
      [SEMRESATTRS_SERVICE_VERSION]:
        runtimeConfig?.appVersion || import.meta.env.VITE_APP_VERSION || 'unknown',
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: import.meta.env.MODE,
    }),
  });

  loggerProvider.addLogRecordProcessor(
    new SimpleLogRecordProcessor(new OTLPLogExporter({ url: logsEndpoint }))
  );
  logs.setGlobalLoggerProvider(loggerProvider);

  const logger = logs.getLogger('console');
  const consoleRef = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  const formatArgs = (args: unknown[]) =>
    args
      .map((arg) => {
        if (arg instanceof Error) return arg.stack || arg.message;
        if (typeof arg === 'string') return arg;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ');

  const emitLog = (severityNumber: SeverityNumber, severityText: string, args: unknown[]) => {
    if (!frontendLogCaptureEnabled) return;
    logger.emit({
      severityNumber,
      severityText,
      body: formatArgs(args),
    });
  };

  console.log = (...args: unknown[]) => {
    consoleRef.log(...args);
    emitLog(SeverityNumber.INFO, 'INFO', args);
  };
  console.info = (...args: unknown[]) => {
    consoleRef.info(...args);
    emitLog(SeverityNumber.INFO, 'INFO', args);
  };
  console.warn = (...args: unknown[]) => {
    consoleRef.warn(...args);
    emitLog(SeverityNumber.WARN, 'WARN', args);
  };
  console.error = (...args: unknown[]) => {
    consoleRef.error(...args);
    emitLog(SeverityNumber.ERROR, 'ERROR', args);
  };
  console.debug = (...args: unknown[]) => {
    consoleRef.debug(...args);
    emitLog(SeverityNumber.DEBUG, 'DEBUG', args);
  };
};
