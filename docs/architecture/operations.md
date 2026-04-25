# Configuration & Audit Logging

> Extracted from PUFFER-GUIDE.md (sections 10–11).

## 10. Configuration System

### 10.1 Default Configuration — `config/default-policy.yaml`

```yaml
# Puffer Default Configuration
# https://github.com/puffer-fish/puffer

version: '0.1.0'
mode: enforce # monitor | enforce | paranoid | interactive

auto_discovery:
  enabled: true
  scan_interval_ms: 30000
  process_scanner: true
  port_scanner: true
  network_scanner: true

layers:
  pii:
    enabled: true
    regions: ['us', 'eu', 'global']
    action_by_severity:
      critical: block
      high: block
      medium: audit
      low: log
    custom_patterns: []
    exclude_contexts: []

  injection:
    enabled: true
    mode: heuristic
    thresholds:
      direct_input:
        block: 0.65
        audit: 0.40
      external_content:
        block: 0.50
        audit: 0.30
    heuristics:
      - role_switching
      - system_delimiters
      - imperative_override
      - data_exfil_instruction
      - encoding_detection
      - hidden_text
      - prompt_leaking
      - tool_abuse

  commands:
    enabled: true
    blocked_patterns:
      - 'rm -rf /'
      - 'rm -rf ~'
      - 'curl * | bash'
      - 'curl * | sh'
      - 'wget * | bash'
      - 'wget * | sh'
      - 'chmod 777 *'
      - ':(){ :|:& };:'
      - '> /dev/sd*'
      - 'mkfs *'
      - 'dd * of=/dev/*'
    require_approval:
      - 'sudo *'
      - 'npm publish *'
      - 'git push * main'
      - 'git push * master'
      - 'docker run * --privileged *'
    max_commands_per_minute: 60
    consecutive_block_threshold: 3

  network:
    enabled: true
    mode: blacklist
    allowed_domains: []
    blocked_domains: []
    block_private_ips: true
    max_payload_size_mb: 50
    scan_payload_for_pii: true

  filesystem:
    enabled: true
    forbidden:
      - '~/.ssh/'
      - '~/.aws/'
      - '~/.gnupg/'
      - '~/.env'
      - '~/.config/gcloud/'
      - '~/.kube/config'
      - '~/.docker/config.json'
      - '~/.npmrc'
      - '~/.pypirc'
      - '~/.netrc'
      - '/etc/shadow'
    restricted:
      - '~/.gitconfig'
      - '~/.bashrc'
      - '~/.zshrc'
      - '.github/workflows/'
    workspace:
      - '~/workspace/'
      - '~/projects/'
      - '~/code/'
      - '/tmp/'
    secret_patterns:
      - 'sk-[a-zA-Z0-9]{20,}'
      - 'ghp_[a-zA-Z0-9]{36}'
      - 'AKIA[A-Z0-9]{16}'
      - '-----BEGIN.*PRIVATE KEY'
      - 'sk-ant-[a-zA-Z0-9-]{20,}'

  behavior:
    enabled: true
    max_cost_per_session_usd: 10.00
    max_cost_per_hour_usd: 20.00
    loop_detection:
      window_size: 20
      similarity_threshold: 0.85
      consecutive_matches: 5
    sensitivity: medium

  mcp:
    enabled: true
    authorized_servers: []
    block_unauthorized: false
    scan_tool_results: true

dashboard:
  enabled: true
  port: 8788

audit:
  log_path: '~/.puffer/audit.jsonl'
  retention_days: 30

alerts:
  desktop: true
  webhook: null
```

---

## 11. Audit Logging

### 11.1 Log Format

Every event is logged as a single JSON line (JSONL) in `~/.puffer/audit.jsonl`.

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-03-12T14:30:00.000Z",
  "source": { "type": "proxy", "agent": "openclaw", "provider": "ollama", "model": "llama3" },
  "action": { "type": "llm_request", "method": "POST", "endpoint": "/api/chat" },
  "decision": "BLOCK",
  "layers": [
    {
      "layer": 1,
      "name": "pii_scanner",
      "verdict": "block",
      "confidence": 0.95,
      "details": "SSN detected",
      "durationMs": 1
    },
    {
      "layer": 2,
      "name": "injection_detector",
      "verdict": "allow",
      "confidence": 0.1,
      "durationMs": 3
    }
  ],
  "metadata": { "sessionId": "abc123", "sequenceNumber": 42, "costEstimate": 0 }
}
```

Note: The actual request/response bodies are NOT logged by default (privacy). Only metadata, decisions, and findings are logged. Bodies can be optionally logged for debugging.

---
