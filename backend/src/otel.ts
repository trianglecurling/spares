import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import {
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

const otelEnabled = process.env.OTEL_ENABLED !== 'false';

if (otelEnabled) {
  const baseEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
  const tracesEndpoint =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    `${baseEndpoint.replace(/\/$/, '')}/v1/traces`;
  const logsEndpoint =
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || `${baseEndpoint.replace(/\/$/, '')}/v1/logs`;
  const captureConsoleLogs = process.env.OTEL_CAPTURE_CONSOLE_LOGS !== 'false';

  const sdk = new NodeSDK({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'spares-backend',
      [SEMRESATTRS_SERVICE_VERSION]: process.env.npm_package_version || 'unknown',
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
    }),
    traceExporter: new OTLPTraceExporter({ url: tracesEndpoint }),
    logRecordProcessor: new SimpleLogRecordProcessor(new OTLPLogExporter({ url: logsEndpoint })),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (request) => {
            const url = request.url || '';
            return url.startsWith('/api/health') || url.startsWith('/api/install');
          },
        },
      }),
    ],
  });

  await sdk.start();

  let originalConsole:
    | {
        log: typeof console.log;
        info: typeof console.info;
        warn: typeof console.warn;
        error: typeof console.error;
        debug: typeof console.debug;
      }
    | undefined;

  if (captureConsoleLogs) {
    const logger = logs.getLogger('console');
    const consoleRef = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console),
    };
    originalConsole = consoleRef;

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
  }

  const shutdown = async () => {
    try {
      if (captureConsoleLogs) {
        // Restore original console methods before shutdown.
        if (originalConsole) {
          console.log = originalConsole.log;
          console.info = originalConsole.info;
          console.warn = originalConsole.warn;
          console.error = originalConsole.error;
          console.debug = originalConsole.debug;
        }
      }
      await sdk.shutdown();
    } catch (error) {
      console.error('Failed to shut down OpenTelemetry SDK', error);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
