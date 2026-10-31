import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { CheckClient } from "../../core/api/check.client";
import { ProjectStore } from "../../core/state/project.store";
import type { ICheckReport } from "../../../../../contracts/interfaces/core/application-api.interface";

/**
 * The drift check.
 *
 * ## What it used to be
 *
 * A button that called an operation with no handler and told the
 * user, every time, that the action was CLI-only. The comparison
 * lived in the CLI and the app could not reach it.
 *
 * ## What it is
 *
 * The comparison moved to the core and the Application API exposes
 * it. The screen asks, and draws **the answer**: the routes the
 * collection is missing, and the requests the code does not declare.
 *
 * It used to carry its own `projectRoot` input, defaulting to `"."`
 * — and the shell never passed one, so the check would have been
 * asked for the current directory instead of the project the user
 * opened.
 */
@Component({
  selector: "tanit-check",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section aria-labelledby="check-title"><h2 id="check-title">Check</h2><button type="button" [disabled]="running()" (click)="run()">{{ running() ? "Checking…" : "Check project" }}</button>@if (message(); as value) { <p role="status">{{ value }}</p> }@if (report(); as answer) { <dl class="counts"><dt>Routes in code</dt><dd>{{ answer.routesInSource }}</dd><dt>Requests in collection</dt><dd>{{ answer.requestsInCollection }}</dd></dl>@if (answer.missingInCollection.length) { <h3>Missing from the collection</h3><ul>@for (route of answer.missingInCollection; track route.method + route.uri + (route.name ?? "")) { <li><code>{{ route.method }}</code> {{ route.uri }}@if (route.name) { <em>({{ route.name }})</em> }</li> }</ul> }@if (answer.missingInSource.length) { <h3>Not in the code</h3><ul>@for (route of answer.missingInSource; track route.method + route.uri + (route.name ?? "")) { <li><code>{{ route.method }}</code> {{ route.uri }}@if (route.name) { <em>({{ route.name }})</em> }</li> }</ul> } }</section>`,
  styles: `.counts { display: grid; grid-template-columns: auto 1fr; gap: var(--space-2) var(--space-4); margin-top: var(--space-4); } dt { color: var(--color-muted); } dd { margin: 0; font-variant-numeric: tabular-nums; } h3 { margin-top: var(--space-4); font-size: 14px; } code { font-family: var(--font-code); }`,
})
export class CheckComponent {
  readonly running = signal(false);
  readonly message = signal<string | null>(null);
  readonly report = signal<ICheckReport | null>(null);
  private readonly project = inject(ProjectStore);
  private readonly client = inject(CheckClient);

  async run(): Promise<void> {
    const root = this.project.projectRoot();
    if (root === null) {
      this.message.set("Open a project first.");
      return;
    }
    this.running.set(true);
    this.message.set(null);
    this.report.set(null);
    try {
      const report = await this.client.check(root);
      this.report.set(report);
      this.message.set(
        report.inSync
          ? "The collection is in sync with the code."
          : `Out of sync: ${report.missingInCollection.length} route(s) missing from the collection, ${report.missingInSource.length} request(s) not in the code.`,
      );
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.running.set(false);
    }
  }
}