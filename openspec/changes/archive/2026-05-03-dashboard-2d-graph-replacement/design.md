# Design: Reemplazo del grafo 3D del dashboard por Canvas 2D

## Technical Approach

Single-component swap. `NetworkGraph2D.tsx` reemplaza a `NetworkGraph3D.tsx` con `react-force-graph-2d` (Canvas 2D, sin WebGL). Mantiene contrato de props (`graphData`, `recentBlocks?`, `onNodeClick?`) para que `App.tsx` solo cambie import + tag JSX. `useGraphData` se reusa sin cambios funcionales — el cache de identidad de nodo (L135), el throttle de 1500 ms (L121-132), el timer de 3 s sobre `recentBlocks` (L96-103) y la generación de links/partículas son frontend-agnósticos. Cleanup mínimo: tipos `z?/fz?/vz?` en `GraphNode` y `fz: 0` en el literal de Puffer (L168).

## Architecture Decisions

### ADR 1 — Render engine: `react-force-graph-2d` sobre alternativas

| Opción                               | Pros                                                                                                                                                                   | Contras                                                                               | Decisión    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------- |
| `react-force-graph-2d`               | API gemela del 3D actual (mismos field names: `linkColor`, `linkDirectionalParticles`, `nodeCanvasObject`); reusa `useGraphData` casi entero; drag/zoom/click built-in | +35 KB gzipped                                                                        | **Elegida** |
| SVG radial sin física (d3-hierarchy) | Más liviano (~12 KB); deterministic layout                                                                                                                             | Pierde drag dinámico; rewrite total de `useGraphData`; jugar a posicionar manualmente | Rechazada   |
| Lista jerárquica + sparklines        | Costo CPU mínimo                                                                                                                                                       | Pierde topología visual — usuario quiere preservar la metáfora del grafo              | Rechazada   |
| `d3-force` + Canvas custom           | Control total                                                                                                                                                          | Reescribir interacciones (zoom/pan/drag) que `react-force-graph-2d` ya da gratis      | Rechazada   |

**Rationale**: `react-force-graph-2d` minimiza superficie de cambio (mismas props, mismos field names en links/nodes) y preserva la UX de drag/zoom/click. El delta de bundle (+35 KB) es ampliamente compensado por sacar `three` (≈ −165 KB) + `react-force-graph-3d` (≈ −50 KB).

### ADR 2 — Pulse de BLOCK con rAF condicional

**Choice**: `useEffect` que arranca un `requestAnimationFrame` loop SOLO mientras `recentBlocks.size > 0`. Cada tick incrementa `pulsePhaseRef` y llama `fgRef.current.refresh()`.

**Alternatives considered**: (a) rAF siempre activo — quema CPU en idle, viola el objetivo del cambio. (b) CSS animation sobre overlay DOM — Canvas no anima vía CSS. (c) `framer-motion` — anima DOM/CSS, no Canvas pixels.

**Rationale**: una vez que el force-layout llega a `cooldownTicks`, el Canvas deja de redibujarse — sin `refresh()` el pulse rojo se pintaría una sola vez y quedaría congelado. El loop arranca solo bajo demanda (hay un block reciente) y se cancela cuando el `Set` se vacía. CPU idle se mantiene < 1 %.

### ADR 3 — Refactor de `agentIcons.ts` para desacoplar de `three`

**Choice**: borrar `import * as THREE from 'three'`, `texCache`, `makeIconTexture`, `getIconSprite`, `getPufferIconSprite`. Promover `findDraw(name): DrawFn` y `drawPuffer: DrawFn` a exports públicos. Las 11 `DrawFn` internas ya operan sobre `CanvasRenderingContext2D` con firma `(ctx, s, color?) => void` — son reusables tal cual desde `nodeCanvasObject`.

**Alternatives considered**: mantener `agentIcons.ts` con dual API (3D Sprite + 2D DrawFn) detrás de un flag — duplica lógica, agrega `three` al bundle aunque no se use, viola limpieza total decidida en proposal.

**Rationale**: las `DrawFn` ya están bien diseñadas como puro Canvas2D. Eliminar la capa de `THREE.CanvasTexture` + `THREE.Sprite` es la simplificación natural — el archivo queda libre de `three` y se vuelve consumible directo.

### ADR 4 — Cooldown agresivo del force-layout

**Choice**: `cooldownTicks={120}`, `d3AlphaDecay={0.04}`, `d3VelocityDecay={0.55}`, `warmupTicks={40}`.

**Alternatives considered**: defaults de `react-force-graph-2d` (`cooldownTicks=Infinity`, `alphaDecay≈0.0228`) — la simulación nunca para; CPU sostenido en idle.

**Rationale**: en este dashboard los eventos llegan a una cadencia controlada (stats cada 2 s, agents cada 10 s; `useGraphData` aplica throttle de 1500 ms). Una vez que el grafo se asienta, no hay valor en seguir simulando. La librería reheatea automáticamente cuando hay nodos/links nuevos. Trade-off: si entran muchos eventos en ráfaga, hay un breve "settle" visible — aceptable.

### ADR 5 — Hit-test offscreen para shapes stroke-only

**Choice**: `nodePointerAreaPaint` callback que pinta un disco fill del radio del nodo en el offscreen color-keyed canvas que `react-force-graph-2d` usa para click hit-testing.

**Rationale**: subagents se renderizan como ring stroke (sin fill). Sin `nodePointerAreaPaint` el hit-test queda con un agujero en el medio del anillo; clicks que caigan ahí no disparan `onNodeClick`. La librería expone este callback exactamente para este caso.

### ADR 6 — `framer-motion` queda fuera del Canvas

**Choice**: `framer-motion` se mantiene en el repo solo para drawer slide-in en `App.tsx` (uso preexistente). NO se importa en `NetworkGraph2D`.

**Rationale**: `framer-motion` anima DOM/CSS, no pixels de Canvas. Cualquier animación dentro del grafo (pulse BLOCK, fade-in de nuevos nodos) se hace con rAF + `globalAlpha` dentro de `nodeCanvasObject`. Mezclar ambos da incoherencia de timing y costo extra.

## Data Flow

    daemon/server.ts ── /ws ──▶ useWebSocket ──▶ App.state{liveEvents, agents}
                                                          │
                                                          ▼
                                                  useGraphData (cache+throttle)
                                                          │
                              ┌───────────────────────────┴──────────────────┐
                              ▼                                              ▼
                      NetworkGraph2D                                 recentBlocks: Set<string>
                      (Canvas 2D render)                             (timer 3 s)
                              │                                              │
                              └─────── pulse rAF (condicional) ◀─────────────┘

**Boundary**: data flow no cruza `packages/layers/`, `packages/proxy/`, `packages/score/`, `packages/audit/`. Cambio confinado a `apps/dashboard/src/`.

## File Changes

| File                                               | Action | Description                                                                                                                          |
| -------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/dashboard/src/components/NetworkGraph2D.tsx` | Create | Componente nuevo — `react-force-graph-2d` con `nodeCanvasObject` + `nodePointerAreaPaint` + rAF condicional                          |
| `apps/dashboard/src/components/NetworkGraph3D.tsx` | Delete | 740 líneas, único consumidor de `three` post-refactor                                                                                |
| `apps/dashboard/src/lib/agentIcons.ts`             | Modify | Sacar `import * as THREE`, `texCache`, `makeIconTexture`, `getIconSprite`, `getPufferIconSprite`. Exportar `findDraw` + `drawPuffer` |
| `apps/dashboard/src/hooks/useGraphData.ts`         | Modify | Quitar `z?/fz?/vz?` de `GraphNode`; quitar `fz: 0` del literal Puffer (L168)                                                         |
| `apps/dashboard/src/App.tsx`                       | Modify | L4: rename import; L173: rename JSX tag                                                                                              |
| `apps/dashboard/src/index.css`                     | Modify | Quitar `.node-label-2d` group (~L116-170); preservar `.scene-tooltip`, `.graph-canvas-wrapper canvas`, `.vignette-overlay`           |
| `apps/dashboard/package.json`                      | Modify | Out: `three@^0.183.2`, `@types/three@^0.183.1`, `react-force-graph-3d@^1.29.1`. In: `react-force-graph-2d@^1.27.0`                   |

## Interfaces / Contracts

```ts
// agentIcons.ts — nuevo public API
export type DrawFn = (ctx: CanvasRenderingContext2D, s: number, color?: string) => void;
export function findDraw(name: string): DrawFn;
export const drawPuffer: DrawFn;
```

```tsx
// NetworkGraph2D.tsx — props (idénticas al 3D)
interface NetworkGraph2DProps {
  graphData: GraphData; // de useGraphData
  recentBlocks?: Set<string>;
  onNodeClick?: (node: GraphNode) => void;
}
```

`GraphNode` y `GraphLink` (de `useGraphData`) se consumen tal cual; no hay nuevo tipo público.

## Testing Strategy

| Layer         | What to Test                                                                                                  | Approach                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Unit          | `findDraw(name)` resuelve correctamente keywords (claude→drawClaude, openai→drawOpenAI, fallback→drawGeneric) | Vitest spec corto en `tests/dashboard/agentIcons.test.ts` (nuevo)            |
| Integration   | Suites existentes del repo (layers, rules, proxy) siguen pasando                                              | `npm test` desde root                                                        |
| Quality gates | typecheck + lint + format + build limpios                                                                     | `npm run typecheck && npm run lint && npm run format:check && npm run build` |
| Visual / E2E  | Render del grafo, drag, zoom, click→drawer, BLOCK pulse, partículas, theme toggle, resize, idle CPU < 2 %     | Manual checklist en `npm run dev` (sin framework e2e en el repo)             |

**Strict TDD**: el repo declara `strict_tdd:true`. Para `agentIcons.test.ts` aplica RED-GREEN-REFACTOR (test antes que la promoción de exports). Para `NetworkGraph2D.tsx` (Canvas puro) NO aplica — snapshots de Canvas no aportan valor; la verificación es por quality gates + checklist visual. Esto se documenta explícitamente en `tasks.md`.

## Migration / Rollout

No migration required. Cambio aislado a un commit; rollback simétrico vía `git revert` + `npm install`. Daemon sigue emitiendo el mismo payload por `/ws`. El componente previo y el nuevo consumen la misma estructura de `useGraphData`.

## Open Questions

- None — todas las decisiones cerradas durante plan mode con confirmación del usuario.
