/**
 * Import resolver contract (audit 2026-09-06 §12, proposal
 * `r00014` S2).
 *
 * The implementation lives in
 * `packages/core/discovery/import-resolver.ts`, which is a thin
 * adapter over the `ModuleResolver`
 * (`packages/core/module-resolution/resolver.service.ts`). The
 * contract lives here so other frontends (Python, Go, Rust, …) can
 * publish candidates with the same shape.
 *
 * One candidate the resolver can return.
 *
 * - `path`: absolute path of the candidate. It keeps the dialect it
 *   was written in, so a Windows import stays a Windows path.
 * - `kind`: why the candidate was produced. A relative or absolute
 *   candidate says whether it is the literal path, an extension
 *   fallback or an `index.*` fallback; a candidate that came from a
 *   resolution rule carries the name of that rule (`tsconfig-paths`,
 *   `package-exports`, `node-modules`, `workspace`, …).
 */
import type {
  ModuleCandidateForm,
  ModuleResolutionKind,
} from "./module-resolution.interface.js";

export interface IImportCandidate {
  /** Absolute path of the candidate. */
  readonly path: string;
  /** Why the candidate was produced. */
  readonly kind: ModuleCandidateForm | ModuleResolutionKind;
}
