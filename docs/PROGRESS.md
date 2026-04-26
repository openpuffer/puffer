# Puffer — Refactor Progress Log

> Plan maestro: `~/.claude/plans/hazme-un-analisis-completo-lexical-rossum.md`
> Owner: hypergrow-online
> Started: 2026-04-25

Este documento es el **estado vivo** del refactor de profesionalización de Puffer. Se actualiza después de cada commit para que cualquier humano o agente que entre al repo entienda qué se hizo, qué falta, y por qué.

---

## Leyenda de estados

- `pending` — no empezado
- `in_progress` — en curso
- `done` — mergeado a main, verificado
- `blocked` — bloqueado por otra tarea o decisión

---

## Quick Wins (PRs pequeños, mergeables independientes)

| #   | Quick Win                                      | Estado     | Commit      | Notas                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------- | ---------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Sacar `dist/` del control de versiones         | n/a        | -           | ❌ Falso positivo del audit. `git ls-files dist/` confirma que ya está ignorado.                                                                                                                                                                                                  |
| 2   | Endurecer `tsconfig.json`                      | done (1/3) | uncommitted | Aplicado `noImplicitOverride`. `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes` promovidos a QW2b/QW2c (~76 errores mecánicos).                                                                                                                                          |
| 2.5 | **PRE-QW2** Fix tipos rotos `src/rules`        | done       | uncommitted | Bug pre-existente: `PufferRule.version` y `RuleManifest` no existían pese a usarse. Baseline tsc estaba rota.                                                                                                                                                                     |
| 3   | Prettier + `.editorconfig` + `.prettierignore` | done       | uncommitted | 65 archivos reformateados; `format`/`format:check` agregados.                                                                                                                                                                                                                     |
| 4   | ESLint flat config + `eslint-config-prettier`  | done       | uncommitted | 86→0 errores. Custom rules detectan empty catch + `.catch(() => {})`. Bugs reales encontrados (catch sin log en dashboard, código muerto en vscode-extension).                                                                                                                    |
| 5   | GitHub Actions CI (lint/typecheck/test/build)  | done       | uncommitted | Matrix Node 18/20/22 para tests. Quality gate (lint+format+typecheck), build (daemon+dashboard), Dependabot weekly.                                                                                                                                                               |
| 6   | Husky + lint-staged pre-commit                 | done       | uncommitted | Pre-commit: prettier+eslint-fix sobre staged. Pre-push: typecheck.                                                                                                                                                                                                                |
| 7   | Validar `PufferConfig` con zod                 | done       | uncommitted | `src/schemas/config.ts` con 12 sub-schemas. **Bug crítico encontrado**: `blockPrivateIPs`/`scanPayloadForPII` no matcheaban con camelCase del YAML — protección anti-SSRF estaba silenciosamente desactivada. Renombrado a `blockPrivateIps`/`scanPayloadForPii`. 4 tests nuevos. |
| 8   | Validar `PufferRule` + regex segura            | done       | uncommitted | `src/schemas/rule.ts` con `.refine()` que exige al menos un criterio de detección. Loader pre-compila regex y descarta reglas con patrones inválidos (antes: `catch { return false }` → bypass silencioso). 8 tests nuevos.                                                       |
| 9   | Tipar IPC CLI ↔ daemon (eliminar `as any`)     | done       | uncommitted | `src/types/ipc.ts` con `DaemonReadyMessage` discriminado + `isDaemonReadyMessage` type guard. Zero `as any` en el flujo IPC.                                                                                                                                                      |
| 10  | Reemplazar `.catch(() => {})` por handlers     | done       | uncommitted | 6 sitios cubiertos. Patrón uniforme: log + dejar la cadena seguir cuando es fire-and-forget. ESLint rule promovido de `warn` → `error` para bloquear regresiones.                                                                                                                 |
| 11  | Partir `PUFFER-GUIDE.md` en `docs/`            | done       | uncommitted | 6 archivos bajo `docs/architecture/` + `README.md` índice. Original eliminado, README raíz actualizado con sección Documentation.                                                                                                                                                 |
| 2b  | `noUncheckedIndexedAccess` (~46 errores)       | pending    | -           | Sub-tarea de QW2 (delegar a subagente).                                                                                                                                                                                                                                           |
| 2c  | `exactOptionalPropertyTypes` (~30 errores)     | pending    | -           | Sub-tarea de QW2 (más arquitectónica).                                                                                                                                                                                                                                            |

---

## Fases estructurales (cuando los quick wins estén listos)

| Fase | Nombre                               | Estado  | Notas                                 |
| ---- | ------------------------------------ | ------- | ------------------------------------- |
| 0    | Higiene mínima (cubierta por QW 1-3) | pending |                                       |
| 1    | Quality gates en CI (QW 5-6)         | pending |                                       |
| 2    | Validación + boundary hardening      | pending | Cubre QW 7-10                         |
| 3    | Reordenamiento a npm workspaces      | pending | apps/ + packages/                     |
| 4    | Robustez de capas + streaming SSE    | pending |                                       |
| 5    | Observabilidad + release engineering | pending | Métricas Prometheus, benchmarks gates |

---

## Hallazgos críticos confirmados (referencia rápida)

| Severidad             | Archivo                         | Línea         | Problema                                                                                                              | Estado                                                       |
| --------------------- | ------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| CRÍTICO               | `src/utils/config.ts`           | 25-48         | Config YAML cargada con cast, sin validación                                                                          | ✅ resuelto QW7                                              |
| CRÍTICO               | `src/rules/loader.ts`           | 41-51, 58, 63 | Validación OR débil; regex inválida → `false` silencioso (bypass)                                                     | ✅ resuelto QW8                                              |
| CRÍTICO               | `src/index.ts`                  | 313-314       | Alertas tragadas con `.catch(() => {})`                                                                               | ✅ resuelto QW10                                             |
| CRÍTICO               | `src/discovery/index.ts`        | 121           | Errores de scan tragados                                                                                              | ⚠ revisar — no aparece en lint, líneas pueden haber cambiado |
| CRÍTICO               | `src/cli/index.ts`              | 73-74         | `(msg as any)` en mensajes IPC                                                                                        | ✅ resuelto QW9                                              |
| CRÍTICO (descubierto) | `src/types.ts`                  | 232, 234      | `blockPrivateIPs`/`scanPayloadForPII` no matcheaban con camelCase del YAML — protección anti-SSRF silenciosamente off | ✅ resuelto QW7                                              |
| ALTO                  | `tsconfig.json`                 | -             | Falta `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`                                  | 🟡 1/3 (override) — QW2b/c pendientes                        |
| ALTO                  | `src/layers/index.ts`           | -             | Pipeline hardcodea las 7 capas, sin DI                                                                                | pending (Fase 3)                                             |
| ALTO                  | `src/layers/layer-4-network.ts` | -             | Importa `PII_PATTERNS` de L1 (acoplamiento entre capas)                                                               | pending (Fase 4)                                             |
| ALTO                  | `src/layers/helpers.ts`         | -             | Godfile oculto: 200+ LOC, dependencia central no documentada                                                          | pending (Fase 4)                                             |
| ALTO                  | `src/dashboard/server.ts`       | -             | 1104 LOC, mezcla WS + stats + HTTP                                                                                    | pending (Fase 4)                                             |
| ALTO                  | `src/proxy/handler.ts`          | 387           | `.then()` async-mezclado; no intercepta streaming                                                                     | pending (Fase 4)                                             |
| MEDIO                 | repo root                       | -             | CI ausente, sin ESLint/Prettier/Husky                                                                                 | ✅ resuelto QW3-6                                            |

---

## Bitácora cronológica

### 2026-04-25 (sesión 1)

- **Análisis inicial completado.** 3 Explore agents en paralelo mapearon arquitectura, ops, y red flags de calidad. Plan completo guardado en `~/.claude/plans/hazme-un-analisis-completo-lexical-rossum.md`.
- **Tasks creadas (15 items)** para los 11 quick wins + el progress log + sub-tareas de QW2.
- **PROGRESS.md inicializado** (este archivo).
- **Hallazgo: `dist/` no estaba commited** — el audit fue falso positivo. `git ls-files dist/` retornó vacío. Sin acción.
- **Hallazgo: tsc baseline estaba rota** (4 errores en `src/rules/updater.ts`). `PufferRule.version` y `RuleManifest` no existían pese a usarse en código en producción. Esto explica por qué nadie corre `npm run lint`.
  - Fix: agregado `version?: string` a `PufferRule`, exportadas `RuleManifest` + `RuleManifestEntry` en `src/rules/types.ts`.
- **QW2 parcial:** aplicado `noImplicitOverride` solo (0 errores). Los otros 2 flags strict generan ~76 errores; promovidos a QW2b/QW2c.
- **QW3 done:** prettier + .editorconfig + .prettierignore. 65 archivos reformateados, 218 tests siguen pasando.
- **QW4 done:** ESLint 9 flat config con `typescript-eslint` + `eslint-config-prettier` + custom rules:
  - Empty catch blocks → error
  - `.catch(() => {})` → warning (será error tras QW10)
  - 86 issues iniciales → 0 errors / 8 warnings (todas las warnings son `.catch(() => {})` que QW10 limpia)
  - Mecánicamente arregladas: 14 unused imports/vars, 2 useless escapes en `weekly.ts`.
  - Falso positivo `no-misleading-character-class` en `layer-2-injection.ts:53` (regex de zero-width chars para detección de esteganografía) → comentado y suprimido con explicación.
  - Bug encontrado: `src/dashboard/server.ts:266,283` tenía `} catch (err) {` sin loguear. Fix: agregado `logger.error(...)` antes del `res.status(500)`.
  - Bug encontrado: `src/hooks/vscode-extension.ts` tenía `PUFFER_EXT_ID` y `isVSCodeAvailable()` declarados pero nunca usados — código muerto. Removidos.
- **QW5 done:** `.github/workflows/ci.yml` con jobs `quality`, `test` (matrix Node 18/20/22), `build` (daemon + dashboard). Dependabot weekly.
- **QW6 done:** Husky 9 + lint-staged. `.lintstagedrc.json` corre prettier+eslint sobre staged TS. Pre-push: typecheck.

**Estado del repo:** todo uncommitted hasta que el usuario quiera revisar antes de commitear.

### Continuación sesión 1 (mismo día)

- **QW7 done — bug crítico de config validation:** `src/schemas/config.ts` valida `PufferConfig` con zod. Errores formateados con `zod-validation-error`. **Hallazgo gordo:** los campos `blockPrivateIPs` y `scanPayloadForPII` (mayúsculas) no matcheaban con la salida de `camelCaseKeys` (que produce `blockPrivateIps`/`scanPayloadForPii`). Al cargar config desde YAML, **el bloqueo de IPs privadas estaba silenciosamente desactivado** porque `config.blockPrivateIPs` siempre era `undefined`. Renombrado a camelCase estándar en 8 archivos.
  - Helper `stripNulls()` agregado para tratar `webhook: null` en YAML como campo ausente.
  - 4 tests nuevos en `tests/utils/config.test.ts` cubriendo: default policy parses, null webhook, mode inválido, threshold fuera de rango.
- **QW8 done — bug crítico de rule bypass:** `src/schemas/rule.ts` con zod schema + `.refine()` que exige al menos un criterio de detección. `loader.ts` reescrito: pre-compila regex en load-time, descarta y loguea reglas con patrones inválidos (antes: `catch { return false }` silencioso → ataque pasaba). 8 tests nuevos en `tests/rules/loader.test.ts`.
- **QW9 done:** `src/types/ipc.ts` con `DaemonMessage` discriminado y `isDaemonReadyMessage()` type guard. Eliminado `(msg as any)` en `src/cli/index.ts`. El daemon emite `DaemonReadyMessage` tipado en `src/index.ts`.
- **QW10 done:** Los 6 sitios `.catch(() => {})` reemplazados con handlers que loguean y dejan la cadena seguir (fire-and-forget pattern). Patrón uniforme: warn una vez al transitionar a "offline" para evitar spam, error si es bug interno. ESLint rule promovido de `warn` → `error` para bloquear regresiones.
- **QW11 done:** `PUFFER-GUIDE.md` (2208 líneas) partido en 6 archivos bajo `docs/architecture/`:
  - `overview.md`, `implementation-phases.md`, `operations.md`, `testing.md`, `packaging-and-release.md`, `README.md` (índice).
  - Original eliminado. README raíz actualizado con sección "Documentation".

### Métricas de sesión 1

| Métrica                  | Antes                        | Después                                                                               |
| ------------------------ | ---------------------------- | ------------------------------------------------------------------------------------- |
| Tests                    | 218 (no se ejecutaban en CI) | **230 (CI matrix Node 18/20/22)**                                                     |
| Test files               | 20                           | 22                                                                                    |
| `tsc --noEmit`           | 4 errores latentes           | **clean**                                                                             |
| ESLint                   | sin configurar               | **0 errores, 0 warnings**                                                             |
| Format                   | inconsistente                | **Prettier 65 archivos normalizados**                                                 |
| Pre-commit gate          | nada                         | **Husky + lint-staged**                                                               |
| Schema validation        | cast `as PufferConfig`       | **zod + zod-validation-error**                                                        |
| `.catch(() => {})`       | 6 sitios                     | **0 sitios (rule = error)**                                                           |
| `as any` (IPC)           | 2                            | **0**                                                                                 |
| Bugs críticos arreglados | —                            | **3** (anti-SSRF off por camelCase, rule bypass por regex inválida, alertas tragadas) |
| Documentación            | 1 archivo monolítico (78 KB) | **6 archivos topical bajo `docs/architecture/`**                                      |

### Pendiente

- ~~QW2b~~ ✅ cerrado en `fa185ac` + side-fix `e455e51`
- ~~QW2c~~ ✅ cerrado en `ea87783`
- ~~`npm audit`~~ ✅ parcial cerrado en `513b520` (11→6 vulns; las 6 restantes son no-aplicables al runtime, documentadas)
- ~~`src/discovery/index.ts:121`~~ ✅ verificado — los catches en discovery son recoveries intencionales documentados, no swallows
- ~~Fase 3 — npm workspaces~~ ✅ **completo** en 7 commits (`00b33ce` → `a4a4baa`). 22 workspace packages, src/ vacío, 230 tests verde.
- Fase 4 — streaming SSE + decoupling — **diferido**. Refactor interno sin valor visible al usuario; se hace cuando haya un caso de uso concreto que lo justifique (LLMs con SSE).
- ~~Fase 5 — observabilidad~~ ✅ **niveles 1+2 completos** en 3 commits (`8ba7504`, `88d8321`, `9c49b7c`). Nivel 3 (OTel) sigue como opcional.

### Sesión 4 — Fase 5 / M7 cerrada (2026-04-25 noche)

| Sub-milestone               | Commit    | Resumen                                                                                                                                                                                                                                                |
| --------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M7.1 — Prometheus metrics   | `8ba7504` | Nuevo `@puffer/observability` con prom-client. 14 métricas (`puffer_*`) instrumentadas en engine pipeline + proxy handler. Endpoint `GET /metrics` en dashboard server. 5 tests nuevos.                                                                |
| M7.2 — Structured JSON logs | `88d8321` | `PUFFER_LOG_FORMAT=json` switchea logger de @puffer/core a JSON line. `logEvent(event, level, msg, extra)` + `withTraceContext(event)` para correlación por `trace_id`. 5 tests nuevos.                                                                |
| M7-extra — Gauges + docs    | `9c49b7c` | `puffer_agents_active{protection_status}` populado por discovery scan. `puffer_score_total` populado por calculateScore. `docs/architecture/observability.md` con catálogo completo, PromQL examples, recetas de integración (Grafana, Loki, Datadog). |

### Catálogo final de métricas Prometheus

```
# Counters
puffer_events_total{agent, verdict}
puffer_blocks_total{layer, severity}
puffer_audits_total{layer, severity}
puffer_escalates_total{layer}
puffer_layer_errors_total{layer, reason=timeout|exception}
puffer_llm_tokens_total{agent, provider, model, kind=input|output}
puffer_llm_cost_usd_total{agent, provider, model}

# Histograms
puffer_layer_duration_seconds{layer}
puffer_pipeline_duration_seconds
puffer_llm_request_duration_seconds{provider, model}

# Gauges
puffer_agents_active{protection_status=protected|partial|unprotected}
puffer_score_total
puffer_offline_status{component}
puffer_queue_depth{queue}

# Plus standard process metrics under puffer_process_*
```

### Métricas acumuladas finales (sesión 1 → 4)

| Métrica                               | Inicio                    | Fin sesión 4                                                   |
| ------------------------------------- | ------------------------- | -------------------------------------------------------------- |
| Tests                                 | 218 (sin CI)              | **240 en CI matrix Node 18/20/22**                             |
| `tsc --noEmit`                        | 4 errores latentes        | **clean en 23 packages**                                       |
| ESLint                                | sin configurar            | **0/0**                                                        |
| `npm audit`                           | 11 vulns (10 mod, 1 high) | **6 vulns no-aplicables al runtime**                           |
| Workspace packages                    | 1 (monolito)              | **23** (22 + observability)                                    |
| Bugs latentes destapados y arreglados | 0                         | **3** (anti-SSRF off, rule bypass por regex, alertas tragadas) |
| Endpoints observabilidad              | ninguno                   | **`/metrics` Prometheus + `PUFFER_LOG_FORMAT=json`**           |
| Commits totales                       | 0                         | **17**                                                         |

### Sesión 3 — Fase 3 / M5 cerrada (2026-04-25 tarde-noche)

| Sub-milestone                      | Commit    | Resumen                                                                                                                                                                                   |
| ---------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M5.1 — Skeleton workspaces         | `00b33ce` | Root package.json `workspaces`, tsconfig.base.json compartido. Sin moves.                                                                                                                 |
| M5.2 — `@puffer/core`              | `630eb6b` | types + schemas + ipc en un solo package. 38 imports actualizados.                                                                                                                        |
| M5.3 — `@puffer/rules` + logger    | `686d82b` | rules loader/updater extracted. Logger movido a `@puffer/core` (32 imports).                                                                                                              |
| M5.4 — 7 layer packages            | `33f1f8e` | `@puffer/layer-{pii,injection,commands,network,filesystem,behavior,mcp}`. helpers en core.                                                                                                |
| M5.5 — `@puffer/engine`            | `e809280` | DefensePipeline + decision + policy. Constants y config a core. **Hallazgo:** las cláusulas `satisfies` zod en sesiones previas eran falsos positivos (encubiertos por el flag faltante). |
| M5.6 — 9 supporting packages       | `822dd9c` | alerts, audit, cloud, discovery, hooks, proxy, score, reports, redteam. ESLint scope expandido a packages/\*\*.                                                                           |
| M5.7-9 — apps/ y dashboard backend | `a4a4baa` | apps/{cli,daemon,dashboard} + packages/dashboard. src/ eliminado. CI workflow + dependabot actualizados. `PufferEvent.payload` ahora opcional (refleja realidad de los call sites).       |

### Estructura final del repo

```
puffer/
├── apps/
│   ├── cli/              @puffer/cli
│   ├── daemon/           @puffer/daemon
│   └── dashboard/        @puffer/dashboard-frontend (Vite + React)
└── packages/
    ├── core/             @puffer/core
    ├── engine/           @puffer/engine
    ├── rules/            @puffer/rules
    ├── alerts/           @puffer/alerts
    ├── audit/            @puffer/audit
    ├── cloud/            @puffer/cloud
    ├── dashboard/        @puffer/dashboard (Express backend)
    ├── discovery/        @puffer/discovery
    ├── hooks/            @puffer/hooks
    ├── proxy/            @puffer/proxy
    ├── reports/          @puffer/reports
    ├── score/            @puffer/score
    ├── redteam/          @puffer/redteam
    └── layers/
        ├── pii/          @puffer/layer-pii
        ├── injection/    @puffer/layer-injection
        ├── commands/     @puffer/layer-commands
        ├── network/      @puffer/layer-network
        ├── filesystem/   @puffer/layer-filesystem
        ├── behavior/     @puffer/layer-behavior
        └── mcp/          @puffer/layer-mcp
```

22 workspace packages totales. Cada uno con su `package.json`, `tsconfig.json` extiende `tsconfig.base.json`, y `src/index.ts` barrel.

### Métricas acumuladas (sesión 1 + 2 + 3)

| Métrica            | Inicio sesión 1           | Fin sesión 3                                                                                                                             |
| ------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Tests              | 218 (sin CI)              | **230 en CI matrix Node 18/20/22**                                                                                                       |
| `tsc --noEmit`     | 4 errores latentes        | **clean en 22 packages**                                                                                                                 |
| ESLint             | sin configurar            | **0/0**                                                                                                                                  |
| `npm audit`        | 11 vulns (10 mod, 1 high) | **6 vulns no-aplicables al runtime**                                                                                                     |
| Workspace packages | 1 (monolito)              | **22**                                                                                                                                   |
| `src/`             | toda la lógica            | **vacío y eliminado**                                                                                                                    |
| Commits            | 0                         | **13** (a4f17b7 → fa185ac → e455e51 → ea87783 → 513b520 → ec763e6 → 00b33ce → 630eb6b → 686d82b → 33f1f8e → e809280 → 822dd9c → a4a4baa) |

### Sesión 2 — milestones M1-M4 (2026-04-25 segunda mitad)

| Milestone                          | Commit           | Resumen                                                                                                                                                                                                                                            |
| ---------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 — `noUncheckedIndexedAccess`    | `fa185ac`        | 69 errores → 0 en 18 archivos. Cero `!`, cero `as`. Concentración en `continue-dev.ts` (17 errores resueltos con 2 guards).                                                                                                                        |
| M1-side — `extractModel` signature | `e455e51`        | Alineadas las 3 implementaciones (`openai`, `anthropic`, `ollama`) con la interfaz `ProviderAdapter` que declaraba `(body, url)`.                                                                                                                  |
| M2 — `exactOptionalPropertyTypes`  | `ea87783`        | 12 errores → 0. Tipos públicos cambiados a `field?: T \| undefined` para reflejar el contrato real. **Hallazgo:** las cláusulas `satisfies` de zod en sesión 1 NO satisfacían realmente — eran falsos positivos enmascarados por el flag faltante. |
| M3 — npm audit                     | `513b520`        | 11 vulns → 6. Eliminadas: `path-to-regexp` (HIGH ReDoS), `follow-redirects`, `yaml`, `postcss`. Diferidas con justificación: `esbuild` (solo dev server, transitive de vitest) y `uuid` (vuln en v3/v5/v6 con `buf`, Puffer usa v4 sin `buf`).     |
| M4 — discovery audit               | n/a — sin código | Los 14 catches en `src/discovery/` son TODOS intencionales: fallbacks DNS (`return []`), recovery con wmic, returns explícitos para parsing malformado. ESLint con rule en `error` ya bloquea regresiones futuras.                                 |

### Métricas acumuladas (sesión 1 + 2)

| Métrica         | Sesión 1 fin                        | Sesión 2 fin                                                        |
| --------------- | ----------------------------------- | ------------------------------------------------------------------- |
| Tests           | 230                                 | **230 (sin regresiones)**                                           |
| `tsc --noEmit`  | clean (strict + noImplicitOverride) | **clean (+ noUncheckedIndexedAccess + exactOptionalPropertyTypes)** |
| ESLint          | 0/0                                 | **0/0**                                                             |
| `npm audit`     | 11 vulns (10 mod, 1 high)           | **6 vulns (todas mod, todas no-aplicables)**                        |
| Commits totales | 1                                   | **5** (a4f17b7 → fa185ac → e455e51 → ea87783 → 513b520)             |

### Reglas que sigue activas

- `no-restricted-syntax: error` para empty catches y `.catch(() => {})` — bloquea regresiones de QW10.
- `tsconfig.json` con `strict + noImplicitOverride + noUncheckedIndexedAccess + exactOptionalPropertyTypes`.
- Husky pre-commit corre prettier + eslint sobre staged.
- CI matrix Node 18/20/22 verifica lint + typecheck + format + test.

<!-- Próximas entradas se agregan al inicio de esta sección, formato:
### YYYY-MM-DD

- **QW#X mergeado** (`<commit-hash>`): qué cambió, archivos tocados, qué se aprendió.
-->
