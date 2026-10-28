import { Injectable, signal } from "@angular/core";

@Injectable({ providedIn: "root" })
export class ProjectStore {
  readonly projectRoot = signal<string | null>(null);
  readonly projectName = signal("Tanit");

  open(path: string): void {
    this.projectRoot.set(path);
    this.projectName.set(path.split(/[\\/]/).filter(Boolean).at(-1) ?? "Tanit");
  }

  close(): void {
    this.projectRoot.set(null);
    this.projectName.set("Tanit");
  }
}
