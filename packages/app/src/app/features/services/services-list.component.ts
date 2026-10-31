import { ChangeDetectionStrategy, Component, effect, inject, signal } from "@angular/core";

import { IServiceDetail } from "../../core/api/services.client";
import { ServicesClient } from "../../core/api/services.client";
import { EndpointsStore } from "../../core/state/endpoints.store";
import { ProjectStore } from "../../core/state/project.store";
import { ServiceDetailComponent } from "./service-detail.component";
import { BadgeComponent } from "../../shared/badge/badge.component";

/**
 * The services of the open project.
 *
 * What each row shows comes from the backend: the id, the framework
 * that recognized it and how many operations it holds. The
 * transports are counted from the endpoints the app already has.
 *
 * The row used to show a base URL and an auth reference that no
 * handler returns — the client cast the answer into a shape with
 * more fields than the answer had, and the extra ones were
 * `undefined` on a good day.
 */
@Component({
  selector: "tanit-services-list",
  standalone: true,
  imports: [ServiceDetailComponent, BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./services-list.component.html",
  styleUrls: ["./services-list.component.scss"],
})
export class ServicesListComponent {
  readonly services = signal<ReadonlyArray<IServiceDetail>>([]);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly selected = signal<string | null>(null);
  private readonly project = inject(ProjectStore);
  private readonly client = inject(ServicesClient);
  private readonly endpoints = inject(EndpointsStore);

  constructor() {
    // The services are asked for when the project opens. The section
    // used to have a `load()` that nobody called, so it said "no
    // services discovered" about a project that had them.
    effect(() => {
      if (this.project.projectRoot() !== null) void this.load();
    });
  }

  /** Opens the detail of one service. */
  select(serviceId: string): void {
    this.selected.set(this.selected() === serviceId ? null : serviceId);
  }

  async load(): Promise<void> {
    const root = this.project.projectRoot();
    if (root === null) return;
    this.error.set(null);
    this.loading.set(true);
    try {
      this.services.set(await this.client.listWithEndpoints(root, this.endpoints.all()));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.loading.set(false);
    }
  }
}
