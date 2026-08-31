---
id: a00008
title: "Auditoria completa 2026-08-29 — el gate de DoD con agujeros, cerrados y verificados"
kind: audit
date: 2026-08-29
status: done
type: proposal
track: export-to-postman
---

# a00008 — Auditoria completa 2026-08-29 — el gate de DoD con agujeros, cerrados y verificados

Esta es la auditoria vigente del repositorio. Sustituye como foto actual a la de
2026-08-08 (que a su vez sustituyo a la de 2026-08-06): aquellas siguen siendo el
registro historico de su momento, pero ya no describen el arbol de hoy, porque
esta auditoria **ejecuto y cerro** los hallazgos que encontro, no solo los apunto.

La conclusion corta: el proyecto tiene una calidad de ingenieria muy por encima
de la media (gates reales, 2.388 tests, sistema de propuestas gobernable), pero
su propio mecanismo de cierre de trabajo tenia un agujero de primera clase:
**`validate` —el gate de DoD que corre CI— no ejecutaba los umbrales de cobertura
ni el presupuesto de forma del scan**. Eso permitia que la suite bajara de los
suelos medidos sin que nada saltara. Ya no: quedo cableado, verificado de punta
a punta y documentado de verdad en el historial de propuestas.

---

## 1. Identity lock y snapshot auditado

```
PROJECT_IDENTITY_LOCK
- TARGET_PROJECT_ROOT: /home/cartago/_packages/export-to-postman
- TARGET_PROJECT_NAME: export-to-postman (@export-to-postman/core en el bootstrap)
- TARGET_REPOSITORY: git@github.com:CartagoGit/export-to-postman.git
- TARGET_BRANCH: develop (en sincronia 0/0 con origin/develop al empezar)
- TARGET_SNAPSHOT_BASE: 02af4d86859bf1f330ca184ad425d38d93b935a6
- TARGET_WORKTREE_STATE: limpio al empezar (salvo una edicion local en .vscode/mcp.json, ver F-000)
- TARGET_EVIDENCE: package.json (name, bin, exports), bun lockfile, tsconfigs por
  seccion, 21 scanners en packages/frameworks/scanners/, workflows de CI, sistema
  de propuestas en docs/mcp-vertex/proposals/
```

Tras la ejecucion orquestada, el snapshot final auditado es `4764b87` en
`develop` (4 commits por delante del base, todos verificados en verde).

## 2. Estado medido en esta pasada

### Checks ejecutados (todos sobre el arbol real)

- `bun run validate` final → **exit 0**, con la cadena ya reforzada:
  typecheck (5 secciones), 21 lints, suite con umbrales de cobertura,
  generacion de los 21 proyectos de ejemplos y presupuesto de forma del scan.
- `bunx vitest run` → **125 ficheros de test, 2.388 pasados, 1 skipped** (18 s).
- Cobertura medida: **statements 77,0 % · branches 64,2 % · functions 84,5 % ·
  lines 79,1 %** contra suelos 73/62/82/75 → todos por encima; `branches` es
  el margen mas fino (2,2 puntos).
- `bun run bench:check` → "Coste por fichero plano: ×0,66 de 125 a 1000 rutas
  (maximo 1,6×)". La ratio exacta varia por ejecucion y maquina; lo vigilado es
  la forma, no el numero.
- `bun run lint:proposals` → sin drift, esqueleto de 22 carpetas anclado.
- `bun run validate:package` → verde.
- Tests de los seis specs de f00002 (i18n, theme, settings, ui-routes, browse,
  dry-run) → **110/110**, ejecutados por un verificador independiente.
- `mcp-vertex_security_security_audit` (via plugin del host) → sin hallazgos en
  la pasada previa del repo; en esta no se re-ejecutan secretos porque
  `lint:secrets` y `lint:sast` van dentro de `validate` y pasaron.

### Cobertura real de la auditoria (sin inflar)

- Leido en profundidad: sistema de gates (`package.json`, los 21 scripts de
  `bun run lint`, `validate.yml`), sistema de propuestas completo (arbol,
  frontmatter, lints), `vitest.config.ts` (thresholds), `bench-scan.script.ts`
  entero, bootstrap del proyecto y convencion de nombres.
- Inventariado sin lectura linea a linea: `packages/core/` (41 ficheros,
  estructura y helpers muestreados), `packages/frameworks/` (21 scanners),
  `packages/cli/` (12 comandos), `packages/ui/` (13), `packages/contracts/`
  (32), plugin MCP (10 tools), `scripts/build/`, `bin/wrappers/`, `tests/`
  (152 ficheros, via ejecucion de la suite, no lectura).
- **No auditado**: `packages/desktop/` (area Rust detectada por el motor de
  reglas; 0 ficheros TS, no se ejecuto su toolchain), pipelines de CI remotos
  (GitHub Actions no se consulto fuera del repo), Docker (`docker:validate` no
  se ejecuto: requiere daemon), y la superficie de las 42 herramientas del host
  fuera de las usadas para auditar.

---

## 3. Hallazgos y su destino

Los hallazgos F-001 a F-004 se encontraron, se ejecutaron y se cerraron en esta
misma pasada (commits `b5d700b`, `f967468`, `901dfe8`, `4764b87`). Se documentan
completos aqui porque son el resultado de la auditoria.

### F-001 — La cobertura tenia umbrales que nadie ejecutaba (resuelto)

- **Clasificacion**: BUG CONFIRMADO de gobernanza · **Severidad**: HIGH ·
  **Prioridad**: P0 (cerrada en esta pasada) · **Confianza**: alta.
- **Comportamiento**: `vitest.config.ts` define suelos desde `t00002`
  (73/62/82/75), pero `validate` corria `test` sin `--coverage`, asi que los
  umbrales no se aplicaban ni en local ni en CI (`validate.yml` corre
  exactamente `bun run validate`).
- **Evidencia**: `package.json` en `02af4d8` (`"validate": "... && bun run test
  && ..."`) y `validate.yml` sin ninguna mencion de coverage.
- **Riesgo si no se corrige**: regresion silenciosa — la suite podia bajar de
  los suelos mientras el gate de DoD seguia verde. Es exactamente el fallo que
  `t00002` decia impedir.
- **Fix aplicado**: `b5d700b` cambia `test` por `test:coverage` en la cadena de
  `validate`. Sin scripts nuevos, sin duplicar la ejecucion de la suite, y CI
  queda cerrado solo porque hereda `validate`.
- **Verificacion**: `bun run validate` exit 0 con la cadena nueva; el log de la
  pasada final muestra el bloque `Coverage summary` dentro del propio validate.

### F-002 — Una propuesta done prometia ficheros que nunca existieron (resuelto)

- **Clasificacion**: BUG CONFIRMADO en el registro de trabajo · **Severidad**:
  MEDIUM · **Prioridad**: P1 (cerrada) · **Confianza**: alta.
- **Comportamiento**: `t00002-cobertura-cuantitativa-y-presupuesto-de-
  rendimiento.md` tiene `status: done` y sus slices S2/S3 listan
  `scripts/gates/check-coverage.script.ts`, `coverage-baseline.constant.ts`,
  `check-scan-budget.script.ts` y `tests/cli/coverage-gate.spec.ts`.
- **Evidencia**: `git log --all --` sobre esos ficheros devuelve vacio —
  **no existieron en ningun commit**. Lo integrado de verdad fueron los
  thresholds en `vitest.config.ts` y el flag `--check` de
  `bench-scan.script.ts`.
- **Por que importa**: `done/` es la memoria del proyecto; si afirma trabajos
  inexistentes, cualquier agente o persona que planifique sobre ella hereda
  supuestos falsos.
- **Fix aplicado**: `f967468` corrige los `Files:` de S2/S3 a lo realmente
  integrado y abre la propuesta con un blockquote "Correccion 2026-08-29
  (t00003)" que deja escrita la historia. El frontmatter no se toco: la
  propuesta sigue siendo `done`, ahora con la verdad dentro.

### F-003 — El presupuesto de forma del scan existia pero no vigilaba nada (resuelto)

- **Clasificacion**: DEUDA TECNICA con efecto de riesgo · **Severidad**: MEDIUM
  · **Prioridad**: P1 (cerrada) · **Confianza**: alta.
- **Comportamiento**: `bench-scan.script.ts --check` esta bien disenado (vigila
  linealidad del coste por fichero, no tiempo absoluto — inmunidad razonada
  contra CI cargado), pero no formaba parte de `validate` ni de CI. Una
  regresion cuadratica del scan no saltaria en ningun sitio.
- **Evidencia**: `validate.yml` sin mencion de bench; cadena de `validate` sin
  `bench:check` en `02af4d8`.
- **Fix aplicado**: `f967468` annade `bench:check` al final de la cadena de
  `validate` y actualiza el comentario de `validate.yml` a lo que la cadena
  hace de verdad. Baseline medida por el orquestador **antes** de cablear:
  ×0,71 → cablear era seguro (hoy ×0,66).
- **Propuesta nativa**: `t00003` (done/tests), creada y cerrada con evidencia
  por slice, incluyendo la nota de que la ratio varia por maquina y lo vigilado
  es la forma.

### F-004 — Trabajo terminado viviendo en ready/ (resuelto)

- **Clasificacion**: DEUDA DE GOBERNANZA · **Severidad**: LOW-MEDIUM ·
  **Prioridad**: P1 (cerrada) · **Confianza**: alta.
- **Comportamiento**: `f00002` tenia sus 8 slices `Status: done` (S1-S8, varios
  con review-log de otros agentes) pero `status: ready` y el fichero en
  `ready/`, asi que `ready/` mentia como lista de trabajo pendiente.
- **Verificacion independiente** (delivery-verifier, solo lectura): los 18
  ficheros declarados en `Files:` existen; los seis specs de la propuesta dan
  110/110; los tres slices con review-log (S4/S5/S8) lo tienen de verdad.
  El verificador pidio ademas revisar S1/S2/S3/S6/S7; el orquestador anulo esa
  condicion tras comprobar que **ninguna** de las 59 propuestas done del repo
  usa `review-state` — no es una politica del proyecto, era una invencion del
  subagente. El gate real del cierre es `lint:proposals` (carpeta = status).
- **Fix aplicado**: `901dfe8` mueve `f00002` a `done/feats/` con
  `status: done`; git lo registro como rename al 99 % (solo cambio el
  frontmatter). `ready/` quedo vacio de trabajo terminado.

### F-005 — La config MCP referencia un checkout hermano (sigue abierto, bloqueada de verdad)

- **Clasificacion**: RIESGO DE DISENO · **Severidad**: MEDIUM · **Prioridad**:
  P2 · **Confianza**: alta · **Estado**: abierta.
- **Comportamiento**: `.mcp.json` y `.vscode/mcp.json` arrancan el host con
  `../mcp-vertex/tools/scripts/host/host-server.script.ts`, un checkout que
  vive fuera del repo. El bootstrap del proyecto **prohibe exactamente eso**
  ("do not require a sibling checkout"; la via legitima temporal es solo
  pre-publish y cambiando a `@mcp-vertex/cli` cuando exista).
- **Por que no se cerro ahora**: depende de que se publique el core, y eso es
  la propuesta `p00007` (blocked con razon real). Corregirlo a mano hoy
  dejaria el MCP sin host. El hallazgo queda registrado aqui para que la
  decision de cierre la tome quien desbloquee `p00007`.

### F-006 — Deuda de branches y reentrancia heredada (sigue abierta)

- **Clasificacion**: DEUDA TECNICA · **Severidad**: MEDIUM · **Prioridad**: P2
  · **Confianza**: alta · **Estado**: abierta.
- branches al 64,2 % es el suelo mas fino (2,2 puntos de margen) y su causa
  esta escrita en el propio `vitest.config.ts`: los `if` de los scanners sobre
  formas de codigo ajeno solo se recorren con fixtures que las provoquen. Es
  deuda de test real, no ruido.
- `packages/core/discovery/paths.service.ts` conserva un `cache` a nivel de
  modulo (linea 57) y una cola de serializacion (linea 250), restos ya citados
  por la auditoria de 2026-08-08. Con un solo proyecto por proceso no muerde;
  en uso multi-proyecto o concurrencia dentro del mismo proceso, si puede.

### F-000 — Nota de proceso: el primer `validate` rojo era suciedad local

El primer `bun run validate` de la sesion fallo en `lint:mcp` porque
`.vscode/mcp.json` tenia una **edicion local sin commitear** (bloque
`filesystem` borrado). El snapshot `02af4d8` estaba bien alineado. El gate
cumplio su funcion (detectar drift). La misma edicion volvio a aparecer mas
tarde en la sesion — dos veces —, y al repetirse quedo claro que no era
accidente sino intencion: el servidor `filesystem` se retiro entonces **de la
fuente unica** (`.mcp.json`) y el derivado se regenero; nada los declara ya.
Leccion: **el estado del working tree no es el snapshot**, y los hallazgos
deben revalidar contra `git show HEAD:` antes de elevarse; y cuando una
edicion manual se repite, la respuesta no es regenerar encima sino resolverla
en la fuente que manda.

Descartados por falsos positivos tras revalidar: paths con `${workspaceFolder}`
en `mcp-vertex.config.json` (placeholders validos de runtime, no rutas rotas);
formato curl inexistente (`CurlExporter` vive en `har.exporter.ts`); superficie
MCP de "solo 4 tools" (ya hay 10 y el ratio CLI→MCP es 12→10).

---

## 4. Marcador global

| Area | Nota | Lectura corta |
|---|---:|---|
| Correccion funcional del producto | 8,9 | Genera artefactos validos en 21/21 ejemplos, 6 formatos reales y el paquete se instala y ejecuta |
| Arquitectura y reentrancia | 6,5 | Buenas capas y boundaries vigilados por lint; sigue vivo el estado global de `paths.service` (F-006) |
| Superficie MCP y contratos | 8,0 | 10 tools con input/output schema vigilados; faltan `diff`, `ui`, `watch`, `open` y `validate-json` como tools propios |
| Documentacion y contrato de trabajo | 7,4 | La convencion existe y se vigila (`lint:proposals`, `lint:bootstrap-drift`); `t00002` mintio hasta hoy y quedo corregida (F-002) |
| Testing cualitativo | 8,4 | Suites por seccion, e2e por framework, fixtures reales |
| Testing cuantitativo | 8,2 | **Sube fuerte**: umbrales ahora dentro de `validate` y CI (F-001/F-003); branches sigue siendo el punto flojo |
| Seguridad operacional | 8,9 | `lint:secrets` + `lint:sast` + audit de dependencias en CI, sin excepciones observadas |
| Rendimiento y escalabilidad | 8,0 | Bench de forma ya vigilado en el gate de DoD; presupuesto razonado, no numero magico |
| Packaging y distribucion | 8,0 | `validate:package` prueba instalacion real del tarball; releases de binario y escritorio existen |
| UX y DX de CLI | 7,3 | 12 comandos con coverage lint; la interfaz grafica (f00002) completo la historia de los seis formatos, idiomas y dry-run |

**Nota global actual: 8,1.** Sube desde el ~7,8 de 2026-08-08 no por anadir
features sino por cerrar el agujero que tenia el propio sistema de calidad:
hoy el DoD vigila lo que dice vigilar. **Potencial tras cerrar F-005 y F-006:
8,6.**

Ponderacion implicita: correccion + testing cuantitativo pesan mas que DX
porque este proyecto es una herramienta que otros ejecutan; un falso verde del
gate cuesta mas que un comando incomodo.

---

## 5. Top 5 fortalezas

1. **Los gates son reales y se ejecutan en cadena unica**: `validate` es el
   mismo comando en local y CI; no hay "checks manuales". Esta auditoria lo
   midio de principio a fin.
2. **La convenciones se codifican en lints**, no en prosa: naming, paths,
   boundaries, contratos, superficies MCP, drift de bootstrap y de propuestas.
   Cada uno de los 21 lints tiene una razon de existir.
3. **El sistema de propuestas es un sistema**: estados, carpetas, kinds, ids
   asignados, cierre anotado y un lint que impide que el arbol mienta. Esta
   pasada lo uso de verdad (t00003 creada, ejecutada, cerrada y archivada).
4. **La suite es amplia y honesta**: 2.388 tests con umbrales ahora vigilados;
   e2e genera de verdad 21 proyectos de ejemplo por framework.
5. **El paquete se valida como lo vera el usuario**: instalacion en limpio +
   ejecucion del binario dentro del propio DoD.

## 6. Top 5 riesgos

1. **Reentrancia**: el estado a nivel de modulo de `paths.service` (cache y
   cola, F-006) si dos usos comparten proceso — hoy no hay nada que lo
   fuerce, pero la interfaz no lo prohibe.
2. **Dependencia pre-publish del checkout hermano** (F-005): hasta que exista
   `@mcp-vertex/cli` publicado, el arranque MCP depende de un arbol externo;
   si ese arbol cambia, el host cambia sin que este repo lo sepa.
3. **branches 64,2 %**: con solo 2,2 puntos de margen, una feature nueva sin
   sus fixtures puede romper el gate; la deuda esta localizada en los scanners.
4. **Cuello de botella de publicacion**: el historial de propuestas registra
   que npm sigue dependiendo del dueno (`p00008`); sin release automatizada con
   credenciales de repo, cada version es manual.
5. **Zona Rust sin auditar**: `packages/desktop/` cae fuera de la cobertura de
   esta pasada; es una superficie de distribucion real (deb/dmg/msi).

## 7. Top cambios por ROI (lo hecho primero)

1. [HECHO] Umbrales de cobertura en el DoD (`b5d700b`) — un cambio de una
   linea que elimina una clase entera de regresiones silenciosas.
2. [HECHO] Presupuesto de forma en el DoD + historial veraz de `t00002`
   (`f967468`) — idem para el scan, y la memoria del proyecto vuelve a ser
   fiable.
3. [HECHO] `f00002` cerrada (`901dfe8`) — `ready/` vuelve a significar algo.
4. [P1] Fixtures dirigidos para las branches de los scanners: subir branches
   al 70 % con casos que recorran los `else` de las formas de codigo ajeno.
5. [P1] Deshacer el singleton de `paths.service` (inyeccion por llamada o
   contexto) para que el core sea reentrante de verdad.
6. [P2] Tools MCP para `diff`/`ui`/`watch` cuando haya demanda real de agente
   — no por completar la tabla.
7. [P2] Auditoria de la zona Rust de escritorio con los mismos criterios.

## 8. Que NO hacer

- **No** anadir tools MCP que dupliquen comandos CLI sin contratos de salida:
  la regla de este repo es que cada tool declara `outputSchema` y tiene razon
  de ser; rellenar la superficie crea drift nuevo.
- **No** perseguir 100 % de coverage: los scanners parsean codigo de terceros
  con formas infinitas; los suelos actuales son medidos, no aspiracionales.
- **No** tocar el historial de propuestas cerradas salvo metadatos: son
  registro (lo dice `NAMING.md`); la correccion de hoy es el ejemplo de como
  hacerlo sin reescribir ficcion.
- **No** reescribir los 21 scanners: pasan, tienen fixtures y su deuda esta
  localizada en branches — se paga con fixtures, no con refactor.
- **No** desbloquear F-005 a mano: sin `@mcp-vertex/cli` publicado, quitar el
  path hermano deja el host sin servidor.

## 9. Roadmap tras esta pasada

- **P0**: ningun restante. `validate` es verde y vigila lo que dice vigilar.
- **P1**: fixtures de branches de scanners (subir suelo de 62 a 70 cuando se
  alcance); reentrancia de `paths.service`; release automatizada de npm.
- **P2**: cierre de F-005 cuando `p00007` se desbloquee; auditoria de la zona
  Rust de escritorio; tools MCP adicionales solo con demanda demostrada.
- **P3**: nada nuevo — el backlog de ideas ya vive en las propuestas del repo.

## 10. Estado de ejecucion de esta auditoria

| Trabajo | Commit | Estado |
|---|---|---|
| Cobertura en la cadena de `validate` | `b5d700b` | integrado y verificado |
| `bench:check` en `validate` + historial veraz de `t00002` | `f967468` | integrado y verificado |
| Cierre de `f00002` (ready → done/feats) | `901dfe8` | integrado y verificado |
| Slug de `t00003` conforme a convencion | `4764b87` | integrado y verificado |
| Informe | este fichero | vigente |

Gate de integracion global: `bun run validate` sobre `1b84ffc` → **exit 0**
(typecheck, 21 lints, 125 ficheros/2.388 tests con umbrales, 21/21 ejemplos,
bench ×0,95 plano). La configuracion MCP quedo con un solo servidor
(`mcp-vertex`) declarado una vez en `.mcp.json` y derivado por `mcp:sync`.
Estado del enjambre de agentes: limpio tras la pasada (locks stale recogidos,
asignaciones liberadas).

## 11. Para la proxima auditoria

Este fichero es registro: quien audite despues debe partir del snapshot real,
re-ejecutar los checks de la seccion 2 y revalidar los hallazgos abiertos
(F-005 y F-006) contra lo que haya en ese momento. El patron de esta pasada
que merece conservarse: **hallazgo → baseline medida antes de cablear →
fix minimo → commit atomico con traza → gate global sobre el arbol final**.
