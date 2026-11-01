import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from "@angular/core";
import { ServicesClient, type IServiceDetail } from "../../core/api/services.client";
import { ProjectStore } from "../../core/state/project.store";
import { I18nService } from "../../core/i18n/i18n.service";

/**
 * The detail of one service.
 *
 * It comes from **one** snapshot, in one read: the identity, the
 * framework, how many endpoints it has, which transports its
 * operations speak and how many operations the explorer shows.
 *
 * The component was not mounted anywhere: the section existed and
 * nothing drew it. It is now in the services list, and the failure
 * says what it is instead of being swallowed.
 */
@Component({
  selector: "tanit-service-detail",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./service-detail.component.html",
})
export class ServiceDetailComponent {
  readonly i18n = inject(I18nService);
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
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }
}