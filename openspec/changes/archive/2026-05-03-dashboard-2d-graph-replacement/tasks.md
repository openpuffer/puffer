# Tasks: dashboard-2d-graph-replacement

## Phase 1 — Dependencies

- [x] 1.1 Editar `apps/dashboard/package.json`: quitar `three`, `@types/three`, `react-force-graph-3d`. Agregar `react-force-graph-2d` (^1.27.0).
- [x] 1.2 Correr `npm install` desde root del monorepo. Verificar lockfile actualizado y nuevas deps en `node_modules/`.

## Phase 2 — Refactor `agentIcons.ts` (TDD)

- [x] 2.1 Crear `tests/dashboard/agentIcons.test.ts` con casos: `findDraw('claude-code')` → drawClaude; `findDraw('openai')` → drawOpenAI; `findDraw('unknown-name-xyz')` → drawGeneric; `drawPuffer` exists. Test debe FALLAR antes de 2.2 (RED).
- [x] 2.2 Modificar `apps/dashboard/src/lib/agentIcons.ts`: quitar `import * as THREE from 'three'`, `texCache`, `makeIconTexture`, `getIconSprite`, `getPufferIconSprite`. Promover `findDraw` y `drawPuffer` a `export`. Exportar el tipo `DrawFn`. Test debe PASAR (GREEN).
- [x] 2.3 Confirmar que `apps/dashboard/src` ya no importa `three` (excepto desde `NetworkGraph3D.tsx` que se borra después).

## Phase 3 — Cleanup `useGraphData.ts`

- [x] 3.1 Quitar de `interface GraphNode`: `fz?`, `z?`, `vz?` (líneas ~12, 18, 21).
- [x] 3.2 Quitar `fz: 0` del literal de Puffer (L168).
- [x] 3.3 Actualizar comentario JSDoc de `useGraphData` para mencionar `ForceGraph2D` en vez de `ForceGraph3D`.

## Phase 4 — Crear `NetworkGraph2D.tsx`

- [x] 4.1 Crear `apps/dashboard/src/components/NetworkGraph2D.tsx` con:
  - Imports: React refs/hooks, `ForceGraph2D` y `ForceGraphMethods` de `react-force-graph-2d`, `GraphData/GraphNode` de `../hooks/useGraphData`, `findDraw`/`drawPuffer`/`DrawFn` de `../lib/agentIcons`, `useTheme` de `../hooks/useTheme`.
  - Props: `{ graphData, recentBlocks?, onNodeClick? }` idénticas al componente 3D.
  - Estado: `dims = { w, h }` con resize listener; `fgRef` ref a `ForceGraphMethods`; `pulsePhaseRef` para animación.
  - Force config en `useEffect` post-mount: charge strength `−180/−40`, link distance `110/50`, center `0.05`.
  - `nodeCanvasObject` callback: dispatch por `node.type` — puffer (disco amber + core + drawPuffer), provider (rombo + findDraw), mcp (cuadrado), subagent (ring stroke), agent (disco + findDraw). Halo radial-gradient. Pulse `1 + 0.18 * sin(phase * 0.18)` cuando `recentBlocks.has(node.id)`. Labels solo cuando `globalScale > 0.6`.
  - `nodePointerAreaPaint` callback: disco fill del radio del nodo en hit-canvas.
  - rAF condicional para pulse: `useEffect` que arranca loop solo si `recentBlocks.size > 0` y llama `fgRef.current.refresh()`.
  - Link config: `linkColor="color"`, `linkWidth={1}`, `linkCurvature="curvature"`, `linkDirectionalParticles="particleCount"`, `linkDirectionalParticleSpeed="particleSpeed"`, `linkDirectionalParticleWidth={2.5}`, `linkDirectionalParticleColor="particleColor"`.
  - Cooldown: `cooldownTicks={120}`, `d3AlphaDecay={0.04}`, `d3VelocityDecay={0.55}`, `warmupTicks={40}`, `minZoom={0.3}`, `maxZoom={6}`.
  - `onNodeClick`: invoca prop + `centerAt` + `zoom`.
  - `onNodeDrag`/`onNodeDragEnd`: toggle de class `dragging-node` en wrapper.
  - `backgroundColor` según theme.
  - Wrapper `<div className="absolute inset-0 graph-canvas-wrapper">` + opcional `<div className="vignette-overlay" />`.

## Phase 5 — Wire-up `App.tsx`

- [x] 5.1 L4: cambiar `import NetworkGraph3D from './components/NetworkGraph3D'` → `import NetworkGraph2D from './components/NetworkGraph2D'`.
- [x] 5.2 L173: cambiar tag `<NetworkGraph3D …/>` → `<NetworkGraph2D …/>`. Props sin cambio.

## Phase 6 — Cleanup CSS

- [x] 6.1 En `apps/dashboard/src/index.css`: borrar bloque `.node-label-2d`, `.node-label-name`, `.node-label-tag`, `.node-label-host` y sus variantes dark (~L116-170).
- [x] 6.2 Preservar `.scene-tooltip`, `.graph-tooltip`, `.graph-canvas-wrapper canvas`, `.vignette-overlay`.

## Phase 7 — Borrar 3D

- [x] 7.1 Borrar `apps/dashboard/src/components/NetworkGraph3D.tsx`.
- [x] 7.2 `rg "from 'three'|import \\* as THREE" apps/dashboard/src` debe devolver vacío.

## Phase 8 — Quality gates

- [x] 8.1 `npm run typecheck` — limpio.
- [x] 8.2 `npm run lint` — limpio.
- [x] 8.3 `npm run format:check` — pasa.
- [x] 8.4 `npm test` — suites del repo pasan; agentIcons.test.ts pasa.
- [x] 8.5 NO correr `npm run build` (rule del usuario "Never build after changes" — el build queda para verificación manual).

## Phase 9 — Visual checklist (manual, post-apply)

- [x] 9.1 `npm run dev` desde `apps/dashboard`. Browser: grafo renderiza, drag/zoom/click funcionan, BLOCK pulsa rojo ~3 s, partículas en links, theme toggle adapta colores, resize reflowea sin re-simular.
- [x] 9.2 DevTools Performance idle 5 s post-cooldown: < 2 % CPU main-thread, sin rAF activo.
- [x] 9.3 DevTools Memory snapshot: sin instancias `WebGLRenderer` ni `THREE.Scene`.

## Notes

- Strict TDD aplica solo a Phase 2 (test antes de promover exports en `agentIcons.ts`). Para `NetworkGraph2D.tsx` (Canvas puro) NO aplica — verificación es por quality gates + checklist visual manual. Justificación en design.md ADR + testing strategy.
- Phase 9 es manual y queda para el usuario tras la implementación.
