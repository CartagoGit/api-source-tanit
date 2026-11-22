import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";

import type { ClientUnresolvedReason, IClientConsumptionResult, IClientUsage } from "../../../../../contracts/interfaces/core/client-consumption.interface";
import { HostBridgeClient } from "../../core/api/host-bridge.client";
import { I18nService } from "../../core/i18n/i18n.service";
import { ProjectStore } from "../../core/state/project.store";
import { FolderPickerComponent } from "../home/folder-picker.component";

@Component({
  selector: "tanit-client-usage",
  standalone: true,
  imports: [FolderPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./client-usage.component.html",
  styleUrls: ["./client-usage.component.scss"],
})
export class ClientUsageComponent {
  readonly i18n = inject(I18nService);
  private readonly bridge = inject(HostBridgeClient);
  readonly openProjectRoot = inject(ProjectStore).projectRoot;
  readonly frontendRoot = signal<string | null>(null);
  readonly backendRoot = signal<string | null>(null);
  readonly picker = signal<"frontend" | "backend" | null>(null);
  readonly running = signal(false);
  readonly report = signal<IClientConsumptionResult | null>(null);
  readonly error = signal<string | null>(null);
  readonly state = computed(() => {
    if (this.running()) return "running";
    if (this.error() !== null) return "error";
    const report = this.report();
    if (report === null) return "idle";
    return report.usages.length > 0 ? "ready" : "empty";
  });

  private readonly stateKeys: Readonly<Record<string, string>> = {
    resolved: "clientUsage.resolved",
    unresolved: "clientUsage.unresolved",
    matched: "clientUsage.matched",
    missing: "clientUsage.missing",
    ambiguous: "clientUsage.ambiguous",
    unknown: "clientUsage.unknown",
  };

  setRoot(role: "frontend" | "backend", path: string | null): void {
    if (this.running()) return;
    this.picker.set(null);
    const selection = role === "frontend" ? this.frontendRoot : this.backendRoot;
    if (selection() === path) return;
    selection.set(path);
    this.error.set(null);
    this.report.set(null);
  }

  async analyze(): Promise<void> {
    const projectRoot = this.frontendRoot();
    if (projectRoot === null || this.running()) return;
    const backendRoot = this.backendRoot();
    this.picker.set(null);
    this.report.set(null);
    this.error.set(null);
    this.running.set(true);
    try {
      this.report.set(await this.bridge.request("client-usage", {
        projectRoot,
        ...(backendRoot === null ? {} : { backendRoot }),
      }));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.running.set(false);
    }
  }

  usageState(usage: IClientUsage): string {
    return usage.correlation?.status ?? (usage.unresolvedReason ? "unresolved" : "resolved");
  }

  stateLabel(state: string): string {
    return this.i18n.translate(this.stateKeys[state] ?? state);
  }

  reasonLabel(reason: ClientUnresolvedReason | IClientConsumptionResult["diagnostics"][number]["reason"]): string {
    switch (reason) {
      case "shadowed-client": return this.i18n.translate("clientUsage.reasons.shadowed-client");
      case "unresolved-alias": return this.i18n.translate("clientUsage.reasons.unresolved-alias");
      case "unsupported-call": return this.i18n.translate("clientUsage.reasons.unsupported-call");
      case "dynamic-url": return this.i18n.translate("clientUsage.reasons.dynamic-url");
      case "invalid-url": return this.i18n.translate("clientUsage.reasons.invalid-url");
      case "relative-url": return this.i18n.translate("clientUsage.reasons.relative-url");
      case "dynamic-method": return this.i18n.translate("clientUsage.reasons.dynamic-method");
      case "unknown-options": return this.i18n.translate("clientUsage.reasons.unknown-options");
      case "unsupported-template": return this.i18n.translate("clientUsage.reasons.unsupported-template");
      case "unsupported-script": return this.i18n.translate("clientUsage.reasons.unsupported-script");
      case "parse-failed": return this.i18n.translate("clientUsage.reasons.parse-failed");
    }
  }
}
