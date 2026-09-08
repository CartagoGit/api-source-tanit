import { Injectable, signal } from "@angular/core";
import { HistoryClient, type IHistoryConfiguration, type IHistoryDiff, type IHistoryEntry, type IHistoryRestoreResult } from "../api/history.client";

@Injectable({ providedIn: "root" })
export class HistoryStore {
  readonly entries = signal<ReadonlyArray<IHistoryEntry>>([]);
  readonly selectedId = signal<string | null>(null);
  readonly diff = signal<IHistoryDiff | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly lastRestore = signal<IHistoryRestoreResult | null>(null);
  readonly lastExport = signal<unknown>(null);
  readonly compareConfiguration = signal<IHistoryConfiguration>({});

  constructor(private readonly client: HistoryClient) {}

  async load(projectRoot: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try { this.entries.set(await this.client.list(projectRoot)); } catch (error) { this.error.set(error instanceof Error ? error.message : String(error)); } finally { this.loading.set(false); }
  }

  async compare(projectRoot: string, leftId: string, rightId: string, configuration?: IHistoryConfiguration): Promise<void> {
    this.error.set(null);
    this.compareConfiguration.set(configuration ?? {});
    try { this.diff.set(await this.client.compare(projectRoot, leftId, rightId, configuration)); } catch (error) { this.error.set(error instanceof Error ? error.message : String(error)); }
  }

  async compareConfig(projectRoot: string, leftId: string, rightId: string): Promise<void> {
    this.error.set(null);
    try { this.compareConfiguration.set(await this.client.compareConfig(projectRoot, leftId, rightId) ?? {}); } catch (error) { this.error.set(error instanceof Error ? error.message : String(error)); }
  }

  async reExport(projectRoot: string, historyId: string, configuration?: IHistoryConfiguration): Promise<void> {
    this.error.set(null);
    try { this.lastExport.set(await this.client.reExport(projectRoot, historyId, configuration)); } catch (error) { this.error.set(error instanceof Error ? error.message : String(error)); }
  }

  async restore(projectRoot: string, historyId: string): Promise<void> {
    this.error.set(null);
    try { this.lastRestore.set(await this.client.restore(projectRoot, historyId)); await this.load(projectRoot); } catch (error) { this.error.set(error instanceof Error ? error.message : String(error)); }
  }
}