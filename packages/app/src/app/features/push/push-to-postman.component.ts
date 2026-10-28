import { ChangeDetectionStrategy, Component, inject, input, signal } from "@angular/core";
import { PushClient } from "../../core/api/push.client";

@Component({
  selector: "tanit-push-to-postman",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section aria-labelledby="push-title"><h2 id="push-title">Push to Postman</h2><label>Workspace <input [value]="workspace()" (input)="workspace.set(inputValue($event))" /></label><label><input type="checkbox" [checked]="dryRun()" (change)="dryRun.set(checked($event))" /> Dry run</label><button type="button" [disabled]="running()" (click)="run()">{{ running() ? "Pushing…" : "Push" }}</button><button type="button" [disabled]="!running()" (click)="cancel()">Cancel</button>@if (message(); as value) { <p role="status">{{ value }}</p> }</section>`,
})
export class PushToPostmanComponent {
  readonly projectRoot = input(".");
  readonly workspace = signal("");
  readonly dryRun = signal(true);
  readonly running = signal(false);
  readonly message = signal<string | null>(null);
  private readonly client = inject(PushClient);
  private controller: AbortController | null = null;

  async run(): Promise<void> {
    this.controller = new AbortController();
    this.running.set(true);
    try {
      const result = await this.client.push({ projectRoot: this.projectRoot(), workspace: this.workspace(), dryRun: this.dryRun() }, this.controller.signal);
      this.message.set(result.pushed ? "Push completed." : "Push did not complete.");
    } catch (error) {
      this.message.set(error instanceof DOMException && error.name === "AbortError" ? "Push cancelled." : "Push failed without exposing credentials.");
    } finally {
      this.running.set(false);
      this.controller = null;
    }
  }

  cancel(): void { this.controller?.abort(); }
  inputValue(event: Event): string { return (event.target as HTMLInputElement).value; }
  checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
}