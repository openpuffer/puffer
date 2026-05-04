# Security Policy

Puffer is a security daemon — it sits between AI agents and LLM providers,
inspects every request and response, and blocks classes of attack on
behalf of its users. That position carries a responsibility: a flaw in
Puffer is a flaw in everything Puffer protects. We treat reports of
those flaws seriously and want them disclosed responsibly.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security problems.** Public
issues are crawled by attackers and turn into a head start.

Email the maintainers directly at **security@openpuffer.org**[^1] with:

- A short description of the vulnerability and the affected layer
  (`L1-pii`, `L2-injection`, ...) or component (proxy, hooks, daemon,
  dashboard, audit logger).
- A reproduction case — minimum config, request, or input that triggers
  the issue. A `tests/adversarial/` style example is ideal.
- Your assessment of impact (bypass, information disclosure, denial of
  service, etc.) and any CVSS score you've already computed.
- Whether you intend to publish a write-up, and your preferred
  disclosure timeline.

You will receive an acknowledgement within **3 business days**. If we
have not replied in that window, please follow up — your message may
have hit a spam filter.

[^1]:
    When the project moves out of personal-fork territory this becomes
    a real list. Until then, the maintainer's GitHub `@hypergrow-online`
    profile email is the canonical contact and reports are accepted
    privately at any contact listed there.

## Scope

In scope for security reports:

- **Bypass of any of the 7 defense layers** — a payload that should be
  blocked by L1-pii, L2-injection, L3-commands, L4-network,
  L5-filesystem, L6-behavior, or L7-mcp but isn't.
- **Authentication / authorization issues** in the dashboard server,
  proxy, or daemon IPC.
- **Information disclosure** — anything that would let an attacker read
  audit logs, configuration secrets, API keys, or PII that Puffer was
  meant to hide.
- **Privilege escalation** — anything that lets an unprivileged process
  on the same host gain control of the daemon or modify Puffer's hooks
  in agent settings.
- **Resource exhaustion / denial of service** that materially degrades
  Puffer's ability to evaluate requests (ReDoS in a layer regex, memory
  blow-up on a crafted payload, etc.).
- **Supply-chain issues** in Puffer's `dependencies` or in the YAML rule
  packs distributed under `rules/`.

Out of scope (please don't report these as vulnerabilities):

- Bugs in upstream LLM providers (OpenAI, Anthropic, Ollama, etc.) —
  report those to the provider directly.
- Findings against `node_modules/` dependencies that have already been
  documented in `docs/PROGRESS.md` as deferred non-runtime
  vulnerabilities (`uuid` v3/v5/v6 with `buf`, `esbuild` dev-server
  CORS).
- Theoretical attacks that require pre-existing root or admin access on
  the same host where Puffer runs.

## Disclosure Process

1. You report → we acknowledge within 3 business days.
2. We confirm the issue and propose a timeline. Default targets: **30
   days** for moderate / high severity, **90 days** for critical
   architectural fixes that need a release across multiple workspace
   packages.
3. We prepare a fix on a private branch, write an adversarial test that
   captures the exact bypass, and verify the test fails on `main` and
   passes after the fix.
4. We ship the fix in a patch release and credit you in the
   `CHANGELOG.md` entry (unless you ask to remain anonymous).
5. After the fix has been released we publish an advisory on GitHub
   Security Advisories and reference the corresponding CVE if one was
   assigned.

We do not currently run a paid bug bounty. Severe / impactful reports
are credited prominently in release notes and project documentation.

## Defensive Posture

A few practices Puffer follows so the project itself can be reasoned
about:

- **Strict TypeScript** with `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, and
  `useUnknownInCatchVariables` — no implicit `any` slipping through.
- **`zod` validation at every input boundary** (config YAML, rule packs,
  IPC messages between CLI and daemon).
- **No silent error swallowing.** ESLint blocks `catch {}` and
  `.catch(() => {})` patterns at the lint stage. Every catch logs.
- **Fail-closed mode available** — set `mode: paranoid` in
  `~/.puffer/config.yaml` and any layer error becomes a block instead
  of a pass.
- **Adversarial test suite** in `tests/adversarial/` — every released
  bypass acquires a regression test before its fix lands.
- **Dependency auditing** — Dependabot weekly + `npm audit` in CI.
  Documented exceptions live in `docs/PROGRESS.md`.

If you spot a place where Puffer falls short of the above, that itself
qualifies as a security report.
