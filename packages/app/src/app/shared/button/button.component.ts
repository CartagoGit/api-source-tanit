import { ChangeDetectionStrategy, Component, input } from "@angular/core";

@Component({
  selector: "tanit-button",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button [attr.type]="type()" [class.primary]="primary()"><ng-content /></button>`,
  styles: `
    button { border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-panel); color: var(--color-ink); padding: var(--space-2) var(--space-3); }
    button.primary { border-color: var(--color-copper); background: var(--color-copper); color: #fff; }
    button:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
  `,
})
export class ButtonComponent {
  readonly primary = input(false);
  readonly type = input<"button" | "submit">("button");
}
