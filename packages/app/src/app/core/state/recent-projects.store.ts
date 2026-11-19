import { Injectable, signal } from "@angular/core";

import type { IRecentProject } from "../../../../../contracts/interfaces/core/recent-projects.interface";

export type { IRecentProject } from "../../../../../contracts/interfaces/core/recent-projects.interface";

const MAX_RECENTS = 10;

@Injectable({ providedIn: "root" })
export class RecentProjectsStore {
  readonly projects = signal<ReadonlyArray<IRecentProject>>([]);
  private scope = "default";

  load(workspaceScope = "default"): void {
    this.scope = workspaceScope || "default";
    const raw = this.storage()?.getItem(this.key());
    if (!raw) {
      this.projects.set([]);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      const entries = Array.isArray(parsed)
        ? parsed.filter(this.isRecentProject).sort((left, right) => right.lastOpened - left.lastOpened).slice(0, MAX_RECENTS)
        : [];
      this.projects.set(entries);
    } catch {
      this.projects.set([]);
    }
  }

  add(path: string, lastOpened = Date.now()): void {
    const cleanPath = path.trim();
    if (!cleanPath) return;
    const next = [{ path: cleanPath, lastOpened }, ...this.projects().filter((project) => project.path !== cleanPath)].slice(0, MAX_RECENTS);
    this.projects.set(next);
    this.persist();
  }

  remove(path: string): void {
    this.projects.set(this.projects().filter((project) => project.path !== path));
    this.persist();
  }

  clear(): void {
    this.projects.set([]);
    this.storage()?.removeItem(this.key());
  }

  private persist(): void {
    this.storage()?.setItem(this.key(), JSON.stringify(this.projects()));
  }

  private key(): string { return `tanit.recent-projects.${this.scope}`; }
  private storage(): Storage | undefined { return typeof localStorage === "undefined" ? undefined : localStorage; }

  private isRecentProject(value: unknown): value is IRecentProject {
    return typeof value === "object" && value !== null && typeof (value as IRecentProject).path === "string" && typeof (value as IRecentProject).lastOpened === "number";
  }
}