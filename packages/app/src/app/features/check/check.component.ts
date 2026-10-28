import { ChangeDetectionStrategy, Component, inject, input, signal } from "@angular/core";
import { CheckClient } from "../../core/api/check.client";

@Component({
  selector: "tanit-check",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section aria-labelledby="check-title"><h2 id="check-title">Check</h2><button type="button" [disabled]="running()" (click)="run()">{{ running() ? "Checking…" : "Check project" }}</button>@if (message(); as value) { <p role="status">{{ value }}</p> }</section>`,
})
export class CheckComponent {
  readonly projectRoot = input(".");
  readonly running = signal(false);
  readonly message = signal<string | null>(null);
  private readonly client = inject(CheckClient);

  async run(): Promise<void> {
    this.running.set(true);
    try {
      const result = await this.client.check(this.projectRoot());
      this.message.set(result.passed ? "Project is in sync." : result.issues.join("; "));
    } finally {
      this.running.set(false);
    }
  }
}