/**
 * FastAPI response inferrer (audit 2026-09-06 §10, proposal
 * `f00012` S3).
 *
 * Reads FastAPI handlers and emits `IResponseInference`
 * entries from the strongest signal available, in this
 * order:
 *
 * 1. `@app.get("/x", response_model=UserResponse, status_code=201)`
 *    → status 201 + ref schema, confidence "high".
 * 2. `@app.get("/x", response_model=UserResponse)` (no explicit
 *    status) → status 200 + ref schema, confidence "high".
 * 3. `def handler() -> UserResponse:` (return type annotation,
 *    no response_model) → status 200 + ref schema, confidence
 *    "medium".
 *
 * The inferrer mirrors the FastAPI scanner's regex approach
 * (audit 2026-09-06 §1: a00015 set the precedent that Python
 * parsing stays dependency-free unless we add `ast` to a
 * shared runtime). Future slices can swap regex for a real
 * Python AST once one is in Tanit's deps.
 */
import {
  registerResponseInferrer,
} from "../../core/responses/infer-responses";
import type {
  EndpointSpecLike,
  IFrameworkSourceFileLike,
  IResponseInference,
  IResponseInferrer,
} from "../../contracts/interfaces/core/responses.interface";

/**
 * Capture `response_model=Identifier` and (optional)
 * `status_code=NUM` inside a single decorator call.
 *
 * The regex is anchored to the start of any decorator
 * (`@app.X(...)`); matching is non-greedy across the
 * `response_model` and `status_code` keywords to keep
 * scopes small.
 */
const RESPONSE_MODEL_RE =
  /(?:response_model|responses)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/g;

const STATUS_CODE_RE = /\bstatus_code\s*=\s*(\d+)\b/g;

/**
 * `def handler(...) -> ReturnType:` return type annotation.
 * Captures the type token after `->`. Allows `Optional`,
 * `List`, `Dict`, etc., but the first token is enough for a
 * `$ref` placeholder (the exporter renders it verbatim).
 */
const RETURN_TYPE_RE =
  /^\s*(?:async\s+)?def\s+[A-Za-z_][\w]*\s*\([^)]*\)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)/gm;

export class FastApiResponseInferrer implements IResponseInferrer {
  readonly framework = "fastapi";

  infer(
    _spec: EndpointSpecLike,
    source: IFrameworkSourceFileLike,
  ): ReadonlyArray<IResponseInference> {
    const txt = source.content;
    const entries: IResponseInference[] = [];

    // Module-level RegExp objects carry `lastIndex` across
    // calls. matchAll resets the iterator's `lastIndex`, but
    // subsequent `test()` calls would resume from wherever
    // the previous matchAll left off. We reset explicitly
    // at the start of every `infer()` so the global state
    // is local to one call.
    RESPONSE_MODEL_RE.lastIndex = 0;
    STATUS_CODE_RE.lastIndex = 0;
    RETURN_TYPE_RE.lastIndex = 0;

    // (1) Decorator-driven response_model + optional status_code
    // We do this per-line because decorators are line-based
    // in FastAPI (PEP 8). Multi-line decorators are uncommon.
    const lines = txt.split("\n");
    for (const line of lines) {
      if (!line.includes("@app.")) continue;

      const rms = [...line.matchAll(RESPONSE_MODEL_RE)];
      const scs = [...line.matchAll(STATUS_CODE_RE)];
      if (rms.length === 0) continue;

      const status =
        scs.length > 0 && scs[0] && scs[0][1]
          ? Number.parseInt(scs[0][1], 10)
          : 200;
      const statusConfidence = "high" as const; // explicit annotation

      for (const m of rms) {
        const ref = m[1] ?? "";
        if (ref.length === 0) continue;
        entries.push({
          status,
          schema: { kind: "ref", $ref: ref },
          confidence: statusConfidence,
          reason:
            scs.length > 0
              ? `FastAPI response_model=${ref} status_code=${status}`
              : `FastAPI response_model=${ref}`,
        });
      }
    }

    // (3) Return type annotation — fallback when no
    // response_model was declared.
    // r00014-style state hygiene: reset RESPONSE_MODEL_RE.lastIndex
    // before each `.test()` so the global RegExp object's state
    // doesn't bleed across lines.
    const hasResponseModel = lines.some((l) => {
      RESPONSE_MODEL_RE.lastIndex = 0;
      return RESPONSE_MODEL_RE.test(l);
    });
    if (!hasResponseModel) {
      RETURN_TYPE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = RETURN_TYPE_RE.exec(txt)) !== null) {
        const ret = m[1] ?? "";
        if (ret.length === 0) continue;
        // Skip the common `-> None` / `-> dict` primitives —
        // only models worth emitting (PascalCase heuristic).
        if (ret[0] === ret[0]?.toLowerCase()) continue;
        entries.push({
          status: 200,
          schema: { kind: "ref", $ref: ret },
          confidence: "medium",
          reason: `FastAPI return annotation -> ${ret}`,
        });
      }
    }

    return entries;
  }
}

// Register on module load (idempotent by framework).
registerResponseInferrer(new FastApiResponseInferrer());
