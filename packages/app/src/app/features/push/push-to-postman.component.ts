import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { PushClient } from "../../core/api/push.client";
import { SecureStorageService } from "../../core/host/secure-storage.service";
import { ProjectStore } from "../../core/state/project.store";
import type { PushOutput } from "../../../../../contracts/interfaces/core/application-api.interface";
import { I18nService } from "../../core/i18n/i18n.service";

/**
 * The upload to Postman.
 *
 * ## What it used to be
 *
 * A button that called an operation with no handler and told the
 * user, every time, that the action was CLI-only. The upload lived
 * in the CLI and the app could not reach it — however good the key
 * it had saved was.
 *
 * ## What it is
 *
 * The upload moved to the core and the Application API exposes it.
 * The key comes from the app's own secure storage; it does not come
 * back, and the screen says what happened.
 *
 * It used to carry its own `projectRoot` input, defaulting to `"."`
 * — and the shell never passed one, so the upload would have been
 * asked for the current directory instead of the open project.
 */
@Component({
  selector: "tanit-push-to-postman",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./push-to-postman.component.html",
  styleUrls: ["./push-to-postman.component.scss"],
})
export class PushToPostmanComponent {
  readonly i18n = inject(I18nService);
  readonly workspace = signal("");
  readonly dryRun = signal(true);
  readonly running = signal(false);
  readonly message = signal<string | null>(null);
  readonly result = signal<PushOutput | null>(null);
  private readonly project = inject(ProjectStore);
  private readonly client = inject(PushClient);
  private readonly storage = inject(SecureStorageService);
  private controller: AbortController | null = null;

  async run(): Promise<void> {
    const root = this.project.projectRoot();
    if (root === null) {
      this.message.set(this.i18n.translate("common.openProjectFirst"));
      return;
    }
    this.controller = new AbortController();
    this.running.set(true);
    this.message.set(null);
    this.result.set(null);
    try {
      const apiKey = await this.storage.retrieve("postman-api-key");
      const result = await this.client.push(
        {
          projectRoot: root,
          ...(apiKey !== null && apiKey !== "" ? { apiKey } : {}),
          ...(this.workspace() !== "" ? { workspace: this.workspace() } : {}),
          dryRun: this.dryRun(),
        },
        this.controller.signal,
      );
      this.result.set(result);
      this.message.set(
        result.error !== null
          ? result.error.reason
          : result.dryRun
            ? `Dry run: ${result.requests} request(s) would go up.`
            : `Collection ${result.collection?.action ?? "uploaded"}.`,
      );
    } catch (error) {
      this.message.set(
        error instanceof DOMException && error.name === "AbortError"
          ? this.i18n.translate("push.cancelled")
          : error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.running.set(false);
      this.controller = null;
    }
  }

  cancel(): void { this.controller?.abort(); }
  inputValue(event: Event): string { return (event.target as HTMLInputElement).value; }
  checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
}