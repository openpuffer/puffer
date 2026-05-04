# Verify Report: dashboard-2d-graph-replacement

**Date**: 2026-05-03

## Quality Gates

| Gate                 | Command                                            | Result                                                                     |
| -------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| Root typecheck       | `npm run typecheck`                                | ✅ clean                                                                   |
| Dashboard typecheck  | `npx tsc --noEmit -p apps/dashboard/tsconfig.json` | ✅ clean                                                                   |
| Lint                 | `npm run lint`                                     | ✅ clean                                                                   |
| Format check         | `npm run format:check`                             | ✅ clean                                                                   |
| Tests                | `npm test -- --run`                                | ✅ 256/256 (27 files)                                                      |
| `agentIcons.test.ts` | included in `npm test`                             | ✅ 7/7                                                                     |
| Build                | `npm run build*`                                   | ⏭ skipped per user rule "Never build after changes" — manual verification |

## Spec coverage

- **CRITICAL**: none. No new specs in scope (`Capabilities=None/None` per proposal — pure refactor).
- **WARNING**: none.
- **SUGGESTION**: when running the dashboard manually, verify Phase 9 visual checklist in `tasks.md` (drag/zoom/click, BLOCK pulse ~3s, particles, theme toggle, resize, idle CPU < 2%, no `WebGLRenderer` in heap).

## Implementation summary

- Removed: `apps/dashboard/src/components/NetworkGraph3D.tsx` (740 LOC).
- Created: `apps/dashboard/src/components/NetworkGraph2D.tsx` (~210 LOC, Canvas 2D).
- Refactored: `apps/dashboard/src/lib/agentIcons.ts` — dropped `three`, exported `findDraw` + `drawPuffer` + `DrawFn`. Reordered `ICON_DB` so subagent aliases match before generic claude.
- Cleaned: `useGraphData.ts` (z/fz/vz fields), `App.tsx` (import + tag), `index.css` (.node-label-2d group), `package.json` (out: three, @types/three, react-force-graph-3d; in: react-force-graph-2d).
- Added: `tests/dashboard/agentIcons.test.ts` (7 tests).
- Adjusted: root `tsconfig.json` `exclude` adds `tests/dashboard/**` so the Node-targeted root typecheck does not pull DOM-dependent dashboard code via test imports. The dashboard tsconfig (with DOM lib) covers that surface separately.

## Deviations from plan

1. **`refresh()` API was not available** in `react-force-graph-2d`. Replaced with: pulse phase computed from `Date.now()` inside `nodeCanvasObject` + `setInterval` calling `d3ReheatSimulation()` while `recentBlocks.size > 0`. Same effect, more robust — falls back gracefully if the API surface evolves.
2. **`tsconfig.json` exclude tweak** was not in the original plan. Necessary because the root tsc compiles `tests/**/*.ts` with Node-only lib but the new dashboard test imports DOM-dependent code. Surface change is minimal and self-documenting.

## Risks (proposal) — current status

| Risk                                          | Status        | Notes                                                                                               |
| --------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| Distancias del force-layout 2D mal calibradas | Open (manual) | Tunear con fast-refresh en dev si hace falta. Defaults `110/50` parten de la heurística del plan.   |
| Subagents inclickeables (ring stroke)         | Mitigated     | `nodePointerAreaPaint` callback implementado; pinta disco fill en hit-canvas.                       |
| Pulse BLOCK congelado                         | Mitigated     | `d3ReheatSimulation` en interval mantiene render activo mientras `recentBlocks.size > 0`.           |
| Partículas en theme light washed out          | Open (manual) | `linkDirectionalParticleWidth=2.5` (subido desde el default 1). Verificar visualmente.              |
| `react-force-graph-2d` install/version        | Closed        | Instalado `^1.27.0`; `npm install` removed 19 packages, added 8 (consistente con sacar three + 3d). |

## Build deferral note

The user's global rule says "Never build after changes". The `npm run build*` quality gate was therefore skipped. To complete success criteria from `proposal.md`:

- `[ ]` "bundle vendor sin chunk de three" → run `npm run build:dashboard` manually and inspect.
- `[ ]` "vendor gzip cae ≥ 150 KB" → compare bundle output before/after in `apps/dashboard/dist/`.

Both are deferred to manual verification.
