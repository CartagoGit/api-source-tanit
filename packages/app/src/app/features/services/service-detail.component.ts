import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from "@angular/core";
import { ServicesClient, type IServiceDetail } from "../../core/api/services.client";
import { describePending } from "../../core/api/pending-operation.helper";
import { ProjectStore } from "../../core/state/project.store";

/**
 * The detail of one service.
 *
 * The API lists the services but does not expose the detail of one —
 * its base URL, its auth reference, its operations. The core has the
 * data, so the call is declared **pending**: it fails visibly, and the
 * gap is written down instead of turning into an `UNKNOWN_HANDLER` at
 * runtime.
 *
 * The component was not mounted anywhere: the section existed and
 * nothing drew it. It is now in the services list, and the failure
 * says what it is instead of being swallowed.
 */
@Component({
  selector: "tanit-service-detail",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error(); as message) { <p role="alert">{{ message }}</p> }
    @if (service(); as value) {
      <article><header><h2>{{ value.serviceId }}</h2><span>{{ value.framework }}</span></header>
        <p>{{ value.operationCount }} operations @if (value.transports?.length) { · {{ value.transports.join(", ") }} }</p>
      </article>
    }
  `,
})
export class ServiceDetailComponent {
  /**
   * The service to show.
   *
   * It has a default instead of being required: a required signal
   * input throws when it is read before it is set, and the effect
   * below reads it. A component that crashes the app because nobody
   * remembered a binding is worse than one that shows nothing.
   */
  readonly serviceId = input<string>("");
  readonly service = signal<IServiceDetail | null>(null);
  readonly error = signal<string | null>(null);
  private readonly project = inject(ProjectStore);
  private readonly client = inject(ServicesClient);

  constructor() {
    effect(() => {
      const serviceId = this.serviceId();
      if (serviceId !== "") void this.load(serviceId);
    });
  }

  async load(serviceId = this.serviceId()): Promise<void> {
    const root = this.project.projectRoot();
    if (root === null) return;
    try {
      this.service.set(await this.client.detail(root, serviceId));
      this.error.set(null);
    } catch (error) {
      this.service.set(null);
      this.error.set(describePending("service-detail", error));
    }
  }
}