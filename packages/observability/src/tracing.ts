// OpenTelemetry tracing for Puffer.
//
// The SDK is only initialized when `PUFFER_OTEL_EXPORTER_ENDPOINT` is
// set, so a daemon that doesn't opt in pays zero overhead — `tracer` is
// a no-op tracer at module load and instrumentation call sites do not
// have to branch on whether tracing is enabled.

import { trace, SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

const TRACER_NAME = '@puffer/observability';

let sdk: NodeSDK | null = null;

/**
 * Initialize the OTel Node SDK and start exporting spans to the
 * configured collector. Reads the endpoint from
 * `PUFFER_OTEL_EXPORTER_ENDPOINT`. Calling this when the env var is
 * absent is a deliberate no-op so daemons can call it unconditionally
 * at startup without checking the env themselves.
 *
 * Returns true when tracing was actually started, false otherwise.
 */
export function initTracing(serviceName: string, version: string): boolean {
  const endpoint = process.env.PUFFER_OTEL_EXPORTER_ENDPOINT;
  if (!endpoint) return false;
  if (sdk) return true;

  sdk = new NodeSDK({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: serviceName,
      [SEMRESATTRS_SERVICE_VERSION]: version,
    }),
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
  });
  sdk.start();
  return true;
}

/** Shut the SDK down. Useful in tests and for graceful daemon stop. */
export async function shutdownTracing(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = null;
}

/**
 * Trace surface used by the engine and proxy instrumentation. When
 * tracing is not initialized this resolves to OTel's built-in no-op
 * tracer, which short-circuits every operation cheaply.
 */
export function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

/**
 * Run a function inside a span, recording duration and attaching the
 * provided attributes. If the function throws, the span records the
 * exception and is marked as ERROR before the throw propagates.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      if (err instanceof Error) span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

export { SpanStatusCode } from '@opentelemetry/api';
export type { Span, Tracer } from '@opentelemetry/api';
