export interface LiveChange {
  readonly kind: "added" | "modified" | "removed";
  readonly path: string;
}