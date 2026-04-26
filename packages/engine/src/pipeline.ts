import type { PufferEvent, PufferConfig, LayerFunction, LayerResult } from '@puffer/core';
import { logger, DEFAULT_LAYER_TIMEOUT_MS, SEVERITY_DESC } from '@puffer/core';
import { PII_PATTERNS, piiScanner } from '@puffer/layer-pii';
import { injectionDetector } from '@puffer/layer-injection';
import { commandAnalyzer } from '@puffer/layer-commands';
import { networkEgressGuard } from '@puffer/layer-network';
import { filesystemSentinel } from '@puffer/layer-filesystem';
import { behaviorAnalyzer } from '@puffer/layer-behavior';
import { mcpPoisoningDetector } from '@puffer/layer-mcp';
import {
  auditsTotal,
  blocksTotal,
  escalatesTotal,
  eventsTotal,
  layerDurationSeconds,
  layerErrorsTotal,
  pipelineDurationSeconds,
  withSpan,
} from '@puffer/observability';

// Label aggregate block/audit counters with the worst severity that
// actually triggered the layer's verdict.
function maxSeverity(result: LayerResult): string {
  for (const s of SEVERITY_DESC) {
    if (result.findings.some((f) => f.severity === s)) return s;
  }
  return 'low';
}

interface RegisteredLayer {
  name: string;
  fn: LayerFunction;
  config: unknown;
}

export interface PipelineOptions {
  /** If true, layer errors cause BLOCK instead of ALLOW (fail-closed). Default: false */
  failClosed?: boolean;
  /** Timeout per layer in ms. Layers exceeding this are treated as errors.
   *  Default: `DEFAULT_LAYER_TIMEOUT_MS` (5000). */
  layerTimeoutMs?: number;
}

export class DefensePipeline {
  private layers: RegisteredLayer[] = [];
  private options: PipelineOptions;

  constructor(options: PipelineOptions = {}) {
    this.options = {
      failClosed: options.failClosed ?? false,
      layerTimeoutMs: options.layerTimeoutMs ?? DEFAULT_LAYER_TIMEOUT_MS,
    };
  }

  registerLayer(name: string, fn: LayerFunction, config: unknown): void {
    this.layers.push({ name, fn, config });
  }

  async evaluate(event: PufferEvent): Promise<PufferEvent> {
    return withSpan(
      'puffer.pipeline.evaluate',
      {
        'puffer.event.id': event.id,
        'puffer.event.action_type': event.action.type,
        'puffer.agent': event.source.agent,
        'puffer.provider': event.source.provider,
      },
      async (pipelineSpan) => {
        const result = await this.runPipeline(event);
        pipelineSpan.setAttribute('puffer.decision', result.decision ?? 'UNKNOWN');
        pipelineSpan.setAttribute('puffer.layers_run', result.layers.length);
        return result;
      },
    );
  }

  private async runPipeline(event: PufferEvent): Promise<PufferEvent> {
    const pipelineStart = Date.now();
    const agent = event.source.agent;

    for (const layer of this.layers) {
      const layerConfig = layer.config as { enabled?: boolean };
      if (layerConfig.enabled === false) continue;

      const start = Date.now();
      try {
        // Run layer with timeout to prevent ReDoS and hangs
        const timeoutMs = this.options.layerTimeoutMs!;
        const result = await withSpan(
          `puffer.layer.${layer.name}`,
          { 'puffer.layer.name': layer.name },
          async (span) => {
            const layerResult = await Promise.race([
              layer.fn(event, layer.config),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error(`Layer ${layer.name} timed out after ${timeoutMs}ms`)),
                  timeoutMs,
                ),
              ),
            ]);
            span.setAttribute('puffer.layer.verdict', layerResult.verdict);
            span.setAttribute('puffer.layer.confidence', layerResult.confidence);
            span.setAttribute('puffer.layer.findings_count', layerResult.findings.length);
            return layerResult;
          },
        );
        result.durationMs = Date.now() - start;
        event.layers.push(result);

        layerDurationSeconds.labels(layer.name).observe(result.durationMs / 1000);

        if (result.verdict === 'block') {
          blocksTotal.labels(layer.name, maxSeverity(result)).inc();
          // SHORT CIRCUIT: If any layer says BLOCK, stop immediately
          event.decision = 'BLOCK';
          eventsTotal.labels(agent, 'block').inc();
          pipelineDurationSeconds.observe((Date.now() - pipelineStart) / 1000);
          return event;
        }
        if (result.verdict === 'audit') auditsTotal.labels(layer.name, maxSeverity(result)).inc();
        if (result.verdict === 'escalate') escalatesTotal.labels(layer.name).inc();
      } catch (err) {
        const durationMs = Date.now() - start;
        const errorMsg = (err as Error).message;
        const reason = errorMsg.includes('timed out') ? 'timeout' : 'exception';
        layerErrorsTotal.labels(layer.name, reason).inc();
        logger.error(`Layer ${layer.name} error: ${errorMsg}`);

        if (this.options.failClosed) {
          // Fail-closed: treat layer errors as BLOCK
          const errorResult: LayerResult = {
            layer: event.layers.length + 1,
            name: layer.name,
            verdict: 'block',
            confidence: 0,
            details: `Layer error (fail-closed): ${errorMsg}`,
            findings: [
              {
                type: 'layer_error',
                severity: 'critical',
                location: layer.name,
                value: errorMsg,
                suggestion: 'Layer failed and fail-closed mode is active',
              },
            ],
            durationMs,
          };
          event.layers.push(errorResult);
          blocksTotal.labels(layer.name, 'critical').inc();
          event.decision = 'BLOCK';
          eventsTotal.labels(agent, 'block').inc();
          pipelineDurationSeconds.observe((Date.now() - pipelineStart) / 1000);
          return event;
        } else {
          // Fail-open: layer failure should not block the request — log and continue
          const errorResult: LayerResult = {
            layer: event.layers.length + 1,
            name: layer.name,
            verdict: 'allow',
            confidence: 0,
            details: `Layer error: ${errorMsg}`,
            findings: [],
            durationMs,
          };
          event.layers.push(errorResult);
        }
      }
    }

    // If no layer blocked, check for escalations or audits
    const hasEscalate = event.layers.some((l) => l.verdict === 'escalate');
    const hasAudit = event.layers.some((l) => l.verdict === 'audit');

    if (hasEscalate) event.decision = 'ESCALATE';
    else if (hasAudit) event.decision = 'AUDIT';
    else event.decision = 'ALLOW';

    eventsTotal.labels(agent, event.decision.toLowerCase()).inc();
    pipelineDurationSeconds.observe((Date.now() - pipelineStart) / 1000);

    return event;
  }

  getLayerCount(): number {
    return this.layers.length;
  }
}

export function createDefaultPipeline(config: PufferConfig): DefensePipeline {
  // Use fail-closed in paranoid mode, fail-open otherwise
  const options: PipelineOptions = {
    failClosed: config.mode === 'paranoid',
    layerTimeoutMs: DEFAULT_LAYER_TIMEOUT_MS,
  };
  const pipeline = new DefensePipeline(options);

  pipeline.registerLayer('pii_scanner', piiScanner as LayerFunction, config.layers.pii);
  pipeline.registerLayer(
    'injection_detector',
    injectionDetector as LayerFunction,
    config.layers.injection,
  );
  pipeline.registerLayer(
    'command_analyzer',
    commandAnalyzer as LayerFunction,
    config.layers.commands,
  );
  // Inject the PII patterns into the network layer config so layer-network
  // can scan payloads without importing layer-pii. The L4↔L1 boundary
  // is now a pure data flow, not a code coupling.
  pipeline.registerLayer('network_egress', networkEgressGuard as LayerFunction, {
    ...config.layers.network,
    piiPatterns: PII_PATTERNS,
  });
  pipeline.registerLayer(
    'filesystem_sentinel',
    filesystemSentinel as LayerFunction,
    config.layers.filesystem,
  );
  pipeline.registerLayer(
    'behavior_analyzer',
    behaviorAnalyzer as LayerFunction,
    config.layers.behavior,
  );
  pipeline.registerLayer('mcp_detector', mcpPoisoningDetector as LayerFunction, config.layers.mcp);

  return pipeline;
}
