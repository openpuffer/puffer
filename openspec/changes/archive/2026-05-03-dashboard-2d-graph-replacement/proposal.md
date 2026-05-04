# Proposal: Reemplazo del grafo 3D del dashboard por Canvas 2D minimalista

## Intent

El componente `apps/dashboard/src/components/NetworkGraph3D.tsx` (740 líneas, basado en `react-force-graph-3d` + `three.js`) consume recursos desproporcionados respecto a la información que transmite: ~60 % del archivo es decoración pura (starfield de ~2900 partículas, 6 sprites de nebula, neural mesh, glow textures, fog, orbit-camera con rAF infinito) y solo ~40 % es topología real. El usuario reporta alto costo de CPU/GPU/memoria en idle y quiere un render más eficiente y minimalista, manteniendo la información topológica clave.

## Scope

### In Scope

- Reemplazar `NetworkGraph3D.tsx` por `NetworkGraph2D.tsx` con `react-force-graph-2d` (Canvas 2D, drag/zoom/click, partículas direccionales en links, pulse en BLOCK).
- Eliminar `three`, `@types/three`, `react-force-graph-3d` de `apps/dashboard/package.json`.
- Refactorizar `apps/dashboard/src/lib/agentIcons.ts` para sacar `three` y exportar `findDraw` + `drawPuffer` como `DrawFn` consumibles desde Canvas2D.
- Limpiar fields 3D-only (`z`, `fz`, `vz`) en `apps/dashboard/src/hooks/useGraphData.ts` y bloque CSS `.node-label-2d` en `index.css`.
- Cambiar import + tag JSX en `apps/dashboard/src/App.tsx` (mismo contrato de props).

### Out of Scope

- Cambios al backend (daemon `/ws`, endpoints REST, broadcast cadence).
- Reemplazo del HUD, Overview, EventList, AgentList, drawers, AgentDetailPanel, ConfigEditor, AlertList — ya son 2D.
- Tests unitarios de Canvas (no aportan valor; verificación es typecheck + lint + build + visual en `npm run dev`).
- Nuevos endpoints, nuevas capabilities de visualización, exportación de grafos.

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- None

> Pure refactor: no hay specs existentes para el dashboard y la información mostrada al usuario (topología, BLOCK feedback, tráfico) se preserva al 100 %. Lo que cambia es la implementación de render.

## Approach

Single-component swap con cleanup de dependencias. `useGraphData` (370 líneas) y el flujo de datos WebSocket→state→props quedan intactos. El nuevo `NetworkGraph2D.tsx` mantiene la API de props (`graphData`, `recentBlocks?`, `onNodeClick?`) para que `App.tsx` solo cambie el import y el tag. La animación de pulse en BLOCK se hace con `requestAnimationFrame` + `fgRef.current.refresh()` solo mientras `recentBlocks.size > 0`. Cooldown agresivo (`cooldownTicks=120`, `d3VelocityDecay=0.55`) deja de quemar CPU al estabilizarse.

## Affected Areas

| Area                                               | Impact   | Description                                                                      |
| -------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `apps/dashboard/src/components/NetworkGraph3D.tsx` | Removed  | Borrado completo (740 líneas)                                                    |
| `apps/dashboard/src/components/NetworkGraph2D.tsx` | New      | Reemplazo Canvas 2D                                                              |
| `apps/dashboard/src/lib/agentIcons.ts`             | Modified | Sacar `three`, exponer `findDraw` + `drawPuffer`                                 |
| `apps/dashboard/src/hooks/useGraphData.ts`         | Modified | Quitar `z`/`fz`/`vz`                                                             |
| `apps/dashboard/src/App.tsx`                       | Modified | Rename import + JSX tag                                                          |
| `apps/dashboard/src/index.css`                     | Modified | Quitar `.node-label-2d` group                                                    |
| `apps/dashboard/package.json`                      | Modified | Out: `three`, `@types/three`, `react-force-graph-3d`. In: `react-force-graph-2d` |

**Threat-model**: NO afecta `packages/layers/`, `packages/rules/`, `packages/proxy/`, engine, score, audit. Cambio aislado a frontend de visualización. Pipeline defensiva intacta.

**Strict TDD note**: el repo declara `strict_tdd: true` pero este cambio es UI Canvas pura sin e2e configurado. Snapshots de Canvas no aportan valor. Verificación efectiva: `npm run typecheck` + `npm run lint` + `npm run build` + `npm run dev` con checklist visual. Documentar en `tasks.md` que la fase apply NO requiere tests previos para el componente Canvas; sí mantener test runner verde para el resto del repo.

## Risks

| Risk                                                           | Likelihood | Mitigation                                                               |
| -------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| Distancias del force-layout 2D mal calibradas (sprawl o clump) | Med        | Tunear con fast-refresh en dev; documentar valores finales en comentario |
| Subagents con shape ring quedan inclickeables                  | Med        | `nodePointerAreaPaint` callback con disco fill en hit-canvas             |
| Pulse BLOCK queda congelado tras cooldown                      | Med        | rAF llama `fgRef.current.refresh()` mientras `recentBlocks.size > 0`     |
| Partículas en theme light se ven washed out                    | Low        | Bumpear `linkDirectionalParticleWidth` y verificar contraste             |
| `react-force-graph-2d` no instala / version mismatch           | Low        | Pin `^1.27.x`; correr `npm install` desde root del monorepo              |

## Rollback Plan

Cambio aislado a un commit. Rollback = `git revert <commit-sha>` + `npm install` desde root. Sin migraciones de datos, sin schema changes, sin coordinación con backend. El daemon sigue emitiendo el mismo payload por `/ws`. El dashboard previo (3D) y el nuevo (2D) consumen el mismo `useGraphData` output, así que un revert es simétrico.

## Dependencies

- npm registry alcanzable para instalar `react-force-graph-2d`.
- Node ≥ 18 (ya requerido por el monorepo).

## Success Criteria

- [ ] `grep -rn "from 'three'\|import \* as THREE" apps/dashboard/src` devuelve vacío.
- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` pasan limpios.
- [ ] `npm run build` produce bundle sin chunk de `three`; vendor gzip cae ≥ 150 KB.
- [ ] En `npm run dev`: grafo renderiza con Puffer central, drag/zoom/click funcionan, BLOCK pulsa rojo ~3s, partículas fluyen en links, theme toggle adapta colores, resize reflowea sin re-simular.
- [ ] DevTools Performance: < 2 % CPU main-thread en idle ≥ 5 s post-cooldown; sin instancias `WebGLRenderer` en heap snapshot.
