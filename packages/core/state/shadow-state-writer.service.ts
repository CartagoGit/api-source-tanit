import type { IProjectSnapshot } from "../../contracts/interfaces/core/project-state.interface.js";
import type { ProjectId } from "../../contracts/interfaces/core/stable-ids.interface.js";

/** Resultado de intentar persistir un snapshot en modo shadow. */
export interface IShadowWriteDiagnostic {
  readonly ok: boolean;
  readonly enabled: boolean;
  readonly persisted: boolean;
  readonly activated: false;
  readonly snapshotId: string;
  readonly error?: string;
}

/** Operación mínima de proyectos requerida por el escritor shadow. */
export interface IShadowProjectRepository {
  ensure(projectId: ProjectId, rootPath: string, now: string): void;
}

export interface IShadowTransactionService {
  write(snapshot: IProjectSnapshot): IProjectSnapshot;
}

/** Persiste snapshots opcionalmente sin activar autoridad durable. */
export class ShadowStateWriterService {
  public constructor(
    private readonly transactions: IShadowTransactionService,
    private readonly projects: IShadowProjectRepository,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public write(
    snapshot: IProjectSnapshot,
    rootPath: string,
    enabled: boolean,
  ): IShadowWriteDiagnostic {
    const base = {
      enabled,
      activated: false as const,
      snapshotId: snapshot.snapshotId.value,
    };
    if (!enabled) return { ...base, ok: true, persisted: false };

    try {
      this.projects.ensure(snapshot.projectId, rootPath, this.now());
      const complete = this.transactions.write(snapshot);
      return { ...base, ok: true, persisted: complete.status === "complete" };
    } catch (error) {
      return {
        ...base,
        ok: false,
        persisted: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}