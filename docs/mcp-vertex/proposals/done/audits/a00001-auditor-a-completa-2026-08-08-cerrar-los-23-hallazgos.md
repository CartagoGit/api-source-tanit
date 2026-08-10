---
id: a00001
title: "Auditoría completa 2026-08-08 — cerrar los 23 hallazgos"
kind: audit
status: done
type: proposal
track: export-to-postman
date: 2026-08-08
---

# a00001 — Auditoría completa 2026-08-08 — cerrar los 23 hallazgos

## Goal

Cerrar los 23 hallazgos de la auditoría, empezando por los tres FATAL, y dejar un gate por cada regla que hoy solo está escrita en prosa — para que la disciplina de contrato deje de depender de que alguien se acuerde.

## why

La auditoría completa (brief canónico de `audit_plan`, scope full, mode general) dejó 23 hallazgos: 3 FATAL, 7 BAD, 8 MINOR y 5 OK/GOOD. El documento vive en `docs/mcp-vertex/audits/08-08-2026- Claude Code (claude-opus-5).md` y `audit_consolidate` lo parsea entero. Los tres FATAL no son bugs de comportamiento: son sitios donde el proyecto dice una cosa y hace otra — cuatro tools sin `outputSchema` que el propio bootstrap exige, ninguna escritura durable atómica, y una propiedad colada fuera del contrato con `as any`. Por debajo hay una causa común: el bootstrap del proyecto describe una arquitectura que se sustituyó hace tres reorganizaciones, y por eso las reglas que enuncia no las comprueba nadie.

## non-goals

- Reescribir las propuestas cerradas: son registro de lo que pasó
- Subir express 4→5 ni symfony 6.4→7 en los manifiestos de ejemplo: no tienen avisos abiertos y express 5 cambió la sintaxis de rutas, que es justo lo que el scanner parsea
- Corregir los 2 enlaces rotos de p00007 y p00002: están en propuestas archivadas, donde el bootstrap §5 permite rutas históricas como arqueología
- Desbloquear p00007, que depende de que @mcp-vertex/core se publique en npm

---

> **Date**: 2026-08-08 · **Reviewer**: Claude Code (claude-opus-5) · **Scope**: Full audit · **Mode**: general.
> **Brief**: `mcp-vertex_audit_audit_plan { scope: "full", mode: "general" }`.
> **Metodología**: los comandos automáticos son el suelo, no el techo. Cada
> hallazgo lleva su fragmento con referencia `fichero#Lnn`. Lo que no se vio
> en el código, no se reporta.

---

## Resumen ejecutivo

El producto **funciona**: 21 de 21 ejemplos generan una colección Postman
válida, 1.883 tests en verde, 13 lints, cinco secciones que tipan por
separado, cero secretos filtrados y cero CVE en lo que se instala de
verdad. Nada de eso está en duda.

Lo que esta auditoría encuentra es otra cosa: **la disciplina de contrato
se ha ido soltando mientras el producto crecía**. Los tres hallazgos
FATAL no son bugs de comportamiento — son sitios donde el proyecto dice
una cosa y hace otra. Los cuatro tools del plugin no declaran
`outputSchema`, que es un invariante que el propio bootstrap copia por
referencia del universal y luego repite en §3.2. Ninguna escritura
durable es atómica: la colección —el producto— se escribe con un
`writeFile` pelado, y `watch` lo hace en bucle. Y el scanner de OpenAPI
cuela una propiedad fuera del contrato con `as any`.

Por debajo de todo hay una causa: **el bootstrap del proyecto describe
una arquitectura que ya no existe**. §3.8 documenta un `IRouterAdapter`
y un `router-dispatcher.service.ts` que no están en el repositorio; §3.1
documenta un nombre de tool que no es el que se registra; cuatro de las
rutas que cita no existen. Es el fichero que gobierna el trabajo de
cualquier agente sobre este repo, y lleva a trabajar contra un mapa
viejo. Esta misma auditoría lo pagó: la primera versión se hizo sin
leerlo y sin preguntar al servidor, y se le escaparon los tres FATAL.

23 hallazgos: 3 FATAL, 7 BAD, 8 MINOR, 5 OK/GOOD.

---

## Verified State

- **Tests** (`bun run test`) — 1.883 pass / 0 fail, 93 ficheros.
- **Ejemplos** (`bun run validate:examples`) — 21 / 21 generan colección válida.
- **Typecheck** (`bun run typecheck`) — limpio en 5 secciones.
- **Lints** (`bun run lint`) — 13 / 13 en verde.
- **Secretos + CVE + licencias** (`security_audit`) — 0 hallazgos sobre 241 ficheros.
- **Deuda técnica** (`debt_scan`) — 9 TODO, todos en plantillas que genera el asistente.
- **Dependencias** (`deps_check`) — `healthy: true`, lockfile presente.
- **LOC producción** — 23.874. **LOC test** — 14.745.
- **Frameworks** — 21. **Comandos CLI** — 12.
- **Alertas Dependabot** — 67, en cierre (hallazgo 20).

---

## 🔴 FATAL

### 1. Declarar `outputSchema` en los cuatro tools del plugin

**Fichero**: `projects/plugins/mcp-vertex_expostman/src/lib/tools/generate.tool.ts#L55`

```ts
server.registerTool(
  `${ctx.namespacePrefix}_${TOOL_ID}`,
  {
    description: "Genera la colección Postman v2.1.0 desde las rutas…",
    inputSchema: GenerateInputSchema,
    // no hay outputSchema
  },
```

Medido en los cuatro:

```
generate.tool.ts   outputSchema:0   inputSchema:1
summary.tool.ts    outputSchema:0   inputSchema:1
test.tool.ts       outputSchema:0   inputSchema:1
validate.tool.ts   outputSchema:0   inputSchema:1
```

**Problem**: `AGENT-BOOTSTRAP.md#L62` copia por referencia el invariante
universal §6 —"Every public tool declares an `outputSchema`"— y §3.2
(`#L109`) lo repite como requisito con su regla de forma (`.shape`).
Ninguno de los cuatro lo declara. No hay ningún gate que lo compruebe:
`lint:tsdoc` mira los exports del área pública, no la superficie MCP.

**Impact**: un agente que llama a `mcp-vertex_expostman_generate` recibe
una salida sin contrato. No puede validar la respuesta ni saber qué
campos existen sin ejecutarla y mirar. Es exactamente la imprecisión que
el invariante existe para evitar, y ocurre en la superficie **pública**
del proyecto hacia otros agentes.

**Resolution Track**: [Deferred to proposal `p00045` slice `s1`]

---

### 2. Escribir la colección de forma atómica

**Fichero**: `projects/cli/commands/generate.script.ts#L312`

```ts
await writeFile(OUTPUT_PATH, json + "\n", "utf8");
```

**Fichero**: `projects/cli/commands/watch.script.ts#L76`

```ts
await writeFile(path, JSON.stringify(result.collection, null, 2) + "\n", "utf8");
```

Trazadas todas las escrituras durables de `projects/core` y
`projects/cli`: `generate` (3 sitios), `watch` (2), `enrich` (1), `init`
(2, además síncronas). Ninguna usa fichero temporal + rename. No hay un
solo `rename(` en el árbol.

**Problem**: `writeFile` sobre una ruta existente trunca primero y
escribe después. Entre esos dos momentos el fichero está a medias. Si el
proceso muere ahí —Ctrl-C, OOM, batería— la colección queda truncada, y
un JSON truncado no es una colección incompleta: es un fichero que
Postman no abre.

**Impact**: `watch` es el caso serio. Reescribe la colección en cada
cambio del proyecto, y el flujo que documenta el propio README es
tenerla importada en Postman mientras se programa. Cada guardado es una
ventana en la que Postman puede leer un JSON a medio escribir. El
producto entero de esta herramienta es ese fichero.

**Resolution Track**: [Deferred to proposal `p00045` slice `s2`]

---

### 3. Retirar el `as any` que cuela `__params` fuera del contrato

**Fichero**: `projects/frameworks/scanners/openapi.scanner.ts#L454`

```ts
const params = [...pathLevelParams, ...opParams];
if (params.length > 0) {
  (out[out.length - 1] as any).__params = params;
}
```

Y su lectura, en `openapi.scanner.ts#L535`:

```ts
async supports(_r: ParsedRoute, _m: IProjectMatch): Promise<boolean> {
  return Boolean((_r as any).__params) || _m.framework === "openapi";
}
```

`__params` no está en `ParsedRoute`
(`projects/core/contracts/scanner.interface.ts#L52`), y `grep` confirma
que no se lee en ningún otro sitio: `resolve()` vuelve a leer el spec
del disco.

**Problem**: es una propiedad inventada que viaja escondida en un objeto
del contrato, escrita y leída a través de `as any` para que el
compilador no la vea. Sirve para una sola cosa —que `supports()` diga
que sí en un proyecto híbrido, donde `_m.framework` no es `"openapi"`
pero la ruta sí viene de ese scanner—, y esa necesidad es legítima: lo
que falta es el campo para expresarla.

**Impact**: el contrato deja de describir lo que circula por el
pipeline. Quien lea `ParsedRoute` para escribir un scanner nuevo no sabe
que existe este canal paralelo, y el compilador no se lo va a decir. Es
la misma raíz que el hallazgo 6.

**Resolution Track**: [Deferred to proposal `p00045` slice `s3`]

---

## 🟠 BAD

### 4. Poner al día el bootstrap del proyecto

**Fichero**: `docs/mcp-vertex/AGENT-BOOTSTRAP.md#L225`

```md
export interface IRouterAdapter {
  readonly framework: "laravel" | "symfony" | "express" | "fastapi" | "django";
  readonly detect: (ctx: IProjectContext) => boolean;
  readonly discover: (ctx: IProjectContext) => Promise<IRouteParseResult>;
}
```

```
$ grep -rn "IRouterAdapter|router-dispatcher|router-adapters" projects/
(vacío)
```

Cuatro rutas citadas que no existen: `scripts/lint-tool-no-process.script.ts`
(§4, está en `scripts/gates/`), `plugins/export-to-postman/src/lib/tools/`
(§3.1 y §3.5, es `projects/plugins/mcp-vertex_expostman/`),
`services/router-dispatcher.service.ts` (§3.8) y `services/router-adapters/`
(§3.5 y §3.8). Y §3.1 declara que los tools se registran como
`${NAMESPACE}_exporter_<verb>` con `NAMESPACE = "postman"`; el código
registra `` `${ctx.namespacePrefix}_${TOOL_ID}` `` → `mcp-vertex_expostman_generate`.

**Problem**: este fichero **es** el contrato de trabajo. `CLAUDE.md`,
`AGENTS.md` y `.github/copilot-instructions.md` apuntan aquí y a ningún
otro sitio. Describe la arquitectura de router-adapters que se sustituyó
por el trío `IProjectScanner` / `IRouteScanner` / `IValidationSpecProvider`,
y la tabla de §3.5 no menciona ni `domain/`, ni `discovery/`, ni
`exporters/`, ni `adapters/`.

**Impact**: cualquier agente que lo lea trabaja contra un mapa de hace
tres reorganizaciones. Los hallazgos 1 y 3 son consecuencia directa:
reglas que el bootstrap enuncia pero que nadie comprueba, en un fichero
que ya nadie contrasta con el código porque se ha vuelto folclore.

**Resolution Track**: [Deferred to proposal `p00046` slice `s1`]

---

### 5. Decidir qué pasa con `enrich`

**Fichero**: `projects/cli/commands/enrich.script.ts#L12`

```ts
import { enrichCatalogWithFormRequests } from "../../frameworks/laravel/catalog-enricher.service.js";
import { discoverEndpoints } from "../../frameworks/laravel/endpoint-discovery.service.js";
```

Lanzado contra los 21 ejemplos: 1 con contenido, 20 vacíos.

**Problem**: el comando descubre por el camino legacy de Laravel, no por
el registro de scanners. Además duplica a `generate`: reconstruye la
colección, aplica el flujo de auth y enriquece con la misma función.

**Impact**: sobre `example-express`, `enrich --in-place` dejaba una
colección de 27.514 bytes en 502, imprimiendo `✔` y saliendo con 0. Ya
hay guarda (`a2ce484`) y test (`tests/cli/enrich-command.test.ts`), así
que la pérdida de datos está cerrada; lo que queda abierto es que un
comando de 12 solo sirva para 1 framework de 21.

**Resolution Track**: [Mitigado en `a2ce484`; decisión en proposal `p00046` slice `s2`]

---

### 6. Dar identidad a `ParsedRoute`

**Fichero**: `projects/core/contracts/scanner.interface.ts#L52`

```ts
export interface ParsedRoute {
  method: string;
  uri: string;
  rawUri: string;
  sourceFile: string;
  // …ni `framework`, ni clave de operación
}
```

**Problem**: no hay forma de saber de qué scanner viene una ruta ni de
identificar una operación cuando `method + uri` no basta. La suposición
"la URL identifica la operación" vale en REST y no vale en GraphQL ni
tRPC, donde hay un endpoint y lo que distingue una consulta de otra es
el nombre.

**Impact**: el mismo fallo ha aparecido cuatro veces, y las tres
primeras se parchearon una a una: `dedupeSpecs` del pipeline hacía que
un esquema entero produjera **una** request; los invariantes avisaban de
las otras cuatro como duplicadas; `check` contaba 1 ruta de 5 y no
detectaba deriva ninguna; y `__params` (hallazgo 3) existe porque el
scanner no puede decir "esta ruta es mía". Nada impide la quinta.

**Resolution Track**: [Deferred to proposal `p00045` slice `s3`]

---

### 7. Contener `--output-dir` dentro de una raíz

**Fichero**: `projects/core/discovery/paths.service.ts#L418`

```ts
await fs.mkdir(dir, { recursive: true });
```

No hay ninguna validación de contención: ni `startsWith(root)`, ni
`relative(...)` comprobando que no empieza por `..`.

**Problem**: `--output-dir` y `POSTMAN_OUTPUT_DIR` se aceptan tal cual.
En un CLI que ejecuta una persona sobre su propia máquina eso es
razonable. Pero el plugin MCP spawnea este mismo CLI con argumentos que
vienen de un agente
(`projects/plugins/mcp-vertex_expostman/src/lib/contracts/cli-path.constant.ts`),
y ahí quien decide la ruta ya no es necesariamente la persona.

**Impact**: una ruta con `../` escribe fuera del proyecto. El brief lo
clasifica como FATAL cuando la entrada no está validada contra la raíz
del workspace; aquí se queda en BAD porque la superficie expuesta es el
plugin y no un servidor abierto, pero la corrección es la misma y es
barata.

**Resolution Track**: [Deferred to proposal `p00045` slice `s4`]

---

### 8. Eliminar los 21 castings que apagan el compilador

**Fichero**: `projects/core/helpers/collection-identity.helper.ts#L116`

```ts
return Buffer.from(uuid.replace(/-/g, ""), "hex") as unknown as Uint8Array;
```

**Fichero**: `projects/plugins/mcp-vertex_expostman/src/lib/helpers/runner.helper.ts#L245`

```ts
? new TextDecoder().decode(r.stdout as unknown as Uint8Array)
```

Inventario completo, 21 sitios: 2 en `openapi.scanner.ts` (`as any`,
hallazgo 3), 1 en `collection-identity.helper.ts`, 2 en `runner.helper.ts`,
8 en `collection-invariants.helper.spec.ts`, 3 en
`postman-api.service.spec.ts` y 5 repartidos por otras specs.

**Problem**: `as unknown as T` es una aserción que el compilador no puede
contradecir — apaga exactamente la comprobación que justifica tener
tipos. Y ninguno de los cuatro de producción hace falta: `Buffer` **es**
un `Uint8Array`, y lo que falla es la declaración ambient escrita a mano
en `postman.d.ts`, no el código. Los 17 de tests construyen objetos
inválidos a propósito para los casos negativos; eso se expresa con una
factoría tipada, no con una aserción.

**Impact**: cada uno es un punto donde el tipo declarado y el valor real
pueden divergir sin que nada avise — el mismo mecanismo que dejó pasar
los doce `as never` de `readdir` corregidos en `ecb9505`, donde el tipo
llevaba tiempo mintiendo y nadie lo sabía.

**Resolution Track**: [Deferred to proposal `p00047` slices `s1`–`s3`]

---

### 9. Unificar `readFlag`, que tiene cuatro copias y dos tipos

**Fichero**: `projects/core/discovery/project-context.service.ts#L107`

```ts
function readFlag(argv: ReadonlyArray<string>, name: string): string | undefined {
```

**Fichero**: `projects/core/discovery/project-loader.service.ts#L49`

```ts
function readFlag(argv: string[], name: string): string | null {
```

Cuatro implementaciones: las dos de arriba, `push.script.ts#L26`
(`string | null`) e `init.script.ts#L25`, que además se llama `flag`.

**Problem**: leer un flag de `argv` es una función de seis líneas copiada
cuatro veces, y las dos que viven en el núcleo discrepan en cómo dicen
"no está".

**Impact**: quien lea una y escriba `?? ""` acertará en dos sitios y
fallará en los otros dos, porque `null ?? ""` y `undefined ?? ""` sí
coinciden, pero `flag === undefined` sobre un `null` no. Es un fallo que
no rompe el compilador y se manifiesta como un valor por defecto que no
se aplica.

**Resolution Track**: [Deferred to proposal `p00047` slice `s4`]

---

### 10. Compartir la detección por manifiesto entre scanners

**Fichero**: `projects/frameworks/scanners/hono.scanner.ts#L73`

```ts
async function readPackageJson(projectRoot: string): Promise<Record<string, unknown> | null> {
```

El mismo cuerpo, palabra por palabra, en
`projects/frameworks/scanners/fastify.scanner.ts#L71`. Y otros cinco
scanners (`nextjs`, `trpc`, `express`, `nestjs`, `graphql`) leen
`package.json` por su cuenta con reglas propias.

**Problem**: siete implementaciones de "¿este proyecto depende de X?", y
no se comportan igual: unas miran `devDependencies` y otras no, unas
capturan el error de parseo y otras lo dejan subir. Lo mismo con los tres
de Python (`requirements.txt` / `pyproject.toml` / `Pipfile`) y los dos
de Go (`go.mod`).

**Impact**: un framework declarado en `devDependencies` se detecta o no
según cuál sea. Un `package.json` con una coma de más rompe unos
scanners y otros no. Es comportamiento distinto para una pregunta que es
la misma.

**Resolution Track**: [Deferred to proposal `p00047` slice `s5`]

---

## 🟡 MINOR

### 11. Borrar la constante `NAMESPACE`, que no la usa nadie

**Fichero**: `projects/plugins/mcp-vertex_expostman/src/lib/contracts/namespace.ts#L2`

```ts
export const NAMESPACE = "postman" as const;
```

`grep` sobre todo `src/` excluyendo su propia declaración: vacío.

**Problem**: el bootstrap §3.1 la declara "single source of truth" del
nombre de los tools. El código usa `ctx.namespacePrefix`.

**Impact**: código muerto que una regla escrita defiende. Quien siga el
bootstrap la importará y construirá un nombre que el host no despacha.

**Resolution Track**: [Deferred to proposal `p00046` slice `s1`]

---

### 12. Apuntar `search` y `conventions` a carpetas que existen

**Fichero**: `mcp-vertex.config.json` → `plugins.search.options.roots`

```json
"roots": ["contract", "service", "helper", "scripts", "plugins", "examples"]
```

El propio servidor lo denuncia en `overview.configIssues`: `"contract"
does not exist in this workspace — the search plugin will scan nothing`.

**Problem**: cuatro de las seis raíces (`contract`, `service`, `helper`,
`plugins`) son de la estructura anterior a `projects/`.

**Impact**: los plugins `search` y `conventions` escanean una fracción
del repo y nadie se entera, porque devuelven resultados — solo que
incompletos.

**Resolution Track**: [Deferred to proposal `p00046` slice `s3`]

---

### 13. Hablar un solo idioma en la salida del CLI

**Fichero**: `projects/cli/commands/generate.script.ts#L238`

```ts
console.log("→ Enriching with validation-rule variants…");
```

Y en el mismo comando, al fallar: `✗ No se ha encontrado ningún
endpoint, así que no se escribe nada.` Medido: `generate` y `push` en
inglés; `diff`, `enrich`, `init`, `stats`, `validate-json` y `watch` en
español.

**Problem**: la prosa interna en español es una decisión del proyecto y
está bien. La salida al usuario es superficie de producto y mezcla los
dos idiomas, a veces en la misma ejecución.

**Impact**: no rompe nada; hace que la herramienta parezca dos
herramientas.

**Resolution Track**: [Deferred to proposal `p00048`]

---

### 14. Probar los seis comandos que nadie ejecuta en tests

**Fichero**: `projects/cli/commands/scan.script.ts`

Ningún test lanza `scan`, `open-postman`, `init`, `push`, `watch` ni
`summary`. Algunos tienen probada su pieza pura
(`tests/core/watcher.service.spec.ts`, `tests/core/postman-api.service.spec.ts`),
pero no el comando: parseo de flags, códigos de salida, mensajes.

**Problem**: la mitad de la superficie del CLI no se ejercita nunca de
punta a punta.

**Impact**: demostrado en esta misma ronda — el vaciado de `enrich`
(hallazgo 5) vivía en un comando sin test y apareció al primer intento
de ejecutarlo.

**Resolution Track**: [Deferred to proposal `p00049`]

---

### 15. Partir el `main()` de 325 líneas de `generate`

**Fichero**: `projects/cli/commands/generate.script.ts#L133`

```ts
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
```

325 líneas: descubre, construye, aplica auth, enriquece, exporta a seis
formatos, escribe entornos e imprime el informe.

**Problem**: cada trozo es razonable; el conjunto no se puede probar por
partes. Es el fichero al que hay que tocar para cualquier cambio de
comportamiento del comando principal.

**Impact**: riesgo de regresión concentrado en un punto, y ninguna de sus
fases tiene test propio.

**Resolution Track**: [Deferred to proposal `p00047` slice `s6`]

---

### 16. Blindar el parser de YAML escrito a mano

**Fichero**: `projects/frameworks/scanners/openapi.scanner.ts#L80`

```ts
export function parseYamlLite(src: string): unknown {
```

267 líneas.

**Problem**: lee specs OpenAPI de otra gente, que es entrada no
controlada, y es la única vía de entrada del framework con más endpoints
medidos (23 en `docs/FRAMEWORKS.md`).

**Impact**: el brief pide explícitamente *property-based testing* en
lógica de parseo con varias capas de validación. Hoy se prueba con
ejemplos concretos; una entrada rara da un resultado silenciosamente
distinto en vez de un error.

**Resolution Track**: [Deferred to proposal `p00049`]

---

### 17. Documentar los sufijos de fichero que el repo ya usa

**Fichero**: `docs/mcp-vertex/AGENT-BOOTSTRAP.md#L155`

La tabla de §3.5 declara cuatro sufijos: `*.service.ts`, `*.helper.ts`,
`*.interface.ts` / `*.constant.ts`, `*.tool.ts`. `conventions_check`
sobre `projects/` devuelve 57 sin rol canónico; quitando los fixtures
—que son código ajeno a propósito— quedan
`projects/core/adapters/parsed-route-to-spec.adapter.ts`,
`projects/core/discovery/discovery.orchestrator.ts`,
`projects/core/discovery/generation.pipeline.ts`, los cuatro
`projects/core/exporters/*.exporter.ts` y
`projects/ui/interactive.script.ts`.

**Problem**: `.adapter.ts`, `.exporter.ts`, `.orchestrator.ts` y
`.pipeline.ts` son sufijos buenos y descriptivos que no están
documentados en ninguna parte. `docs/NAMING.md` tampoco los recoge.

**Impact**: `lint:naming` pasa porque conoce la lista real; la
documentación no. Quien añada un exportador nuevo no tiene dónde mirar.

**Resolution Track**: [Deferred to proposal `p00046` slice `s4`]

---

### 18. Llevar el plugin a los doce comandos

**Fichero**: `projects/plugins/mcp-vertex_expostman/src/lib/tools/generate.tool.ts`

Cuatro tools (`generate`, `validate`, `summary`, `test`) contra doce
comandos del CLI.

**Problem**: un agente no puede listar endpoints, ver estadísticas,
comprobar deriva (`check`) ni subir a Postman.

**Impact**: `check` es el más llamativo: responde "¿se ha desincronizado
la colección con el código?", que es justo la pregunta que un agente
querría hacer, y no está expuesta.

**Resolution Track**: [Deferred to proposal `p00050`]

---

### 19. Borrar dos carpetas vacías

**Fichero**: `projects/core/export-to-postman/`

Vacía, igual que `tests/fixtures/fiber-comprehensive/internal/`.

**Problem**: la primera lleva el nombre del producto dentro del núcleo,
lo que invita a pensar que ahí vive algo.

**Impact**: cosmético.

**Resolution Track**: [Deferred to proposal `p00046` slice `s4`]

---

### 20. Confirmar que las alertas de Dependabot llegan a cero

**Fichero**: `.github/dependabot.yml#L1`

Las 67 alertas salían de los 50 manifiestos que este repo contiene y no
son suyos (`examples/`, `tests/`), no de lo que se instala — `bun audit`
y `security_audit` dan cero. Declararlos en el `.yml` no las cierra: el
`.yml` gobierna las *actualizaciones*; las *alertas* salen del grafo de
dependencias, que escanea todo y no admite exclusiones por ruta. Subidas
las 21 declaraciones que alertaban; el grafo ya lo refleja para npm y
composer (`next ^15.5.21`, `fastify ^5.8.3`, `@apollo/server ^5.5.0`,
`@nestjs/core ^11.1.18`, `laravel/framework >= 12.61.1`). Go va por
detrás.

**Problem**: mientras no bajen, hay 67 avisos de dependencias que no
existen.

**Impact**: esconden el día que aparezca uno de verdad.

**Resolution Track**: [Corregido en `ecb9505`; queda verificar el cierre]

---

## 🟢 OK

### 21. Seguridad operacional de ejecución: sin hallazgos

**Fichero**: `projects/cli/commands/open-postman.script.ts#L76`

```ts
const r = spawnSync("cmd", ["/c", "start", "", collectionPath], { stdio: "inherit" });
```

**Problem**: ninguno. Se auditó a propósito.

**Impact**: ningún `spawn` usa `shell: true` en todo el árbol; los
argumentos van como array también en Windows, así que una ruta con
espacios o metacaracteres no se interpreta. La API key se lee de
`--api-key` o del entorno, viaja en la cabecera `X-Api-Key` y no se
escribe en ningún fichero. `security_audit`: 0 secretos, 0 CVE, licencias
limpias sobre 241 ficheros.

**Resolution Track**: [Nada que hacer]

---

## 🌟 GOOD

### 22. Calidad de la suite de tests

**Fichero**: `tests/e2e/pipeline-reentrancy.test.ts`

**Problem**: ninguno.

**Impact**: medido sobre los 93 ficheros de test: ni un solo test vacuo
(ninguno con menos `expect` que casos), ni un `.skip`, ni un `.only`, ni
un `.todo`. Los seis formatos de exportación tienen 42 tests. La
reentrancia del pipeline y la concurrencia tienen ficheros propios
(`pipeline-reentrancy.test.ts`, `concurrent-pipeline.test.ts`), que es
justo lo que el brief pide comprobar y casi nunca está.

**Resolution Track**: [Nada que hacer]

---

### 23. Los gates propios del repo

**Fichero**: `scripts/gates/lint-boundaries.script.ts`

**Problem**: ninguno.

**Impact**: trece lints, y varios comprueban cosas que normalmente no
comprueba nadie: que el núcleo no importe de `frameworks/`
(`lint:boundaries`), que `docs/API.md` siga al día con el área pública
(`lint:api`), que la tabla de frameworks coincida con lo que miden los
scanners (`lint:frameworks-table`), que la carpeta de una propuesta
coincida con su `status` (`lint:proposals`). Es infraestructura de
calidad por encima de lo habitual.

**Resolution Track**: [Nada que hacer]

---

## Nota sobre `link_check`: 12 falsos positivos

`link_check` reporta 14 hallazgos. Doce no son reales, y se comprueban a
mano antes de darlos por buenos:

```
docs/FRAMEWORKS.md#L16   [OpenAPI](#openapi--swagger)  →  ## OpenAPI / Swagger
```

Por las reglas de GitHub —minúsculas, quitar lo que no sea
alfanumérico/espacio/guion, espacios a guiones— `OpenAPI / Swagger`
produce `openapi--swagger`, con dos guiones porque la barra desaparece y
deja dos espacios. El ancla es correcta. Lo mismo con `#django--drf`,
`#express--koa--hapi`, `#rust-actix-web--rocket`, los seis del bootstrap
universal y el de `POSTMAN.md`: todos son títulos con `/`, `—` o `(...)`.
El slugificador de `link_check` colapsa los espacios consecutivos antes
de convertirlos.

Los 2 restantes sí son reales: enlaces rotos en `p00007` y `p00002`,
ambos en propuestas archivadas, donde el bootstrap §5 permite rutas
históricas como arqueología. Se anota, no se corrige.

## Nota sobre el propio plugin `audit`

Tres desajustes entre el brief que emite `audit_plan` y el parser que
lee el resultado (`plugins/audit/src/lib/services/parse-audit.service.ts`):

- El brief pone la severidad en el `### N.` de cada hallazgo; el parser
  la toma del `##` de sección (`extractFindings`, `classifyHeader`).
- El brief pide `**File**:`; el parser solo reconoce
  `**Fichero**:` / `**Archivo**:` para poblar `files[]`.
- El brief pide cerrar con `**Final note:**`; el parser busca
  `**Nota final:**` o `**Nota global:**`.

Este documento sigue al **parser**, que es quien lo consume. Con el
formato del brief, `audit_consolidate` devolvía `findings: []`.

---

## 📊 Puntuación final

| Dimensión | Nota |
|---|---|
| Architecture | 6/10 |
| Contracts & interfaces | 5/10 |
| Token efficiency | 7/10 |
| Concurrency / anti-deadlock | 6/10 |
| Source code quality | 6/10 |
| Documentation | 5/10 |
| Tests (structure, coverage, quality) | 7/10 |
| Operational security | 5/10 |
| Genericity (project-agnostic) | 6/10 |

**Nota final: 6/10 — un producto que funciona de verdad (21/21 ejemplos, 1.883 tests, cero CVE) sobre una disciplina de contrato que se ha soltado: cuatro tools sin `outputSchema`, ninguna escritura atómica, una propiedad colada por `as any`, y un bootstrap que describe una arquitectura que ya no existe.**

---

## 📝 Recomendaciones prioritarias

- 🔴 **P0** — Declarar `outputSchema` en los 4 tools y añadir el gate que lo exija · `projects/plugins/mcp-vertex_expostman/src/lib/tools/*.tool.ts`
- 🔴 **P0** — Escribir con fichero temporal + `rename` toda salida durable · `projects/cli/commands/generate.script.ts#L312`, `watch.script.ts#L76`
- 🔴 **P0** — Añadir `framework` y clave de operación a `ParsedRoute`; retirar `__params` · `projects/core/contracts/scanner.interface.ts#L52`
- 🟠 **P1** — Reescribir §3.1, §3.5 y §3.8 del bootstrap contra el código actual · `docs/mcp-vertex/AGENT-BOOTSTRAP.md`
- 🟠 **P1** — Eliminar los 21 `as any` / `as unknown as` / `as never` · 8 ficheros, ver hallazgo 8

---

## Slices

- global_gate: e2e

### S1 — Seguimiento: que los 23 hallazgos acaben cerrados
- **Status**: done
- **Files**: `docs/mcp-vertex/proposals/ready/a00001-auditor-a-completa-2026-08-08-cerrar-los-23-hallazgos.md`
- **Gate**: none
- acceptance:
  - "Cada hallazgo de esta auditoría está o corregido o repartido en una propuesta con id"
  - "Las alertas de Dependabot llegan a 0: bajaron de 67 a 15 al subir las 21 declaraciones, y las 15 que quedan son de Go, pendientes de que reindexe el grafo"
  - "Al cerrar, esta propuesta se archiva en `done/audits/`"

## Reparto en propuestas

El trabajo no vive aquí: vive en ocho propuestas, una por sección. Esta
queda como el registro de qué se midió y por qué.

| Propuesta | Hallazgos | Prioridad |
|---|---|---|
| `x00001` — contratos de la superficie MCP | 1 (FATAL), 18 | **P0** |
| `x00002` — durabilidad de la escritura | 2 (FATAL) | **P0** |
| `r00001` — identidad de endpoint | 3 (FATAL), 6 | **P0** |
| `d00001` — documentación y configuración al día | 4, 11, 12, 17, 19 | P1 |
| `r00002` — código reutilizable, cero castings | 8, 9, 10, 15 | P1 |
| `x00003` — contención de rutas de salida | 7 | P1 |
| `t00001` — cobertura de comandos y parser | 14, 16 | P2 |
| `r00003` — un solo idioma en el CLI | 13 | P2 |
| `r00004` — retirar o rehacer `enrich` | 5 | P2 |
| `f00001` — UI de escritorio | encargo aparte | a decidir |

Los hallazgos 20 a 23 no generan propuesta: el 20 es seguimiento (S1),
y del 21 al 23 son las tres cosas que están bien y se dejan anotadas
para no romperlas sin darse cuenta.
