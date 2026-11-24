import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";

import type {
  ClientProjectCandidates,
  ClientProjectRole,
  ClientUnresolvedReason,
  IClientConsumptionResult,
  IClientProjectLinksInput,
  IClientProjectLinksReport,
} from "../../../../../contracts/interfaces/core/client-consumption.interface";
import { HostBridgeClient } from "../../core/api/host-bridge.client";
import { I18nService } from "../../core/i18n/i18n.service";
import { FolderPickerComponent } from "../home/folder-picker.component";
import { clientUsageReasonLabel, clientUsageStatusLabel } from "./client-usage-labels.helper";

@Component({
  selector: "tanit-client-links",
  standalone: true,
  imports: [FolderPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./client-links.component.html",
  styleUrls: ["./client-links.component.scss"],
})
export class ClientLinksComponent {
  readonly i18n = inject(I18nService);
  private readonly bridge = inject(HostBridgeClient);
  readonly picker = signal<ClientProjectRole | null>(null);
  readonly pending = signal<"candidates" | "links" | null>(null);
  readonly error = signal<string | null>(null);
  readonly report = signal<IClientProjectLinksReport | null>(null);

  readonly frontendChoices = signal<readonly string[]>([]);
  private readonly backendCatalogs = signal<readonly Extract<ClientProjectCandidates, { role: "backend" }>[]>([]);
  readonly backendChoices = computed(() => this.backendCatalogs().flatMap(({ root, services }) =>
    services.map((service) => ({ ...service, root, key: this.backendKey(root, service.serviceId) }))));
  readonly selectedFrontends = signal<readonly string[]>([]);
  readonly selectedBackendKeys = signal<readonly string[]>([]);
  readonly selectedBackends = computed(() => this.backendChoices()
    .filter(({ key }) => this.selectedBackendKeys().includes(key)));
  readonly links = signal<IClientProjectLinksInput["links"]>([]);

  readonly draftFrontend = signal("");
  readonly draftBackend = signal("");
  readonly linkToAdd = computed(() => {
    const frontendRoot = this.draftFrontend();
    const backend = this.selectedBackends().find(({ key }) => key === this.draftBackend());
    if (!this.selectedFrontends().includes(frontendRoot) || backend === undefined) return null;
    const link = { frontendRoot, backendRoot: backend.root, serviceId: backend.serviceId };
    return this.links().some((item) =>
      item.frontendRoot === frontendRoot && item.backendRoot === backend.root && item.serviceId === backend.serviceId)
      ? null
      : link;
  });

  async discover(role: ClientProjectRole, projectRoot: string): Promise<void> {
    if (this.pending() !== null) return;
    this.picker.set(null);
    this.clearReport();
    this.pending.set("candidates");
    try {
      const candidates = await this.bridge.request("client-candidates", { role, projectRoot });
      if (candidates.role === "frontend") {
        this.frontendChoices.update((paths) => [...new Set([...paths, ...candidates.projects.map(({ root }) => root)])]);
      } else {
        this.backendCatalogs.update((catalogs) => [
          ...catalogs.filter(({ root }) => root !== candidates.root),
          candidates,
        ]);
        const available = new Set(this.backendChoices().map(({ key }) => key));
        this.selectedBackendKeys.update((keys) => keys.filter((key) => available.has(key)));
        this.links.update((links) => links.filter(({ backendRoot, serviceId }) =>
          available.has(this.backendKey(backendRoot, serviceId))));
        if (!available.has(this.draftBackend())) this.draftBackend.set("");
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.pending.set(null);
    }
  }

  selectFrontend(root: string, selected: boolean): void {
    if (this.pending() !== null) return;
    this.selectedFrontends.update((roots) => selected ? [...roots, root] : roots.filter((path) => path !== root));
    if (!selected) {
      this.links.update((links) => links.filter(({ frontendRoot }) => frontendRoot !== root));
      if (this.draftFrontend() === root) this.draftFrontend.set("");
    }
    this.clearReport();
  }

  selectBackend(key: string, selected: boolean): void {
    if (this.pending() !== null) return;
    this.selectedBackendKeys.update((keys) => selected ? [...keys, key] : keys.filter((candidate) => candidate !== key));
    if (!selected) {
      this.links.update((links) => links.filter(({ backendRoot, serviceId }) => this.backendKey(backendRoot, serviceId) !== key));
      if (this.draftBackend() === key) this.draftBackend.set("");
    }
    this.clearReport();
  }

  addLink(): void {
    const link = this.linkToAdd();
    if (this.pending() !== null || link === null) return;
    this.links.update((links) => [...links, link]);
    this.clearReport();
  }

  removeLink(removed: IClientProjectLinksInput["links"][number]): void {
    if (this.pending() !== null) return;
    this.links.update((links) => links.filter((link) => link !== removed));
    this.clearReport();
  }

  async analyze(): Promise<void> {
    const frontends = this.selectedFrontends().map((root) => ({ root }));
    if (this.pending() !== null || frontends.length === 0) return;
    this.picker.set(null);
    this.clearReport();
    this.pending.set("links");
    try {
      this.report.set(await this.bridge.request("client-links", { frontends, links: this.links() }));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.pending.set(null);
    }
  }

  statusLabel(status: string): string {
    return clientUsageStatusLabel(this.i18n, status);
  }

  reasonLabel(reason: ClientUnresolvedReason | IClientConsumptionResult["diagnostics"][number]["reason"]): string {
    return clientUsageReasonLabel(this.i18n, reason);
  }

  frontendLabel(root: string): string {
    const name = this.folderName(root);
    return this.frontendChoices().some(path => path !== root && this.folderName(path) === name) ? root : name;
  }

  serviceName(serviceId: string, root: string): string {
    const candidate = this.backendChoices().find(service => service.root === root && service.serviceId === serviceId);
    const name = candidate?.relativePath || this.folderName(root);
    const duplicate = this.backendChoices().some(service =>
      (service.root !== root || service.serviceId !== serviceId) &&
      (service.relativePath || this.folderName(service.root)) === name);
    return duplicate ? this.serviceLabel(serviceId, root) : name;
  }

  private folderName(root: string): string {
    return root.split(/[\\/]+/u).filter(Boolean).at(-1) ?? root;
  }

  serviceLabel(serviceId: string, root: string): string {
    return `${serviceId} · ${root}`;
  }

  backendLabel(backends: IClientProjectLinksReport["frontends"][number]["backends"], backendId: string): string {
    const backend = backends.find(({ id }) => id === backendId);
    return backend === undefined ? backendId : this.serviceLabel(backend.serviceId, backend.root);
  }

  private backendKey(root: string, serviceId: string): string {
    return JSON.stringify([root, serviceId]);
  }

  private clearReport(): void {
    this.report.set(null);
    this.error.set(null);
  }
}
