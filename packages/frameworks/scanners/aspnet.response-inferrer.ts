/**
 * ASP.NET response inferrer (audit 2026-09-06 §10, proposal
 * `f00012` S4).
 *
 * Reads C# controllers and emits `IResponseInference`
 * entries from these signals:
 *
 * 1. `[ProducesResponseType(typeof(User), 200)]` →
 *    status 200, ref User, high.
 * 2. `[SwaggerResponse(200, typeof(User))]` → status 200,
 *    ref User, high.
 * 3. No body — `IActionResult` / `void` / `Task` —
 *    204, empty, medium.
 *
 * Regex-based. Same `lastIndex` hygiene as the other
 * f00012 inferrers.
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
 * `[ProducesResponseType(typeof(X), 200)]` and
 * `[ProducesResponseType(200, Type = typeof(X))]`.
 * Captures: (type-name, status). The order varies
 * depending on whether positional `(Status, Type)`
 * or named `(Status = 200, Type = typeof(...))` was
 * used. We accept both via two patterns.
 */
const PRODUCES_TYPEOF_RE =
  /ProducesResponseType\s*\(\s*(?:typeof\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)|Type\s*=\s*typeof\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\))\s*,\s*(?:Status\s*=\s*)?(\d+)/g;

const PRODUCES_NO_TYPE_RE =
  /ProducesResponseType\s*\(\s*(?:Status\s*=\s*)?(\d+)\s*\)/g;

const SWAGGER_RESPONSE_RE =
  /SwaggerResponse\s*\(\s*(\d+)\s*,\s*typeof\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)/g;

export class AspNetResponseInferrer implements IResponseInferrer {
  readonly framework = "aspnet";

  infer(
    _spec: EndpointSpecLike,
    source: IFrameworkSourceFileLike,
  ): ReadonlyArray<IResponseInference> {
    const txt = source.content;
    const entries: IResponseInference[] = [];

    PRODUCES_TYPEOF_RE.lastIndex = 0;
    SWAGGER_RESPONSE_RE.lastIndex = 0;
    PRODUCES_NO_TYPE_RE.lastIndex = 0;

    // (1) ProducesResponseType(typeof(X), 200) → high
    let m: RegExpExecArray | null;
    while ((m = PRODUCES_TYPEOF_RE.exec(txt)) !== null) {
      const ref = m[1] ?? m[2] ?? "";
      const status = Number.parseInt(m[3] ?? "200", 10);
      if (ref.length === 0) continue;
      entries.push({
        status,
        schema: { kind: "ref", $ref: ref },
        confidence: "high",
        reason: `ProducesResponseType(typeof(${ref}), ${status})`,
      });
    }

    // (1b) ProducesResponseType(200) without a body — status code only
    while ((m = PRODUCES_NO_TYPE_RE.exec(txt)) !== null) {
      const status = Number.parseInt(m[1] ?? "200", 10);
      entries.push({
        status,
        schema: { kind: "empty" },
        confidence: "medium",
        reason: `ProducesResponseType(${status})`,
      });
    }

    // (2) SwaggerResponse(200, typeof(X))
    while ((m = SWAGGER_RESPONSE_RE.exec(txt)) !== null) {
      const status = Number.parseInt(m[1] ?? "200", 10);
      const ref = m[2] ?? "";
      if (ref.length === 0) continue;
      entries.push({
        status,
        schema: { kind: "ref", $ref: ref },
        confidence: "high",
        reason: `SwaggerResponse(${status}, typeof(${ref}))`,
      });
    }

    return entries;
  }
}

registerResponseInferrer(new AspNetResponseInferrer());
