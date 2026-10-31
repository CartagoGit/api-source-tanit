import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { PushClient } from "../../core/api/push.client";
import { describePending } from "../../core/api/pending-operation.helper";
import { ProjectStore } from "../../core/state/project.store";

/**
 * The upload to Postman.
 *
 * The upload lives in the core and the CLI uses it, but there is no
 * handler behind it, so the app asks for it as a pending operation
 * and says so when it comes back.
 *
 * It used to carry its own `projectRoot` input, defaulting to `"."`
 * — and the shell never passed one, so the upload would have been
 * asked for the current directory instead of the open project.
 */
@Component({
  selector: "tanit-push-to-postman",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section aria-labelledby="push-title"><h2 id="push-title">Push to Postman</h2><label>Workspace <input [value]="workspace()" (input)="workspace.set(inputValue($event))" /></label><label><input type="checkbox" [checked]="dryRun()" (change)="dryRun.set(checked($event))" /> Dry run</label><button type="button" [disabled]="running()" (click)="run()">{{ running() ? "Pushing…" : "Push" }}</button><button type="button" [disabled]="!running()" (click)="cancel()">Cancel</button>@if (message(); as value) { <p role="status">{{ value }}</p> }</section>`,
})
export class PushToPostmanComponent {
  readonly workspace = signal("");
  readonly dryRun = signal(true);
  readonly running = signal(false);
  readonly message = signal<string | null>(null);
  private readonly project = inject(ProjectStore);
  private readonly client = inject(PushClient);
  private controller: AbortController | null = null;

  async run(): Promise<void> {
    const root = this.project.projectRoot();
    if (root === null) {
      this.message.set("Open a project first.");
      return;
    }
    this.controller = new AbortController();
    this.running.set(true);
    this.message.set(null);
    try {
      const result = await this.client.push({ projectRoot: root, workspace: this.workspace(), dryRun: this.dryRun() }, this.controller.signal) as { pushed?: boolean };
      this.message.set(result.pushed ? "Push completed." : "Push did not complete.");
    } catch (error) {
      this.message.set(
        error instanceof DOMException && error.name === "AbortError"
          ? "Push cancelled."
          : describePending("push", error),
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