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
import { endpointKey } from "../helpers/route-identity.helper.js";
import {
  ENDPOINT_CONFIDENCE_WEIGHTS,
  type Confidence,
  type IEndpointMergeCandidate,
  type IEndpointMerger,
  type IEndpointProvenance,
  type IEndpointProvenanceEntry,
  type IMergeEndpointsOptions,
  type IMergeOutcome,
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
 * Implementación por defecto del `IEndpointMerger`. Stateless: el
 * estado vive en `merge()` (los candidatos), no en la instancia.
 * Reutilizable entre llamadas concurrentes.
 */
export class EndpointMerger implements IEndpointMerger {
  private readonly confidence: Readonly<Record<string, Confidence>>;

  constructor(options: IMergeEndpointsOptions = {}) {
    this.confidence = options.frameworkConfidence ?? FRAMEWORK_CONFIDENCE;
  }

  merge(candidates: ReadonlyArray<IEndpointMergeCandidate>): IMergedEndpoint {
    if (candidates.length === 0) {
      throw new Error(
        "EndpointMerger.merge: no se puede fusionar una lista vacía.",
      );
    }

    const sorted = sortCandidates(candidates);

    const method = sorted[0]!.method.toUpperCase();
    const uri = identityUri(sorted);
    const name = pickName(sorted);
    const winningRoute = pickRoute(sorted);

    const bodyWinner = pickBody(sorted, this.confidence);
    const fieldsWinner = pickFields(sorted, bodyWinner?.framework);
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

    return {
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
    const merged = merger.merge(group);
    specs.push(merged);
    provenance.push({
      method: merged.method,
      uri: merged.uri,
      provenance: merged.provenance,
      confidence: merged.confidence,
    });
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
 */
function sortCandidates(
  candidates: ReadonlyArray<IEndpointMergeCandidate>,
): IEndpointMergeCandidate[] {
  return [...candidates].sort((a, b) => {
    const confDiff =
      confidenceFor(b.framework, FRAMEWORK_CONFIDENCE) -
      confidenceFor(a.framework, FRAMEWORK_CONFIDENCE);
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
 * Une los fields de todos los candidatos por `fieldName`,
 * quedándose con la versión más restrictiva.
 *
 * El "primer candidato con body" manda como referencia para
 * desempates: si dos candidatos tienen el mismo campo con la misma
 * restrictividad, gana el del body-winner (porque es el que más
 * completo está en ese endpoint). Si nadie tiene body, gana el
 * primero en orden.
 */
function pickFields(
  sorted: ReadonlyArray<IEndpointMergeCandidate>,
  bodyWinnerFramework: string | undefined,
): ReadonlyArray<IValidationSpec> | null {
  const sources: IFieldSource[] = sorted
    .filter((c): c is IEndpointMergeCandidate & { fields: ReadonlyArray<IValidationSpec> } =>
      c.fields !== undefined && c.fields.length > 0,
    )
    .map((c) => ({ framework: c.framework, fields: c.fields }));
  if (sources.length === 0) return null;

  sources.sort((a, b) => {
    if (bodyWinnerFramework) {
      if (a.framework === bodyWinnerFramework) return -1;
      if (b.framework === bodyWinnerFramework) return 1;
    }
    return 0;
  });

  const byName = new Map<string, IValidationSpec>();
  const ordered: string[] = [];
  for (const src of sources) {
    for (const field of src.fields) {
      const existing = byName.get(field.fieldName);
      if (!existing) {
        byName.set(field.fieldName, field);
        ordered.push(field.fieldName);
        continue;
      }
      const merged = mergeFieldSpecs(existing, field);
      byName.set(field.fieldName, merged);
    }
  }
  return ordered
    .map((name) => byName.get(name))
    .filter((f): f is IValidationSpec => f !== undefined);
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

/** Agrupa candidatos por identidad (method + uri + name). */
function groupByIdentity(
  candidates: ReadonlyArray<IEndpointMergeCandidate>,
): Map<string, IEndpointMergeCandidate[]> {
  const groups = new Map<string, IEndpointMergeCandidate[]>();
  for (const c of candidates) {
    const key = endpointKey({
      method: c.method,
      uri: c.uri,
      ...(c.name !== undefined && c.name !== "" ? { name: c.name } : {}),
    });
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
 * Compara dos `IValidationSpec` del mismo campo y devuelve el más
 * restrictivo. Las reglas, en orden:
 *
 *   - `required: true` > `required: false`.
 *   - Tipo: `integer` > `number` > `string` > `object` > resto. Esto
 *     refleja "este campo rechaza más valores que el otro".
 *   - Si los tipos son equivalentes, gana el que tenga `format`
 *     declarado (porque un `string` con `format: uuid` rechaza
 *     strings que no lo sean).
 *   - Si todo coincide, gana el primero (que es el del body-winner
 *     por el orden de `sources`).
 */
function mergeFieldSpecs(a: IValidationSpec, b: IValidationSpec): IValidationSpec {
  if (a.required !== b.required) return a.required ? a : b;
  const typeRank = (t: IValidationSpec["type"]): number => {
    switch (t) {
      case "integer":
        return 5;
      case "number":
        return 4;
      case "string":
        return 3;
      case "object":
        return 2;
      case "array":
      case "boolean":
      case "date":
      case "datetime":
      case "enum":
      case "file":
      case "any":
      default:
        return 1;
    }
  };
  const aRank = typeRank(a.type);
  const bRank = typeRank(b.type);
  if (aRank !== bRank) return aRank > bRank ? a : b;
  const aFormat = a.format ?? "";
  const bFormat = b.format ?? "";
  if (aFormat !== bFormat) return aFormat.length > 0 ? a : b;
  return a;
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
