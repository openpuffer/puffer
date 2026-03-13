// Agent process signatures — matched against `ps aux` or `wmic` output
export const AGENT_SIGNATURES = [
  { pattern: /openclaw|clawdbot|moltbot/i, name: 'openclaw', type: 'process' },
  { pattern: /claude[-_]?code/i, name: 'claude-code', type: 'process' },
  { pattern: /cursor[-_]?agent|cursor.*--type=agent/i, name: 'cursor', type: 'process' },
  { pattern: /aider/i, name: 'aider', type: 'process' },
  { pattern: /continue.*dev/i, name: 'continue-dev', type: 'process' },
  { pattern: /cline/i, name: 'cline', type: 'process' },
  { pattern: /copilot/i, name: 'github-copilot', type: 'process' },
  { pattern: /python.*langchain/i, name: 'python-langchain', type: 'process' },
  { pattern: /python.*crewai/i, name: 'python-crewai', type: 'process' },
  { pattern: /python.*autogen/i, name: 'python-autogen', type: 'process' },
  { pattern: /python.*openai/i, name: 'python-openai', type: 'process' },
  { pattern: /python.*anthropic/i, name: 'python-anthropic', type: 'process' },
  { pattern: /windsurf/i, name: 'windsurf', type: 'process' },
  { pattern: /codeium/i, name: 'codeium', type: 'process' },
];

// Port signatures — probed via HTTP GET to detect local LLM servers and agents
export const PORT_SIGNATURES = [
  { port: 11434, name: 'ollama', probe: '/api/tags', type: 'local-llm' },
  { port: 1234, name: 'lm-studio', probe: '/v1/models', type: 'local-llm' },
  { port: 8080, name: 'localai', probe: '/v1/models', type: 'local-llm' },
  { port: 8000, name: 'vllm', probe: '/v1/models', type: 'local-llm' },
  { port: 7860, name: 'text-generation-webui', probe: '/api/v1/model', type: 'local-llm' },
  { port: 5000, name: 'llama-cpp', probe: '/health', type: 'local-llm' },
  { port: 18789, name: 'openclaw-gateway', probe: '/health', type: 'agent' },
];

// Network signatures — matched against outbound connections to detect API usage
export const NETWORK_SIGNATURES = [
  { domain: 'api.openai.com', provider: 'openai' },
  { domain: 'api.anthropic.com', provider: 'anthropic' },
  { domain: 'generativelanguage.googleapis.com', provider: 'google' },
  { domain: 'api.deepseek.com', provider: 'deepseek' },
  { domain: 'api.together.xyz', provider: 'together' },
  { domain: 'api.groq.com', provider: 'groq' },
  { domain: 'openrouter.ai', provider: 'openrouter' },
  { domain: 'api.mistral.ai', provider: 'mistral' },
  { domain: 'api.cohere.ai', provider: 'cohere' },
];
