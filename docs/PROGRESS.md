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
- Fase 3 — npm workspaces (apps/ + packages/), 3-5 días — **siguiente, requiere checkpoint humano**
- Fase 4 — streaming SSE + decoupling, 1-2 semanas
- Fase 5 — observabilidad (3 niveles)

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
