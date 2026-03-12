import { PufferEvent, PufferConfig, LayerFunction, LayerResult } from '../types.js';
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

export class DefensePipeline {
  private layers: RegisteredLayer[] = [];

  registerLayer(name: string, fn: LayerFunction, config: unknown): void {
    this.layers.push({ name, fn, config });
  }

  async evaluate(event: PufferEvent): Promise<PufferEvent> {
    for (const layer of this.layers) {
      const layerConfig = layer.config as { enabled?: boolean };
      if (layerConfig.enabled === false) continue;

      const start = Date.now();
      try {
        const result = await layer.fn(event, layer.config);
        result.durationMs = Date.now() - start;
        event.layers.push(result);

        // SHORT CIRCUIT: If any layer says BLOCK, stop immediately
        if (result.verdict === 'block') {
          event.decision = 'BLOCK';
          return event;
        }
      } catch (err) {
        logger.error(`Layer ${layer.name} error: ${(err as Error).message}`);
        // Layer failure should not block the request — log and continue
        const errorResult: LayerResult = {
          layer: event.layers.length + 1,
          name: layer.name,
          verdict: 'allow',
          confidence: 0,
          details: `Layer error: ${(err as Error).message}`,
          findings: [],
          durationMs: Date.now() - start,
        };
        event.layers.push(errorResult);
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
  const pipeline = new DefensePipeline();

  pipeline.registerLayer('pii_scanner', piiScanner as LayerFunction, config.layers.pii);
  pipeline.registerLayer('injection_detector', injectionDetector as LayerFunction, config.layers.injection);
  pipeline.registerLayer('command_analyzer', commandAnalyzer as LayerFunction, config.layers.commands);
  pipeline.registerLayer('network_egress', networkEgressGuard as LayerFunction, config.layers.network);
  pipeline.registerLayer('filesystem_sentinel', filesystemSentinel as LayerFunction, config.layers.filesystem);
  pipeline.registerLayer('behavior_analyzer', behaviorAnalyzer as LayerFunction, config.layers.behavior);
  pipeline.registerLayer('mcp_detector', mcpPoisoningDetector as LayerFunction, config.layers.mcp);

  return pipeline;
}
