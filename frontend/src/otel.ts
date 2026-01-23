import 'zone.js';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { Resource } from '@opentelemetry/resources';
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
  backendOrigin?: string;
  appVersion?: string;
};

const toBoolean = (value: boolean | string | undefined, fallback: boolean) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value !== 'false';
  return fallback;
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
};
