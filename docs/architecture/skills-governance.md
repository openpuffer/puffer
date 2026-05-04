# Skills Governance

## What it does

Puffer's skill governance system gives operators full visibility into every AI skill installed across their environment and the ability to enforce allow/deny policies before any skill is invoked.

The scanner (`@puffer/skills`) walks known skill roots on the filesystem, fingerprints each skill directory with a SHA-256 content hash, and produces a typed `SkillInventory`. The daemon runs `SkillInventoryService` periodically (default every 30 seconds) and emits `skill_added`, `skill_modified`, or `skill_removed` events whenever the inventory changes. Layer 8 (`skill_governance`) intercepts every `skill_invoke` action that flows through the defense pipeline and enforces the configured allowlist or denylist. The Claude Code hook captures `Skill` tool invocations and converts them into `skill_invoke` events so they are governed and audited. The dashboard exposes the full inventory on `/api/skills` and shows a live Skills page with per-skill detail, real-time toast notifications for inventory changes, and policy-snippet generation for operators.

## Skill locations

| Source key            | Path                                     | Description                                   |
| --------------------- | ---------------------------------------- | --------------------------------------------- |
| `claude-code-global`  | `~/.claude/skills/<skill-name>/`         | Claude Code user-level skills (all projects)  |
| `claude-code-project` | `<project>/.claude/skills/<skill-name>/` | Claude Code project-local skills              |
| `openclaw-bundled`    | OpenClaw installation directory          | Skills shipped with the OpenClaw distribution |
| `openclaw-user`       | `~/.openclaw/skills/<skill-name>/`       | OpenClaw user-installed skills                |

Each skill root directory contains a `SKILL.md` manifest (optional but recommended) and any supporting files. Puffer identifies skills at the directory level — a skill is the whole directory, not a single file.

## Policy reference

Add a `layers.skills` block to `~/.puffer/config.yaml`:

```yaml
layers:
  skills:
    enabled: true # defaults to true

    # allowlist — only these skills may be invoked.
    # If set and non-empty, any skill NOT in this list is BLOCKED.
    allowlist:
      - simplify # match by name
      - claude-code-global/gsap-master # match by id (source/name)
      - sha256:abc123def456... # match by content hash prefix (min 8 chars)

    # denylist — these skills are BLOCKED regardless of allowlist.
    # Takes precedence over allowlist.
    denylist:
      - dangerous-skill
      - sha256:deadbeef

    # action — what to do when a skill is blocked (default: block in enforce mode).
    # Values: block | audit | log
    action: block
```

### Pattern syntax

| Pattern form          | Matches                                                                  |
| --------------------- | ------------------------------------------------------------------------ |
| `skill-name`          | Skill whose `name` field equals the string exactly                       |
| `source/skill-name`   | Skill whose `id` field equals `"<source>/<name>"` exactly                |
| `sha256:<hex-prefix>` | Skill whose `contentHash` starts with the given hex string (min 8 chars) |

Patterns are case-sensitive. Glob wildcards (`*`) within a name are supported for the name-only form (e.g., `gsap-*` matches `gsap-master` and `gsap-scroll`).

## Event types

All skill events flow through the standard Puffer event bus (audit log + WebSocket broadcast).

### `skill_invoke`

Emitted when an agent calls the `Skill` tool. Captured by the Claude Code PreToolUse hook.

```json
{
  "type": "skill_invoke",
  "skill": {
    "id": "claude-code-global/simplify",
    "name": "simplify",
    "contentHash": "abc123..." // present when inventory is available
  },
  "args": { "args": "fix the login component" }
}
```

### `skill_added`

Emitted by `SkillInventoryService` when a new skill directory appears.

```json
{
  "type": "skill_added",
  "skill": {
    /* SkillManifest — see types below */
  }
}
```

### `skill_modified`

Emitted when a skill's content hash changes (file modified, added, or removed within the directory).

```json
{
  "type": "skill_modified",
  "skill": {
    /* SkillManifest — new state */
  },
  "previousHash": "old-sha256-hash"
}
```

### `skill_removed`

Emitted when an entire skill directory is deleted.

```json
{
  "type": "skill_removed",
  "skill": {
    /* SkillManifest — last known state */
  }
}
```

### `SkillManifest` shape

```typescript
interface SkillManifest {
  id: string; // "<source>/<name>" — stable identifier
  name: string; // directory name (or frontmatter title)
  source: SkillSource; // see table above
  rootPath: string; // absolute path to the skill directory
  manifestPath: string | null; // path to SKILL.md, or null
  description: string; // from frontmatter or first paragraph; may be ""
  contentHash: string; // SHA-256 of all file contents (64 hex chars)
  lastModified: string; // ISO timestamp of newest file mtime
  sizeBytes: number; // total bytes of all skill files
  fileCount: number; // number of files in the skill directory
}
```

## API endpoints

### `GET /api/skills`

Returns the full current inventory as a JSON array of `SkillManifest` objects.

```
200 OK
Content-Type: application/json

[ { "id": "claude-code-global/simplify", ... }, ... ]
```

Returns `[]` if the inventory is not yet available.

### `GET /api/skills/:id`

Returns a single `SkillManifest` for the given skill `id` (URL-encoded).

```
GET /api/skills/claude-code-global%2Fsimplify

200 OK  → SkillManifest JSON
404     → { "error": "Skill not found" }
```

### `GET /api/skills/:id/manifest`

Returns the raw text content of the skill's `SKILL.md` manifest file.

```
GET /api/skills/claude-code-global%2Fsimplify/manifest

200 OK  → Content-Type: text/plain
          (raw SKILL.md content)

404     → { "error": "..." }   (skill not found, no manifest, or path outside roots)
```

**Path-safety guarantee**: the server resolves the `manifestPath` and checks that it falls under one of the known skill root directories before reading. Requests with paths outside the roots return 404 without reading any file.

## Threat model

Skills are executable code that runs inside Claude Code (or OpenClaw) with the same privileges as the agent. A compromised or malicious skill could exfiltrate data, run harmful commands, or override system prompts. Puffer's skill governance layer addresses this by: (1) maintaining a live content-hash inventory so operators know exactly which skills are installed and can detect tampering, (2) emitting `skill_modified` events immediately when a skill's files change, (3) enforcing an allowlist and/or denylist so unapproved skills are blocked before invocation in `enforce` mode.

Puffer does **not** currently provide: sandboxing or capability isolation for skill execution; ML-based threat scoring of skill content; cryptographic signature verification of skill authorship; static analysis of skill instructions for malicious patterns. These are flagged as future work.

## Limitations

- **Per-project Claude Code skill detection from hook is best-effort**: The Claude Code `Skill` tool call payload does not include the source (global vs. project). Puffer defaults to `claude-code-global` and derives the id as `claude-code-global/<name>`. If a project-local skill has the same name as a global one, the governance check matches whichever appears first in the inventory.
- **OpenClaw per-invocation hook not yet wired**: OpenClaw's skill invocations are not routed through the `skill_invoke` path. To enable per-invocation tracking for OpenClaw, hook OpenClaw's plugin API in-process (out of scope for this release).
- **No static analysis of skill content**: Puffer checks hashes and names but does not read or evaluate skill instructions. A skill in the allowlist is trusted as-is.
- **File listing not exposed via API**: The dashboard shows file counts and total size but does not list individual file paths per skill. A dedicated file-listing endpoint is a future addition.
- **Inventory refresh is polling-based**: The daemon rescans every 30 seconds (configurable). Changes made in between scans are not detected in real time.
