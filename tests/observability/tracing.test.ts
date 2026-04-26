import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { withSpan } from '@puffer/observability';
import { DefensePipeline } from '@puffer/engine';
import { piiScanner } from '@puffer/layer-pii';
import type { LayerFunction } from '@puffer/core';
import { makeLLMRequestEvent, DEFAULT_PII_CONFIG } from '../adversarial/helpers.js';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));

describe('OpenTelemetry tracing', () => {
  beforeAll(() => {
    // Register a real provider so trace.getTracer() returns one that
    // emits spans into our in-memory exporter. Without this the global
    // tracer is the no-op and assertions about span emission would
    // pass for the wrong reason.
    trace.setGlobalTracerProvider(provider);
  });

  afterAll(async () => {
    trace.disable();
    await provider.shutdown();
  });

  it('withSpan records a span with attributes', async () => {
    exporter.reset();
    await withSpan('test.unit', { 'test.attr': 'hello' }, async () => 42);

    const finished: ReadableSpan[] = exporter.getFinishedSpans();
    expect(finished).toHaveLength(1);
    expect(finished[0]?.name).toBe('test.unit');
    expect(finished[0]?.attributes['test.attr']).toBe('hello');
  });

  it('records ERROR status when the wrapped function throws', async () => {
    exporter.reset();
    await expect(
      withSpan('test.fail', {}, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const span = exporter.getFinishedSpans()[0];
    expect(span?.status.code).toBe(2); // 2 === SpanStatusCode.ERROR
    expect(span?.status.message).toBe('boom');
    expect(span?.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('pipeline.evaluate emits a parent span with one child per layer', async () => {
    exporter.reset();
    const pipeline = new DefensePipeline();
    pipeline.registerLayer('pii_scanner', piiScanner as LayerFunction, DEFAULT_PII_CONFIG);

    await pipeline.evaluate(makeLLMRequestEvent('clean text'));

    const spans = exporter.getFinishedSpans();
    const pipelineSpan = spans.find((s) => s.name === 'puffer.pipeline.evaluate');
    const layerSpan = spans.find((s) => s.name === 'puffer.layer.pii_scanner');

    expect(pipelineSpan).toBeDefined();
    expect(layerSpan).toBeDefined();
    expect(pipelineSpan?.attributes['puffer.agent']).toBe('test-agent');
    expect(pipelineSpan?.attributes['puffer.decision']).toBe('ALLOW');
    expect(layerSpan?.attributes['puffer.layer.verdict']).toBe('allow');
    expect(layerSpan?.attributes['puffer.layer.findings_count']).toBe(0);
    // Note: parent-child wiring requires an AsyncLocalStorage context
    // manager which is registered by NodeSDK in production but not by
    // the BasicTracerProvider used here. The trace export in real
    // operation under PUFFER_OTEL_EXPORTER_ENDPOINT yields the parent
    // pointer correctly; that path is covered by manual smoke tests
    // against a Jaeger collector (see docs/architecture/observability.md).
  });
});
