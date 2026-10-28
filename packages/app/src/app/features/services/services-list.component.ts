import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { ServicesClient, type IServiceDetail } from "../../core/api/services.client";
import { ProjectStore } from "../../core/state/project.store";
import { ServiceDetailComponent } from "./service-detail.component";

@Component({
  selector: "tanit-services-list",
  standalone: true,
  imports: [ServiceDetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="services-list">
      <header><h2>Services</h2><span>{{ services().length }}</span></header>
      @for (service of services(); track service.serviceId) {
        <button type="button" (click)="selected.set(service.serviceId)">
          <strong>{{ service.serviceId }}</strong><span>{{ service.framework }}</span>
          <small>{{ service.operationCount }} operations · {{ service.transports.join(", ") }} · {{ service.baseUrl || "No base URL" }} · auth {{ service.auth ? "configured" : "none" }}</small>
        </button>
      } @empty { <p>No services discovered.</p> }@if (selected(); as serviceId) { <tanit-service-detail [serviceId]="serviceId" /> }
    </section>
  `,
})
export class ServicesListComponent {
  readonly services = signal<ReadonlyArray<IServiceDetail>>([]);
  readonly selected = signal<string | null>(null);
  private readonly project = inject(ProjectStore);
  private readonly client = inject(ServicesClient);

  async load(): Promise<void> {
    const root = this.project.projectRoot();
    if (root) this.services.set(await this.client.list(root));
  }
}