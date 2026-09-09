export interface IDoctorReport {
  readonly databasePath: string;
  readonly database: "available" | "missing" | "corrupt";
  readonly dbVersion: number | null;
  readonly migration: "current" | "unavailable";
  readonly activeSnapshot: string | null;
  readonly lastWrite: string | null;
  readonly corruption: string | null;
  readonly parity: "not-run" | "unavailable";
  readonly secretsOmitted: true;
}

export interface IDoctorOutcome {
  readonly code: number;
  readonly output: string;
  readonly report: IDoctorReport;
}