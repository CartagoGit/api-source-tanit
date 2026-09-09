export interface IProvenance {
  readonly sourceFile: string;
  readonly line?: number;
  readonly column?: number;
  readonly framework?: string;
  readonly confidence?: number;
}