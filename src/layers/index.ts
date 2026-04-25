import type { PufferEvent, PufferConfig, LayerFunction, LayerResult } from '@puffer/core';
import { logger } from '../utils/logger.js';
import { piiScanner } from './layer-1-pii.js';
import { injectionDetector } from './layer-2-injection.js';
import { commandAnalyzer } from './layer-3-commands.js';
import { networkEgressGuard } from './layer-4-network.js';
import { filesystemSentinel } from './layer-5-filesystem.js';
import { behaviorAnalyzer } from './layer-6-behavior.js';
import { mcpPoisoningDetector } from './layer-7-mcp.js';

interface RegisteredLayer {
  name: string;
  fn: LayerFunction;
  config: unknown;
}

export interface PipelineOptions {
  /** If true, layer errors cause BLOCK instead of ALLOW (fail-closed). Default: false */
  failClosed?: boolean;
  /** Timeout per layer in ms. Layers exceeding this are treated as errors. Default: 5000 */
  layerTimeoutMs?: number;
}

export class DefensePipeline {
  private layers: RegisteredLayer[] = [];
  private options: PipelineOptions;

  constructor(options: PipelineOptions = {}) {
    this.options = {
      failClosed: options.failClosed ?? false,
      layerTimeoutMs: options.layerTimeoutMs ?? 5000,
    };
  }

  registerLayer(name: string, fn: LayerFunction, config: unknown): void {
    this.layers.push({ name, fn, config });
  }

  async evaluate(event: PufferEvent): Promise<PufferEvent> {
    for (const layer of this.layers) {
      const layerConfig = layer.config as { enabled?: boolean };
      if (layerConfig.enabled === false) continue;

      const start = Date.now();
      try {
        // Run layer with timeout to prevent ReDoS and hangs
        const timeoutMs = this.options.layerTimeoutMs!;
        const result = await Promise.race([
          layer.fn(event, layer.config),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Layer ${layer.name} timed out after ${timeoutMs}ms`)),
              timeoutMs,
            ),
          ),
        ]);
        result.durationMs = Date.now() - start;
        event.layers.push(result);

        // SHORT CIRCUIT: If any layer says BLOCK, stop immediately
        if (result.verdict === 'block') {
          event.decision = 'BLOCK';
          return event;
        }
      } catch (err) {
        const durationMs = Date.now() - start;
        const errorMsg = (err as Error).message;
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
          event.decision = 'BLOCK';
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
    layerTimeoutMs: 5000,
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
  pipeline.registerLayer(
    'network_egress',
    networkEgressGuard as LayerFunction,
    config.layers.network,
  );
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
