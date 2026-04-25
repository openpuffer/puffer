import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';
import { Readable } from 'node:stream';
import httpProxy from 'http-proxy';
import { v4 as uuidv4 } from 'uuid';
import type { PufferConfig, PufferEvent } from '../types.js';
import { DEFAULT_PROXY_PORT, MAX_REQUEST_BODY_BYTES } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import type { ProxyDependencies } from './handler.js';
import { handleRequest } from './handler.js';
import { initTLS } from './tls.js';

export interface ProxyServer {
  server: http.Server;
  proxy: httpProxy;
  start(): Promise<void>;
  stop(): Promise<void>;
  setPassthrough(enabled: boolean): void;
  port: number;
}

export interface ProxyOptions {
  config: PufferConfig;
  evaluatePipeline: (event: PufferEvent) => Promise<PufferEvent>;
  logEvent: (event: PufferEvent) => void;
  /** Optional callback to get discovered agent names for heuristic identification */
  getDiscoveredAgentNames?: () => string[];
}

export function createProxyServer(options: ProxyOptions): ProxyServer {
  const { config, evaluatePipeline, logEvent } = options;
  const port = config.providers[0]?.proxyPort || DEFAULT_PROXY_PORT;

  initTLS();

  const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    secure: true,
    followRedirects: false,
    selfHandleResponse: false,
  });

  proxy.on('error', (err, _req, res) => {
    logger.error(`Proxy error: ${err.message}`);
    if (res && 'writeHead' in res) {
      const serverRes = res as ServerResponse;
      if (!serverRes.headersSent) {
        serverRes.writeHead(502, { 'Content-Type': 'application/json' });
        serverRes.end(
          JSON.stringify({ error: { type: 'puffer_proxy_error', message: err.message } }),
        );
      }
    }
  });

  const sessionId = uuidv4();
  const sequenceCounter = { value: 0 };

  // Build target resolver from configured providers
  const providerTargets = new Map<string, string>();
  for (const p of config.providers) {
    providerTargets.set(p.name, p.targetUrl);
  }
  // Add well-known defaults
  if (!providerTargets.has('openai')) providerTargets.set('openai', 'https://api.openai.com');
  if (!providerTargets.has('anthropic'))
    providerTargets.set('anthropic', 'https://api.anthropic.com');
  if (!providerTargets.has('ollama')) providerTargets.set('ollama', 'http://localhost:11434');
  if (!providerTargets.has('deepseek')) providerTargets.set('deepseek', 'https://api.deepseek.com');
  if (!providerTargets.has('groq')) providerTargets.set('groq', 'https://api.groq.com');
  if (!providerTargets.has('together')) providerTargets.set('together', 'https://api.together.xyz');
  if (!providerTargets.has('openrouter'))
    providerTargets.set('openrouter', 'https://openrouter.ai');
  if (!providerTargets.has('openai-compatible'))
    providerTargets.set('openai-compatible', 'https://api.openai.com');
  if (!providerTargets.has('mistral')) providerTargets.set('mistral', 'https://api.mistral.ai');
  if (!providerTargets.has('cohere')) providerTargets.set('cohere', 'https://api.cohere.ai');
  if (!providerTargets.has('github-copilot'))
    providerTargets.set('github-copilot', 'https://copilot-proxy.githubusercontent.com');
  if (!providerTargets.has('cursor')) providerTargets.set('cursor', 'https://api2.cursor.sh');
  if (!providerTargets.has('codeium')) providerTargets.set('codeium', 'https://server.codeium.com');

  const deps: ProxyDependencies = {
    evaluatePipeline,
    logEvent,
    sessionId,
    sequenceCounter,
    mode: config.mode,
    passthrough: false,
    getDiscoveredAgentNames: options.getDiscoveredAgentNames,

    resolveTarget(provider: string): string | null {
      return providerTargets.get(provider) ?? null;
    },

    forwardRequest(req, res, targetUrl, bodyBuffer, onResponse) {
      // Add Puffer header
      req.headers['x-puffer-scanned'] = 'true';

      // Remove Puffer-specific headers before forwarding
      delete req.headers['x-puffer-target'];
      delete req.headers['x-puffer-original-host'];
      delete req.headers['x-puffer-agent'];

      // Track the response for auditing with cleanup on client disconnect
      let responded = false;

      proxy.once('proxyRes', (proxyRes) => {
        responded = true;
        let responseData = '';
        proxyRes.on('data', (chunk: Buffer) => {
          responseData += chunk.toString();
        });
        proxyRes.on('end', () => {
          let responseBody: unknown;
          try {
            responseBody = JSON.parse(responseData);
          } catch {
            responseBody = responseData;
          }
          onResponse(proxyRes.statusCode ?? 500, responseBody, proxyRes.headers);
        });
      });

      // Guard: if client disconnects before proxy responds, avoid dangling state
      req.on('close', () => {
        if (!responded) {
          responded = true; // Prevent double processing
        }
      });

      proxy.web(req, res, {
        target: targetUrl,
        buffer: createReadableStream(bodyBuffer),
      });
    },
  };

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    // Collect request body with size limit
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      totalSize += chunk.length;
      if (totalSize > MAX_REQUEST_BODY_BYTES) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              type: 'puffer_error',
              message: `Request body too large (limit: ${MAX_REQUEST_BODY_BYTES / (1024 * 1024)} MB)`,
            },
          }),
        );
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      const bodyBuffer = Buffer.concat(chunks);
      handleRequest(req, res, bodyBuffer, deps).catch((err) => {
        logger.error(`Request handling error: ${(err as Error).message}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: { type: 'puffer_internal_error', message: 'Internal proxy error' },
            }),
          );
        }
      });
    });
  });

  return {
    server,
    proxy,
    port,

    setPassthrough(enabled: boolean) {
      deps.passthrough = enabled;
    },

    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.listen(port, '127.0.0.1', () => {
          logger.info(`Proxy listening on http://127.0.0.1:${port}`);
          resolve();
        });
        server.on('error', reject);
      });
    },

    stop(): Promise<void> {
      return new Promise((resolve) => {
        proxy.close();
        server.close(() => {
          logger.info('Proxy server stopped');
          resolve();
        });
      });
    },
  };
}

function createReadableStream(buffer: Buffer): Readable {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}
