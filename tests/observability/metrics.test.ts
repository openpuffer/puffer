import { describe, it, expect, beforeEach } from 'vitest';
import { DefensePipeline } from '@puffer/engine';
import { piiScanner } from '@puffer/layer-pii';
import { renderMetrics, registry } from '@puffer/observability';
import type { LayerFunction, PufferEvent } from '@puffer/core';
import { makeLLMRequestEvent, DEFAULT_PII_CONFIG } from '../adversarial/helpers.js';

describe('Prometheus metrics', () => {
  beforeEach(() => {
    // Reset all counters/histograms between tests so assertions about
    // specific increments are not polluted by prior runs in the same
    // worker. Default metrics (event loop lag, etc.) are left alone —
    // they are gauges and re-collect on every render.
    registry.resetMetrics();
  });

  it('renders Prometheus text exposition format', async () => {
    const { contentType, body } = await renderMetrics();
    expect(contentType).toMatch(/text\/plain/);
    expect(body).toContain('# HELP puffer_events_total');
    expect(body).toContain('# TYPE puffer_events_total counter');
  });

  it('increments puffer_events_total on every pipeline evaluation', async () => {
    const pipeline = new DefensePipeline();
    pipeline.registerLayer('pii_scanner', piiScanner as LayerFunction, DEFAULT_PII_CONFIG);

    const cleanEvent: PufferEvent = makeLLMRequestEvent('What time is it?');
    await pipeline.evaluate(cleanEvent);

    const { body } = await renderMetrics();
    expect(body).toMatch(/puffer_events_total\{[^}]*verdict="allow"[^}]*\}\s+1/);
  });

  it('increments puffer_blocks_total when a layer blocks', async () => {
    const pipeline = new DefensePipeline();
    pipeline.registerLayer('pii_scanner', piiScanner as LayerFunction, DEFAULT_PII_CONFIG);

    const piiEvent: PufferEvent = makeLLMRequestEvent('My SSN is 123-45-6789');
    await pipeline.evaluate(piiEvent);

    const { body } = await renderMetrics();
    expect(body).toMatch(/puffer_blocks_total\{[^}]*layer="pii_scanner"[^}]*\}\s+1/);
    // The block also short-circuits the event totals to verdict=block.
    expect(body).toMatch(/puffer_events_total\{[^}]*verdict="block"[^}]*\}\s+1/);
  });

  it('observes pipeline_duration_seconds for each evaluation', async () => {
    const pipeline = new DefensePipeline();
    pipeline.registerLayer('pii_scanner', piiScanner as LayerFunction, DEFAULT_PII_CONFIG);

    await pipeline.evaluate(makeLLMRequestEvent('hello'));

    const { body } = await renderMetrics();
    // Histogram emits _count, _sum, and _bucket lines once anything observed.
    expect(body).toMatch(/puffer_pipeline_duration_seconds_count\s+1/);
    expect(body).toMatch(/puffer_pipeline_duration_seconds_sum\s+/);
  });

  it('counts layer errors with a reason label', async () => {
    const pipeline = new DefensePipeline();
    const crashing: LayerFunction = async () => {
      throw new Error('synthetic crash');
    };
    pipeline.registerLayer('crashing_layer', crashing, { enabled: true });

    await pipeline.evaluate(makeLLMRequestEvent('test'));

    const { body } = await renderMetrics();
    expect(body).toMatch(
      /puffer_layer_errors_total\{[^}]*layer="crashing_layer"[^}]*reason="exception"[^}]*\}\s+1/,
    );
  });
});
