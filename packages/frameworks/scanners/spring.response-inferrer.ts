/**
 * Spring response inferrer (audit 2026-09-06 §10, proposal
 * `f00012` S4).
 *
 * Reads Spring / Spring Boot controllers and emits
 * `IResponseInference` entries from these signals:
 *
 * 1. `@ApiResponses(@ApiResponse(code = 200, message = "ok",
 *    response = UserDTO.class))` → status 200, ref UserDTO,
 *    high confidence.
 * 2. `@ApiResponse(code = 201, ...)` per occurrence →
 *    status 201, ref, high.
 * 3. `produces = MediaType.APPLICATION_JSON_VALUE` +
 *    `ResponseEntity<UserDTO>` shape → status 200 (default),
 *    ref UserDTO, medium (we don't have reflection here).
 *
 * Regex-based on purpose — Spring sources use a mix of
 * annotations and generics. The same hygiene used for
 * NestJS / FastAPI applies: reset regex `lastIndex` at
 * the start of every `infer()` call.
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
 * `@ApiResponse(code = 200, ...)` and the `@ApiResponses`
 * wrapper. Captures: (code, response-class-name).
 */
const API_RESPONSE_RE =
  /@ApiResponse\s*\(\s*[^)]*?code\s*=\s*(\d+)[\s\S]*?response\s*=\s*([A-Za-z_][A-Za-z0-9_.]*)/g;

/**
 * `ResponseEntity<UserDTO>` return type. Captures the
 * generic type name.
 */
const RESPONSE_ENTITY_RE = /ResponseEntity\s*<\s*([A-Za-z_][A-Za-z0-9_.]*)/g;

export class SpringResponseInferrer implements IResponseInferrer {
  readonly framework = "springboot";

  infer(
    _spec: EndpointSpecLike,
    source: IFrameworkSourceFileLike,
  ): ReadonlyArray<IResponseInference> {
    const txt = source.content;
    const entries: IResponseInference[] = [];

    // Module-level RegExp hygiene (mirrors NestJS / FastAPI
    // fix — see f00012 S3 commit message).
    API_RESPONSE_RE.lastIndex = 0;
    RESPONSE_ENTITY_RE.lastIndex = 0;

    // (1)+(2) @ApiResponse / @ApiResponses(... @ApiResponse(...) ...)
    let m: RegExpExecArray | null;
    while ((m = API_RESPONSE_RE.exec(txt)) !== null) {
      const code = Number.parseInt(m[1] ?? "200", 10);
      // Java: `UserDTO.class` → drop the `.class` suffix
      // so the $ref is the bare type name; matches the
      // convention of the FastAPI / NestJS inferrers.
      const ref = (m[2] ?? "").replace(/\.class$/, "");
      if (ref.length === 0) continue;
      entries.push({
        status: code,
        schema: { kind: "ref", $ref: ref },
        confidence: "high",
        reason: `@ApiResponse(code=${code}, response=${ref})`,
      });
    }

    // (3) ResponseEntity<X> return type (medium confidence)
    while ((m = RESPONSE_ENTITY_RE.exec(txt)) !== null) {
      const ref = m[1] ?? "";
      if (ref.length === 0) continue;
      entries.push({
        status: 200,
        schema: { kind: "ref", $ref: ref },
        confidence: "medium",
        reason: `Spring ResponseEntity<${ref}>`,
      });
    }

    return entries;
  }
}

registerResponseInferrer(new SpringResponseInferrer());
