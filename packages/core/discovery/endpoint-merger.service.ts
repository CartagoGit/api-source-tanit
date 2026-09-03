/**
 * `EndpointMerger`: el reconciliador de endpoints para proyectos
 * híbridos.
 *
 * Para cada identidad (method + uri normalizada), recibe las
 * contribuciones de N scanners y devuelve UN `IMergedEndpoint` con la
 * mejor pieza de cada tipo y la provenance completa.
 *
 * ## Reglas
 *
 * Las reglas están escritas en el orden de prioridad. Cuando hay
 * empate se documenta la regla de desempate; si no la hay, gana el
 * candidato que llegó primero — que en el pipeline es el de mayor
 * `scannerScore` (el orquestador ya ordena por confianza).
 *
 * 1. **Identidad**: `method` (uppercased) + `uri` normalizada vía
 *    `endpointKey` (misma fórmula que `dedupeSpecs`). Es la única
 *    identidad: dos candidatos con misma identidad son candidatos a
 *    fusionar.
 * 2. **Body**: gana el de mayor confianza. A igual confianza, gana
 *    OpenAPI > schema-based (Fastify/Hono) > resto. A igual tipo de
 *    fuente, gana el primero.
 * 3. **Fields**: unión por `fieldName`, conservando el más
 *    restrictivo (`required: true` > `required: false`,
 *    `integer` > `number` > `string`, `format` no vacío gana a vacío).
 *    Si los dos dicen lo mismo, gana el primero (el del candidato
 *    con mayor body, o el primero en orden si ninguno trae body).
 * 4. **Auth**: gana el de mayor confianza. Si los dos son
 *    explícitos y discrepan (uno dice `bearer`, otro `apikey`), se
 *    añade un warning. Si solo uno es explícito, ese gana sin
 *    warning.
 * 5. **Description**: gana la más larga (en chars). Empate: la
 *    primera.
 * 6. **Confidence global**: media ponderada
 *    (`route 0.4 / body 0.3 / auth 0.2 / description 0.1`),
 *    redistribuyendo los pesos de las piezas ausentes.
 *
 * ## Confianza por framework
 *
 * La tabla `FRAMEWORK_CONFIDENCE` es el único sitio donde se mapea
 * framework → confianza. Es interna a propósito: cualquier otro
 * mapeo (p. ej. por tipo de fuente) sería un detalle de este
 * servicio. Si un día hay que ampliarla, el cambio va aquí y los
 * tests lo cazan.
 *
 * ## Lo que NO hace
 *
 * - No normaliza URIs más allá de `endpointKey` — eso ya lo hace el
 *   pipeline. Aquí se CONSUME esa clave.
 * - No inventa campos. Si nadie aportó `body`, `body` queda
 *   `undefined` (el adapter agnóstico llenará después).
 * - No detecta conflictos de campos a nivel de **valores**: si A
 *   dice `minLength: 3` y B dice `minLength: 5`, gana el más
 *   restrictivo (5). Esto es deliberado: dos frameworks raramente
 *   declaran reglas contradictorias a propósito, y cuando lo hacen
 *   el más estricto es lo que la API real va a rechazar.
 */
import { normalizeForComparison } from "../helpers/uri.helper.js";
import {
  ENDPOINT_CONFIDENCE_WEIGHTS,
  type Confidence,
  type IEndpointMergeCandidate,
  type IEndpointMerger,
  type IEndpointProvenance,
  type IEndpointProvenanceEntry,
  type IMergeEndpointsOptions,
  type IMergeOutcome,
  type IMergeResult,
  type IMergedEndpoint,
} from "../../contracts/interfaces/core/merge.interface.js";
import type { IDetectedAuthScheme } from "../../contracts/interfaces/core/discovery.interface.js";
import type { IValidationSpec } from "../../contracts/interfaces/core/scanner.interface.js";

/**
 * Confianza por framework. La tabla está cerrada a propósito: si un
 * scanner nuevo entra, hay que decidir su valor aquí, no dejar que
 * el merger adivine.
 *
 * - **0.95** — OpenAPI: los autores lo declaran a mano, suele ser
 *   la fuente más cuidada.
 * - **0.85** — Schemas declarados en código (Fastify JSON Schema,
 *   Hono zod, Fiber/Rust structs): los validadores forman parte del
 *   binario, son ejecutables.
 * - **0.5** — Heurística regex sobre el código fuente: lo normal en
 *   el resto de scanners; acierta pero no garantiza nada.
 */
const FRAMEWORK_CONFIDENCE: Readonly<Record<string, Confidence>> = {
  openapi: 0.95,
  fastify: 0.85,
  hono: 0.85,
  fiber: 0.85,
  rust: 0.85,
};

/** Confianza por defecto cuando el framework no está en la tabla. */
const DEFAULT_FRAMEWORK_CONFIDENCE: Confidence = 0.5;

/**
 * Frameworks que multiplexan operaciones en un único endpoint.
 *
 * Un RPC puro (GraphQL, tRPC) suele tener **un** endpoint —`POST
 * /graphql`, `POST /trpc/<path>`— y lo que distingue una operación de
 * otra es el nombre. La pregunta de "qué framework hace esto" se
 * responde por **id** aquí, no por forma de las rutas como hace el
 * helper `needsNameToDisambiguate(routes)` del paquete de identidad
 * (que responde "¿estos routes que me llegan colisionan por uri?").
 *
 * OpenAPI se queda fuera por defecto: aunque declare `operationId`,
 * la convención más extendida es una ruta por operación
 * (`/users`, `/users/{id}`), no multiplexar por POST único. Si en el
 * futuro se quiere soportar `oneOf`/`anyOf` por `operationId`, el
 * cambio va aquí y los tests lo cazan.
 */
const RPC_MULTIPLEXED_FRAMEWORKS: ReadonlySet<string> = new Set([
  "graphql",
  "trpc",
]);

/**
 * Devuelve `true` cuando el framework multiplexa operaciones por
 * nombre en lugar de por URI. Es la pieza que faltaba para resolver
 * la confusión a00010 ↔ a00011 B-rev-3: dos candidatos del mismo
 * framework con mismo `(method, uri)` y distinto nombre deben acabar
 * en grupos distintos, no fusionarse por error.
 */
function frameworkMultiplexesByName(framework: string): boolean {
  return RPC_MULTIPLEXED_FRAMEWORKS.has(framework);
}

/**
 * Implementación por defecto del `IEndpointMerger`. Stateless: el
 * estado vive en `merge()` (los candidatos), no en la instancia.
 * Reutilizable entre llamadas concurrentes.
 */
export class EndpointMerger implements IEndpointMerger {
  private readonly confidence: Readonly<Record<string, Confidence>>;

  constructor(options: IMergeEndpointsOptions = {}) {
    this.confidence = options.frameworkConfidence ?? FRAMEWORK_CONFIDENCE;
  }

  merge(candidates: ReadonlyArray<IEndpointMergeCandidate>): IMergeResult {
    if (candidates.length === 0) {
      throw new Error(
        "EndpointMerger.merge: no se puede fusionar una lista vacía.",
      );
    }

    const sorted = sortCandidates(candidates, this.confidence);

    const method = sorted[0]!.method.toUpperCase();
    const uri = identityUri(sorted);
    const name = pickName(sorted);
    const winningRoute = pickRoute(sorted);

    const bodyWinner = pickBody(sorted, this.confidence);
    const {
      fields: fieldsWinner,
      conflicts: fieldConflicts,
    } = pickFields(sorted, bodyWinner?.framework, this.confidence);
    const authWinner = pickAuth(sorted, this.confidence);
    const descriptionWinner = pickDescription(sorted);

    const provenance: IEndpointProvenance = {
      route: {
        framework: winningRoute.framework,
        confidence: confidenceFor(winningRoute.framework, this.confidence),
      },
      ...(bodyWinner
        ? {
            body: {
              framework: bodyWinner.framework,
              confidence: confidenceFor(bodyWinner.framework, this.confidence),
            },
          }
        : {}),
      ...(authWinner
        ? { auth: { framework: authWinner.framework, evidence: authWinner.evidence } }
        : {}),
      ...(descriptionWinner
        ? { description: { framework: descriptionWinner.framework } }
        : {}),
      contributors: sorted.map((c) => c.framework),
    };

    const merged: IMergedEndpoint = {
      method,
      uri,
      ...(name ? { name } : {}),
      ...(bodyWinner?.body !== undefined ? { body: bodyWinner.body } : {}),
      ...(fieldsWinner ? { fields: fieldsWinner } : {}),
      ...(authWinner?.authScheme
        ? { authScheme: authWinner.authScheme }
        : {}),
      ...(descriptionWinner?.description !== undefined
        ? { description: descriptionWinner.description }
        : {}),
      provenance,
      confidence: computeConfidence(provenance, this.confidence),
    };

    return { merged, conflicts: fieldConflicts };
  }
}

/**
 * Punto de entrada de pipeline: recibe la lista plana de candidatos
 * y devuelve los endpoints fusionados + provenance + warnings.
 *
 * Los candidatos ya vienen ordenados por `scannerScore` descendente
 * (es lo que hace `discoverSpecs`); el merger los re-ordena dentro
 * de cada grupo por `frameworkConfidence` y desempata por el orden
 * de llegada, que coincide con el del orquestador.
 */
export function mergeEndpoints(
  candidates: ReadonlyArray<IEndpointMergeCandidate>,
  options: IMergeEndpointsOptions = {},
): IMergeOutcome {
  if (candidates.length === 0) {
    return { specs: [], provenance: [], warnings: [] };
  }

  const merger = new EndpointMerger(options);
  const groups = groupByIdentity(candidates);
  const specs: IMergedEndpoint[] = [];
  const provenance: IEndpointProvenanceEntry[] = [];
  const warnings: string[] = [];

  for (const group of groups.values()) {
    const { merged, conflicts: fieldConflicts } = merger.merge(group);
    specs.push(merged);
    provenance.push({
      method: merged.method,
      uri: merged.uri,
      provenance: merged.provenance,
      confidence: merged.confidence,
    });
    for (const c of fieldConflicts) warnings.push(c);
    const conflict = detectAuthConflict(group);
    if (conflict) warnings.push(conflict);
  }

  return { specs, provenance, warnings };
}

/**
 * Wrapper para consumir candidatos desde `EndpointSpec[]` (la forma
 * que produce el adapter). Conserva el `framework` por candidato a
 * partir de la metadata del spec: el pipeline marca el spec con
 * `formRequest` o el nombre del controller, pero la fuente más
 * fiable es pasar el `framework` explícitamente (que es lo que
 * hace `discoverSpecs` cuando itera sobre los `usable`).
 */
export function candidatesFromSpecs(
  scannerScore: ReadonlyMap<string, Confidence>,
): (
  specs: ReadonlyArray<{
    name: string;
    method: string;
    uri: string;
    framework?: string;
    body?: unknown;
    fields?: ReadonlyArray<IValidationSpec>;
    authScheme?: IDetectedAuthScheme;
    description?: string;
  }>,
) => IEndpointMergeCandidate[] {
  return (specs) =>
    specs.map((spec) => {
      const framework = spec.framework ?? "unknown";
      return {
        framework,
        scannerScore: scannerScore.get(framework) ?? 0.5,
        method: spec.method,
        uri: spec.uri,
        ...(spec.name !== undefined && spec.name !== ""
          ? { name: spec.name }
          : {}),
        ...(spec.body !== undefined ? { body: spec.body } : {}),
        ...(spec.fields ? { fields: spec.fields } : {}),
        ...(spec.authScheme ? { authScheme: spec.authScheme } : {}),
        ...(spec.description !== undefined ? { description: spec.description } : {}),
      };
    });
}

/**
 * Inversa de `candidatesFromSpecs`: convierte un `IMergedEndpoint`
 * de vuelta a `EndpointSpec` para que el pipeline siga operando con
 * la forma que ya consumen el resto de servicios.
 *
 * Solo copia los campos que el merger decide: identidad (method,
 * uri, name) y las piezas que ganó (body, fields, description).
 * El `authScheme` del `IMergedEndpoint` **no** se copia al
 * `EndpointSpec`: la auth se resuelve globalmente en
 * `detectAuthScheme` después del pipeline, y el de cada endpoint
 * sería ruido (todos los endpoints de un proyecto comparten auth).
 */
export function endpointSpecFromMerged(m: IMergedEndpoint): {
  name: string;
  method: import("../../contracts/interfaces/core/postman.interface.js").EndpointSpec["method"];
  uri: string;
  body?: unknown;
  fields?: ReadonlyArray<
    IValidationSpec | import("../../contracts/interfaces/core/postman.interface.js").IEndpointField
  >;
  description?: string;
} {
  return {
    name: m.name ?? "",
    method: m.method as import("../../contracts/interfaces/core/postman.interface.js").EndpointSpec["method"],
    uri: m.uri,
    ...(m.body !== undefined ? { body: m.body } : {}),
    ...(m.fields !== undefined ? { fields: m.fields } : {}),
    ...(m.description !== undefined ? { description: m.description } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

/**
 * Ordena los candidatos dentro de un grupo: primero por
 * `frameworkConfidence` (mayor gana), luego por `scannerScore`, luego
 * por orden de llegada. El orden de llegada importa porque es la
 * última regla de desempate — el pipeline ya los entrega ordenados
 * por `scannerScore`.
 *
 * `confidence` es la tabla inyectada por el caller (constructor o
 * `mergeEndpoints`). Antes leía la constante global `FRAMEWORK_CONFIDENCE`
 * y un test que pasara su propia tabla no veía el efecto en el orden
 * (cerrado en a00011 B-rev-15).
 */
function sortCandidates(
  candidates: ReadonlyArray<IEndpointMergeCandidate>,
  confidence: Readonly<Record<string, Confidence>>,
): IEndpointMergeCandidate[] {
  return [...candidates].sort((a, b) => {
    const confDiff =
      confidenceFor(b.framework, confidence) -
      confidenceFor(a.framework, confidence);
    if (confDiff !== 0) return confDiff;
    const scoreDiff = b.scannerScore - a.scannerScore;
    if (scoreDiff !== 0) return scoreDiff;
    return 0;
  });
}

/** URI normalizada para el endpoint fusionado (la del ganador). */
function identityUri(
  sorted: ReadonlyArray<IEndpointMergeCandidate>,
): string {
  return sorted[0]!.uri;
}

/**
 * Nombre del endpoint fusionado: el del ganador. Es identidad, no
 * pieza a fusionar — GraphQL y tRPC dependen de él para distinguir
 * operaciones.
 */
function pickName(
  sorted: ReadonlyArray<IEndpointMergeCandidate>,
): string | undefined {
  return sorted[0]!.name;
}

/**
 * La ruta siempre viene del primer candidato: la ruta es la
 * identidad, no hay nada que comparar. El primer candidato es el
 * de mayor confianza, así que la provenance gana con él.
 */
function pickRoute(
  sorted: ReadonlyArray<IEndpointMergeCandidate>,
): IEndpointMergeCandidate {
  return sorted[0]!;
}

interface IBodyWinner {
  framework: string;
  body: unknown;
}

/**
 * Elige el body de mayor confianza. Solo cuentan los candidatos
 * que aportaron un body (`c.body !== undefined`). Si nadie aporta
 * body, devuelve `null`.
 */
function pickBody(
  sorted: ReadonlyArray<IEndpointMergeCandidate>,
  confidence: Readonly<Record<string, Confidence>>,
): IBodyWinner | null {
  let winner: IBodyWinner | null = null;
  let winnerConfidence = -1;
  for (const c of sorted) {
    if (c.body === undefined) continue;
    const cConfidence = confidenceFor(c.framework, confidence);
    if (cConfidence > winnerConfidence) {
      winner = { framework: c.framework, body: c.body };
      winnerConfidence = cConfidence;
    }
  }
  return winner;
}

interface IFieldSource {
  framework: string;
  fields: ReadonlyArray<IValidationSpec>;
}

/**
 * Une los fields de todos los candidatos por la clave compuesta
 * `${location}:${fieldName}`, quedándose con la versión más
 * restrictiva.
 *
 * La clave compuesta es lo que evita la colisión a00011 B-rev-4:
 * `path.id`, `query.id`, `body.id` y `header.id` son campos
 * distintos aunque compartan `fieldName`. Si un scanner los manda
 * con el mismo `fieldName` y distinta `location`, se funden
 * separadamente: cada uno es un campo del endpoint, no el mismo.
 *
 * El "primer candidato con body" manda como referencia para
 * desempates: si dos candidatos tienen el mismo campo con la misma
 * restrictividad, gana el del body-winner (porque es el que más
 * completo está en ese endpoint). Si nadie tiene body, gana el
 * primero en orden.
 *
 * Devuelve `{ fields, conflicts }`: los conflictos a nivel de campo
 * (intersección vacía de enums, type mismatch, formato/patrón
 * divergente) viajan al pipeline como warnings, no se imprimen
 * aquí.
 */
function pickFields(
  sorted: ReadonlyArray<IEndpointMergeCandidate>,
  bodyWinnerFramework: string | undefined,
  confidence: Readonly<Record<string, Confidence>>,
): { fields: ReadonlyArray<IValidationSpec> | null; conflicts: string[] } {
  const sources: IFieldSource[] = sorted
    .filter((c): c is IEndpointMergeCandidate & { fields: ReadonlyArray<IValidationSpec> } =>
      c.fields !== undefined && c.fields.length > 0,
    )
    .map((c) => ({ framework: c.framework, fields: c.fields }));
  if (sources.length === 0) return { fields: null, conflicts: [] };

  sources.sort((a, b) => {
    if (bodyWinnerFramework) {
      if (a.framework === bodyWinnerFramework) return -1;
      if (b.framework === bodyWinnerFramework) return 1;
    }
    return 0;
  });

  const byKey = new Map<string, { field: IValidationSpec; firstFramework: string }>();
  const ordered: string[] = [];
  const conflicts: string[] = [];

  for (const src of sources) {
    for (const field of src.fields) {
      const compositeKey = `${field.location}:${field.fieldName}`;
      const existing = byKey.get(compositeKey);
      if (!existing) {
        byKey.set(compositeKey, { field, firstFramework: src.framework });
        ordered.push(compositeKey);
        continue;
      }
      const result = mergeFieldSpecs(existing.field, field, {
        a: confidenceFor(existing.firstFramework, confidence),
        b: confidenceFor(src.framework, confidence),
      });
      byKey.set(compositeKey, { field: result.field, firstFramework: existing.firstFramework });
      if (result.conflict) {
        conflicts.push(
          `${compositeKey}: ${result.conflict} (entre ${existing.firstFramework} y ${src.framework})`,
        );
      }
    }
  }
  return {
    fields: ordered
      .map((k) => byKey.get(k)?.field)
      .filter((f): f is IValidationSpec => f !== undefined),
    conflicts,
  };
}

interface IAuthWinner {
  framework: string;
  authScheme: IDetectedAuthScheme | undefined;
  evidence: string;
}

/**
 * Elige el auth de mayor confianza. Si dos candidatos discrepan
 * en `type` (bearer vs apikey), se devuelve el ganador y el
 * caller añade un warning (no quiero que el merger pierda el
 * contexto de cuál fue el perdedor, pero tampoco quiero acoplarlo
 * a la lógica de warnings aquí).
 */
function pickAuth(
  sorted: ReadonlyArray<IEndpointMergeCandidate>,
  confidence: Readonly<Record<string, Confidence>>,
): IAuthWinner | null {
  let winner: IAuthWinner | null = null;
  let winnerConfidence = -1;
  for (const c of sorted) {
    if (c.authScheme === undefined) continue;
    const cConfidence = confidenceFor(c.framework, confidence);
    if (cConfidence > winnerConfidence) {
      winner = {
        framework: c.framework,
        authScheme: c.authScheme,
        evidence: c.authScheme.evidence,
      };
      winnerConfidence = cConfidence;
    }
  }
  return winner;
}

interface IDescriptionWinner {
  framework: string;
  description: string;
}

/** Gana la descripción más larga (en chars). Empate: la primera. */
function pickDescription(
  sorted: ReadonlyArray<IEndpointMergeCandidate>,
): IDescriptionWinner | null {
  let winner: IDescriptionWinner | null = null;
  for (const c of sorted) {
    if (c.description === undefined) continue;
    if (!winner || c.description.length > winner.description.length) {
      winner = { framework: c.framework, description: c.description };
    }
  }
  return winner;
}

/**
 * Devuelve un warning cuando hay dos candidatos con `authScheme`
 * distinto y ambos son "explícitos" (evidencia no vacía). Un
 * `evidence: ""` se considera implícito y se descarta en el
 * conflicto.
 */
function detectAuthConflict(
  group: ReadonlyArray<IEndpointMergeCandidate>,
): string | null {
  const explicit = group.filter(
    (c) => c.authScheme !== undefined && c.authScheme.evidence.length > 0,
  );
  if (explicit.length < 2) return null;
  const types = new Set(explicit.map((c) => c.authScheme!.type));
  if (types.size < 2) return null;
  return (
    `Conflicto de auth en ${explicit[0]!.authScheme!.type}/${[...types].join(",")}: ` +
    `los frameworks ${explicit.map((c) => c.framework).join(", ")} declaran ` +
    `esquemas distintos (${[...types].join(" vs ")}). Gana el de mayor confianza.`
  );
}

/**
 * Clave de agrupación del merger.
 *
 * NO usa `endpointKey()` del helper: la pregunta aquí es "¿qué
 * candidatos representa **el mismo endpoint**?" y la respuesta es
 * **depende del framework**:
 *
 * - **REST** (Express, OpenAPI, Fastify, etc.): `(method, uri)`. El
 *   nombre, si viene, es decoración: dos POST `/users` con nombres
 *   distintos son el mismo endpoint fusionado, y `pickName` decide
 *   qué nombre se queda.
 * - **RPC multiplexado** (GraphQL, tRPC): `(method, uri, name)`. Aquí
 *   `POST /graphql` con `name: "OpA"` y `name: "OpB"` son **dos
 *   endpoints distintos**, y fusionarlos perdería una operación
 *   entera sin avisar (cerrado en a00011 B-rev-3).
 *
 * Si el candidato es RPC y no trae `name`, se incluye igualmente: la
 * clave cae en un grupo propio y se advierte aguas arriba. No se
 * rechaza porque eso descartaría la operación entera y preferimos
 * un warning con endpoint vacío a un endpoint fantasma.
 */
function mergeKey(c: IEndpointMergeCandidate): string {
  const method = c.method.toUpperCase();
  const uri = normalizeForComparison(c.uri);
  if (frameworkMultiplexesByName(c.framework)) {
    return `${method} ${uri} ${c.name ?? ""}`;
  }
  return `${method} ${uri}`;
}

/** Agrupa candidatos por identidad contextual (REST o RPC). */
function groupByIdentity(
  candidates: ReadonlyArray<IEndpointMergeCandidate>,
): Map<string, IEndpointMergeCandidate[]> {
  const groups = new Map<string, IEndpointMergeCandidate[]>();
  for (const c of candidates) {
    const key = mergeKey(c);
    const existing = groups.get(key);
    if (existing) existing.push(c);
    else groups.set(key, [c]);
  }
  return groups;
}

/** Confianza por framework con fallback. */
function confidenceFor(
  framework: string,
  table: Readonly<Record<string, Confidence>>,
): Confidence {
  return table[framework] ?? DEFAULT_FRAMEWORK_CONFIDENCE;
}

/**
 * Compara dos `IValidationSpec` del **mismo** campo (el caller ya
 * agrupó por la clave compuesta `${location}:${fieldName}`) y devuelve
 * el resultado más restrictivo, junto con un posible `conflict` para
 * los casos donde la información no basta y hay que avisar al usuario.
 *
 * Reglas, en orden:
 *
 *   1. **`required`**: si A dice `true`, gana `true`. No hay
 *      conflicto: un scanner que exige el campo siempre gana sobre
 *      uno que lo deja opcional.
 *   2. **`type`**: si coinciden, ese. Si **difieren** (dominios
 *      disjuntos —`string` vs `object`—), la heurística antigua de
 *      "integer > number > string" no vale: eso no es restrictividad,
 *      es que **no son compatibles**.
 *      - Si la confianza de uno es estrictamente mayor, gana ese y
 *        no hay conflicto (la fuente más fiable habla más fuerte).
 *      - Si las confianzas son iguales, no se inventa: gana A (el
 *        primero en el orden del caller, que es el del body-winner)
 *        y se emite `conflict: "type mismatch"`.
 *   3. **`format`**: si difieren y los dos existen, warning + gana A.
 *      Si solo uno existe, ese sin warning.
 *   4. **`minimum` / `maximum`**: piso más alto / techo más bajo.
 *   5. **`minLength` / `maxLength`**: piso más alto / techo más bajo.
 *   6. **`pattern`**: si difieren y los dos existen, warning + gana A.
 *      Si solo uno existe, ese sin warning.
 *   7. **`enumValues`**: intersección. Si el resultado es vacío,
 *      **warning** (intersección vacía = "ningún valor satisface a
 *      los dos", hay que mirar qué scanner tiene más razón) y se
 *      conserva el enum del lado de mayor `confidence`/provenance —
 *      publicar `[]` descartaría el dominio entero.
 *   8. **`description`**: gana la más larga.
 *   9. **`example`**: gana el primero (el del body-winner).
 *
 * `location` y `fieldName` **deben** ser iguales — el caller ya
 * agrupó por la clave compuesta —; si no, es un bug del caller y se
 * lanza para que el bug sea visible, no silencioso.
 *
 * El parámetro `confidence` se inyecta desde `pickFields`, que ya
 * tiene la tabla del merger a mano. Esto evita que la función pura
 * `mergeFieldSpecs` importe la tabla global, que es lo que rompió
 * a00011 B-rev-5 (la implementación anterior leía la constante).
 */
function mergeFieldSpecs(
  a: IValidationSpec,
  b: IValidationSpec,
  confidence: { readonly a: number; readonly b: number },
): { readonly field: IValidationSpec; readonly conflict?: string } {
  if (a.fieldName !== b.fieldName || a.location !== b.location) {
    throw new Error(
      `mergeFieldSpecs: location:fieldName mismatch (${a.location}:${a.fieldName} vs ${b.location}:${b.fieldName}); el caller debe agrupar por la clave compuesta.`,
    );
  }

  // required: true gana sobre false.
  const required = a.required || b.required;

  // type: coincidencia exacta, dominio dominante por confianza, o
  // "no inventar + warning" cuando nadie tiene ventaja clara.
  let type: IValidationSpec["type"] = a.type;
  let typeConflict: string | undefined;
  if (a.type !== b.type) {
    if (confidence.a > confidence.b) {
      type = a.type;
    } else if (confidence.b > confidence.a) {
      type = b.type;
    } else {
      type = a.type;
      typeConflict = `type mismatch: ${a.type} vs ${b.type}`;
    }
  }

  // format: gana el que existe; warning si los dos existen y difieren.
  let format: string | undefined;
  let formatConflict: string | undefined;
  if (a.format !== undefined && b.format !== undefined) {
    format = a.format;
    if (a.format !== b.format) formatConflict = `format mismatch: ${a.format} vs ${b.format}`;
  } else {
    format = a.format ?? b.format;
  }

  // minimum: max(mínimos). maximum: min(máximos).
  const minimum = mergeBound(a.minimum, b.minimum, Math.max);
  const maximum = mergeBound(a.maximum, b.maximum, Math.min);
  // minLength: max. maxLength: min.
  const minLength = mergeBound(a.minLength, b.minLength, Math.max);
  const maxLength = mergeBound(a.maxLength, b.maxLength, Math.min);

  // pattern: gana el que existe; warning si los dos existen y difieren.
  let pattern: string | undefined;
  let patternConflict: string | undefined;
  if (a.pattern !== undefined && b.pattern !== undefined) {
    pattern = a.pattern;
    if (a.pattern !== b.pattern)
      patternConflict = `pattern mismatch: ${a.pattern} vs ${b.pattern}`;
  } else {
    pattern = a.pattern ?? b.pattern;
  }

  // enumValues: intersección; warning si el resultado es vacío.
  let enumValues: ReadonlyArray<string> | undefined;
  let enumConflict: string | undefined;
  if (a.enumValues !== undefined && b.enumValues !== undefined) {
    const intersection = a.enumValues.filter((v) =>
      b.enumValues!.includes(v),
    );
    if (intersection.length === 0) {
      // Intersección vacía = los dos scanners describen dominios
      // disjuntos; ninguna petición podría satisfacer a los dos si
      // se publicara `[]`. Perder el enum entero (o publicarlo vacío)
      // es peor que confiar en la fuente más fiable: se conserva el
      // lado de mayor `confidence`/provenance y se avisa con ambos
      // dominios para que el operador decida (contrato a00011 B-rev-5).
      enumValues = confidence.b > confidence.a ? b.enumValues : a.enumValues;
      enumConflict = `enum intersection empty: [${a.enumValues.join(",")}] vs [${b.enumValues.join(",")}] — se conserva el enum de mayor confianza`;
    } else {
      enumValues = intersection;
    }
  } else {
    enumValues = a.enumValues ?? b.enumValues;
  }

  // description: la más larga (en chars).
  let description: string | undefined;
  if (a.description !== undefined && b.description !== undefined) {
    description = a.description.length >= b.description.length ? a.description : b.description;
  } else {
    description = a.description ?? b.description;
  }

  // example: el primero (el del body-winner por el orden de `pickFields`).
  const example = a.example !== undefined ? a.example : b.example;

  const conflicts: string[] = [];
  if (typeConflict) conflicts.push(typeConflict);
  if (formatConflict) conflicts.push(formatConflict);
  if (patternConflict) conflicts.push(patternConflict);
  if (enumConflict) conflicts.push(enumConflict);

  const field: IValidationSpec = {
    fieldName: a.fieldName,
    location: a.location,
    type,
    required,
    ...(format !== undefined ? { format } : {}),
    ...(minimum !== undefined ? { minimum } : {}),
    ...(maximum !== undefined ? { maximum } : {}),
    ...(minLength !== undefined ? { minLength } : {}),
    ...(maxLength !== undefined ? { maxLength } : {}),
    ...(pattern !== undefined ? { pattern } : {}),
    ...(enumValues !== undefined ? { enumValues } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(example !== undefined ? { example } : {}),
  };

  if (conflicts.length === 0) return { field };
  return { field, conflict: conflicts.join("; ") };
}

/**
 * Combina dos cotas (mínimos o máximos) usando el comparador
 * correspondiente (`Math.max` para `minimum`/`minLength`,
 * `Math.min` para `maximum`/`maxLength`).
 *
 * Devuelve `undefined` si los dos lados son `undefined`. Si solo uno
 * existe, ese gana. Si los dos existen, se aplica el comparador.
 */
function mergeBound(
  a: number | undefined,
  b: number | undefined,
  combine: (x: number, y: number) => number,
): number | undefined {
  if (a !== undefined && b !== undefined) return combine(a, b);
  return a ?? b;
}

/**
 * Media ponderada de las piezas presentes. Redistribuye los pesos
 * de las piezas ausentes entre las presentes para que un endpoint
 * con solo ruta no salga con 0.4 de confianza por no tener body.
 */
function computeConfidence(
  provenance: IEndpointProvenance,
  confidence: Readonly<Record<string, Confidence>>,
): Confidence {
  const pieces: Array<{ weight: number; value: number }> = [];
  const routeConf = confidenceFor(provenance.route.framework, confidence);
  pieces.push({ weight: ENDPOINT_CONFIDENCE_WEIGHTS.route, value: routeConf });
  if (provenance.body) {
    const bodyConf = confidenceFor(provenance.body.framework, confidence);
    pieces.push({
      weight: ENDPOINT_CONFIDENCE_WEIGHTS.body,
      value: bodyConf,
    });
  }
  if (provenance.auth) {
    // Sin confidence numérica para auth, usamos la del framework como
    // proxy: el que detectó el auth tiene su propia confianza.
    const authConf = confidenceFor(provenance.auth.framework, confidence);
    pieces.push({ weight: ENDPOINT_CONFIDENCE_WEIGHTS.auth, value: authConf });
  }
  if (provenance.description) {
    const descConf = confidenceFor(provenance.description.framework, confidence);
    pieces.push({
      weight: ENDPOINT_CONFIDENCE_WEIGHTS.description,
      value: descConf,
    });
  }
  const totalWeight = pieces.reduce((acc, p) => acc + p.weight, 0);
  if (totalWeight === 0) return 0;
  const sum = pieces.reduce((acc, p) => acc + (p.weight * p.value), 0);
  return round(sum / totalWeight, 4);
}

function round(n: number, decimals: number): number {
  const m = 10 ** decimals;
  return Math.round(n * m) / m;
}
