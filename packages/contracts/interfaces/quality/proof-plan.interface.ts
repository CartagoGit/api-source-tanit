/** A proof records its scope; an omitted job is never a successful check. */
export interface IProofPlan {
  readonly version: 1;
  readonly base: string;
  readonly head: string;
  readonly mode: "full" | "affected";
  readonly reasons: readonly string[];
  readonly changedFiles: readonly string[];
  readonly sections: readonly string[];
  readonly specs: readonly string[];
  readonly jobs: Readonly<Record<string, boolean>>;
  readonly steps: readonly IProofStep[];
}

/** Commands are argv arrays, never shell fragments derived from filenames. */
export interface IProofStep {
  readonly id: string;
  readonly job: string;
  readonly argv: readonly string[];
}

/** Repository facts are injected so planning is deterministic and testable. */
export interface IProofInput {
  readonly base: string;
  readonly head: string;
  readonly changes: readonly { readonly path: string; readonly status: string }[];
  readonly files: Readonly<Record<string, string>>;
  readonly forceFull?: boolean;
  readonly uncertainty?: string;
}
