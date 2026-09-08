import { ChangeDetectionStrategy, Component } from "@angular/core";

@Component({
  selector: "tanit-empty-state",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="empty"><div class="mark">+</div><ng-content /></section>`,
  styles: `
    .empty { display: grid; justify-items: start; gap: var(--space-3); max-width: 520px; padding: var(--space-6) 0; }
    .mark { display: grid; place-items: center; width: 40px; height: 40px; border: 1px solid var(--color-copper); border-radius: 50%; color: var(--color-copper); font-size: 24px; }
  `,
})
export class EmptyStateComponent {}
