import { ChangeDetectionStrategy, Component } from "@angular/core";

@Component({
  selector: "tanit-badge",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span><ng-content /></span>`,
  styles: `
    span { display: inline-flex; border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-muted); padding: 2px 6px; font-size: 12px; }
  `,
})
export class BadgeComponent {}
