# Skill Registry — openpuffer

**Generated**: 2026-05-03 by sdd-init
**Project**: openpuffer (TypeScript ESM monorepo)

This registry is consumed by the SDD orchestrator before each sub-agent launch. It pairs available user skills with compact rules to inject as `## Project Standards (auto-resolved)`.

## Project Conventions Detected

- No top-level `agents.md` / `AGENTS.md` / `CLAUDE.md` / `.cursorrules` / `GEMINI.md` / `copilot-instructions.md` in repo root.
- Architectural conventions live in `docs/architecture/*` and `SECURITY.md`. Treat these as authoritative for layer/rule/threat-model context.
- Operational state in `docs/PROGRESS.md`.

## User Skills (Trigger Map)

Skips: `sdd-*`, `_shared`, `skill-registry`.

| Skill                    | Match contexts (code or task triggers)                                  |
| ------------------------ | ----------------------------------------------------------------------- |
| update-config            | `.claude/settings.json` changes; permissions / env vars / hooks edits   |
| keybindings-help         | `~/.claude/keybindings.json`; user asks about shortcuts                 |
| simplify                 | After substantial diffs — review for reuse, quality, efficiency         |
| fewer-permission-prompts | Repeated permission prompts; allowlist tuning                           |
| loop                     | Recurring task / polling / interval execution                           |
| schedule                 | Cron / scheduled remote agents / one-time future runs                   |
| claude-api               | Files importing `anthropic` / `@anthropic-ai/sdk`; Claude API/SDK work  |
| glsl-shaders             | Three.js / R3F custom shader work (NOT applicable in this project)      |
| email-templates          | MJML / React Email / transactional emails (NOT applicable)              |
| go-testing               | `*.go` / `go.mod` / Bubbletea TUI (NOT applicable)                      |
| skill-creator            | Creating new AI skill files                                             |
| cinematic-3d-scroll      | GSAP + R3F cinematic scroll (NOT applicable)                            |
| mdx-blog                 | MDX/Velite/Contentlayer blog setup (NOT applicable)                     |
| branch-pr                | Opening a PR; preparing changes for review                              |
| gsap-master              | GSAP animations in React/Vite (NOT applicable)                          |
| issue-creation           | Creating GitHub issues                                                  |
| judgment-day             | Adversarial dual-judge code review                                      |
| ui-ux-pro-max            | UI/UX work for web/app (NOT applicable in current scope — daemon + CLI) |
| awwwards-patterns        | Award-quality portfolio patterns (NOT applicable)                       |
| init                     | Generate CLAUDE.md for this codebase                                    |
| review                   | Pull request review                                                     |
| security-review          | Security review of pending branch changes                               |

**High-relevance for this project**: `simplify`, `branch-pr`, `issue-creation`, `judgment-day`, `review`, `security-review`, `claude-api` (only if the change touches Anthropic SDK usage).

## Compact Rules

These blocks are pre-digested rules to inject into sub-agent prompts based on matched skills.

### simplify

- After non-trivial diffs, scan for: duplicated logic across packages/layers, premature abstractions, dead code, comments that restate code.
- Three similar lines is fine; do not abstract speculatively.
- Remove unused vars/exports; do not leave `_unused` shims.

### branch-pr

- Branch name: `<type>/<short-slug>` (e.g. `feat/layer-mcp-allowlist`, `fix/proxy-sse-buffer`).
- PR title: conventional commit style (no `Co-Authored-By`, no AI attribution).
- PR body: Summary (≤3 bullets) + Test plan (checklist).

### issue-creation

- Issue title in conventional commit form (`feat: …`, `fix: …`).
- Body sections: Context, Acceptance criteria, Out of scope.

### review / security-review

- For layer/rule changes, audit: positive-and-negative test coverage, default-mode behavior change, regex catastrophic backtracking, new external dependencies.
- Threat-model: trust boundary between agent process ↔ proxy ↔ LLM provider must be preserved.

### judgment-day

- Use ONLY when user explicitly invokes — adversarial dual judges; high token cost.
- Target must be a concrete artifact (PR diff, file path, or change name).

### claude-api

- If touching Anthropic SDK: include prompt caching; default to latest models (`claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`).
- This codebase ships its own model-agnostic proxy — the rule applies only when WE are the SDK consumer (e.g., red-team scripts, internal tooling).

## Project-Specific Standards (always inject when touching code)

### TypeScript / ESM

- All packages are ESM (`"type": "module"`); use explicit `.js` extensions in relative imports if you ever switch off path aliases.
- Imports across packages MUST use `@puffer/*` aliases defined in `tsconfig.json` paths.
- Never break TS project references — `apps/cli` and `apps/daemon` build via `tsc -b`.

### Layer pattern

- Each layer in `packages/layers/<name>/src/` follows the same shape — read a sibling layer (e.g., `packages/layers/pii`) before adding a new one.
- Layers MUST NOT import vocabulary from other layers (no cross-layer leakage).
- Constants centralized; no inline regex/severity literals.

### Testing

- Test runner: `npm test` (vitest run). Watch: `npm run test:watch`.
- Test layout: `tests/<area>/*.test.ts`. Mirror the package being tested.
- For detection logic, every rule change requires positive + negative test cases (true-positive + true-negative).
- Adversarial suite: `tests/adversarial` — must pass before merging rule/layer changes.

### Quality gates

- `npm run typecheck` (tsc --noEmit) must be clean.
- `npm run lint` must be clean.
- `npm run format:check` should pass (prettier).
- husky pre-commit runs lint-staged — never `--no-verify`.

### Commits

- Conventional Commits ONLY. No `Co-Authored-By`, no AI attribution.
- Never `--no-verify`, never amend pushed commits.

### Docs

- Architecture changes → update `docs/architecture/*` matching file.
- State changes → update `docs/PROGRESS.md`.
- Threat-model changes → update `SECURITY.md`.
