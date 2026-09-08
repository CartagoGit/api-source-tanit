import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";

import { I18nService } from "../core/i18n/i18n.service";

interface NavigationItem {
  readonly id: string;
  readonly labelKey: string;
}

@Component({
  selector: "tanit-sidebar",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="sidebar" aria-label="Primary navigation">
      <div class="brand">
        <span class="brand-mark">T</span>
        <div><strong>{{ i18n.translate("app.name") }}</strong><small>{{ i18n.translate("app.subtitle") }}</small></div>
      </div>
      <nav>
        @for (item of items; track item.id) {
          <button type="button" [class.active]="activeId() === item.id" (click)="select.emit(item.id)">
            <span aria-hidden="true">{{ iconFor(item.id) }}</span>
            {{ i18n.translate(item.labelKey) }}
          </button>
        }
      </nav>
      <button class="theme" type="button" (click)="theme.emit()" [attr.aria-label]="i18n.translate('theme.toggle')">
        <span aria-hidden="true">◐</span>{{ themeLabel }}
      </button>
    </aside>
  `,
  styles: `
    .sidebar { display: flex; flex-direction: column; gap: var(--space-5); width: 236px; min-height: 100vh; padding: var(--space-5); border-right: 1px solid var(--color-border); background: var(--color-panel); }
    .brand { display: flex; align-items: center; gap: var(--space-3); }
    .brand-mark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius-md); background: var(--color-copper); color: #fff; font-weight: 700; }
    strong, small { display: block; }
    small { color: var(--color-muted); font-size: 11px; }
    nav { display: grid; gap: var(--space-1); }
    nav button, .theme { display: flex; align-items: center; gap: var(--space-2); width: 100%; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-muted); padding: var(--space-2) var(--space-3); text-align: left; }
    nav button:hover, nav button.active, .theme:hover { background: color-mix(in srgb, var(--color-copper) 12%, transparent); color: var(--color-ink); }
    nav button:focus-visible, .theme:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
    .theme { margin-top: auto; }
    @media (max-width: 720px) { .sidebar { width: 100%; min-height: auto; border-right: 0; border-bottom: 1px solid var(--color-border); } nav { grid-template-columns: repeat(2, 1fr); } }
  `,
})
export class SidebarComponent {
  readonly select = output<string>();
  readonly theme = output<void>();
  readonly i18n = new I18nService();
  readonly items: ReadonlyArray<NavigationItem> = [
    { id: "overview", labelKey: "nav.overview" },
    { id: "endpoints", labelKey: "nav.endpoints" },
    { id: "schemas", labelKey: "nav.schemas" },
    { id: "services", labelKey: "nav.services" },
    { id: "exports", labelKey: "nav.exports" },
    { id: "history", labelKey: "nav.history" },
    { id: "diagnostics", labelKey: "nav.diagnostics" },
    { id: "settings", labelKey: "nav.settings" },
  ];
  readonly activeId = input("overview");
  themeLabel = this.i18n.translate("theme.toggle");

  iconFor(id: string): string {
    return ({ overview: "○", endpoints: "↗", schemas: "◇", services: "□", exports: "↓", history: "↺", diagnostics: "!", settings: "⚙" } as Record<string, string>)[id] ?? "·";
  }
}
