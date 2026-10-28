import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from "@angular/core";
import { ServicesClient, type IServiceDetail } from "../../core/api/services.client";
import { ProjectStore } from "../../core/state/project.store";

@Component({
  selector: "tanit-service-detail",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (service(); as value) {
      <article><header><h2>{{ value.serviceId }}</h2><span>{{ value.framework }}</span></header>
        <p>{{ value.baseUrl || "No base URL" }} · {{ value.transports.join(", ") }} · {{ value.operationCount }} operations</p>
        <p>Auth: {{ value.auth ? "configured" : "none" }} · server {{ value.serverRef || "none" }} · auth {{ value.authRef || "none" }}</p>
        @for (operation of value.operations; track operation.operationId) {
          <div><strong>{{ operation.method }}</strong> {{ operation.path }} <small>{{ operation.operationId }} · server {{ operation.serverRef || value.serverRef || "none" }} · auth {{ operation.authRef || value.authRef || "none" }}</small></div>
        }
      </article>
    }
  `,
})
export class ServiceDetailComponent {
  readonly serviceId = input.required<string>();
  readonly service = signal<IServiceDetail | null>(null);
  private readonly project = inject(ProjectStore);
  private readonly client = inject(ServicesClient);

  constructor() {
    effect(() => { void this.load(this.serviceId()); });
  }

  async load(serviceId = this.serviceId()): Promise<void> {
    const root = this.project.projectRoot();
    if (root) this.service.set(await this.client.detail(root, serviceId));
  }
}