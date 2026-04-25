# Testing Strategy

> Extracted from PUFFER-GUIDE.md (section 12).

## 12. Testing Strategy

### 12.1 Test Framework

Use `vitest` for all tests. Fast, TypeScript-native, compatible with Jest API.

### 12.2 Test Categories

**Unit tests** for each layer:

- PII Scanner: Test each regex pattern with positive and negative examples
- Injection Detector: Test each heuristic with real and synthetic attacks
- Command Analyzer: Test dangerous/safe commands, path traversal, blocklist
- Network Egress: Test whitelist/blacklist, DGA detection, SSRF blocking
- Filesystem: Test forbidden/restricted/workspace paths, secret detection
- Behavior: Test cost limits, loop detection, consecutive blocks
- MCP: Test unauthorized servers, tool injection

**Integration tests:**

- Full proxy flow: Request → Layers → Decision → Forward/Block
- Auto-discovery: Mock processes, ports, network connections
- Config loading and validation

### 12.3 Test Data

Create a `tests/fixtures/` directory with:

- `injection-attacks.json`: 50+ real prompt injection examples
- `safe-prompts.json`: 50+ normal prompts that should NOT be blocked
- `pii-samples.json`: Examples of each PII type
- `commands-dangerous.json`: Dangerous commands
- `commands-safe.json`: Safe commands

---
