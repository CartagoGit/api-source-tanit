import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from "@angular/core";

import { I18nService } from "../core/i18n/i18n.service";
import { ProjectStore } from "../core/state/project.store";
import { ButtonComponent } from "../shared/button/button.component";
import { EmptyStateComponent } from "../shared/empty-state/empty-state.component";
import { SidebarComponent } from "./sidebar.component";
import { CommandPaletteComponent } from "./command-palette.component";

@Component({
  selector: "tanit-root",
  standalone: true,
  imports: [SidebarComponent, CommandPaletteComponent, ButtonComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell" [class.dark]="theme() === 'dark'">
      <tanit-sidebar (theme)="toggleTheme()" (select)="activeSection.set($event)" />
      <main class="content reveal">
        <header>
          <div><span class="eyebrow">{{ project.projectName() }}</span><h1>{{ i18n.translate('home.title') }}</h1></div>
          <tanit-button primary (click)="paletteOpen.set(true)">⌘K <span class="sr-only">{{ i18n.translate('palette.placeholder') }}</span></tanit-button>
        </header>
        @if (activeSection() === 'overview') {
          <tanit-empty-state><h2>{{ i18n.translate('home.title') }}</h2><p>{{ i18n.translate('home.empty') }}</p><tanit-button primary (click)="chooseProject()">{{ i18n.translate('home.open') }}</tanit-button></tanit-empty-state>
        } @else { <section class="section"><h2>{{ sectionLabel() }}</h2><p>{{ i18n.translate('home.empty') }}</p></section> }
      </main>
      <tanit-command-palette [open]="paletteOpen()" (close)="paletteOpen.set(false)" (chosen)="runCommand($event)" />
    </div>
  `,
  styles: `
    .shell { display: flex; min-height: 100vh; background: var(--color-surface); color: var(--color-ink); }
    .content { flex: 1; min-width: 0; padding: clamp(24px, 5vw, 64px); }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
    .eyebrow { color: var(--color-muted); font-size: 12px; }
    h1 { margin-top: var(--space-2); font-size: clamp(28px, 4vw, 48px); line-height: 1.05; }
    h2 { font-size: 20px; }
    .section { margin-top: 56px; display: grid; gap: var(--space-3); }
    .section p, .empty p { color: var(--color-muted); }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
    @media (max-width: 720px) { .shell { display: block; } .content { padding: var(--space-5); } }
  `,
})
export class AppComponent {
  readonly i18n = inject(I18nService);
  readonly project = inject(ProjectStore);
  readonly paletteOpen = signal(false);
  readonly activeSection = signal("overview");
  readonly theme = signal<"light" | "dark">(this.readTheme());

  constructor() { this.applyTheme(this.theme()); }

  toggleTheme(): void { const next = this.theme() === "light" ? "dark" : "light"; this.theme.set(next); this.storage()?.setItem("tanit.theme", next); this.applyTheme(next); }

  chooseProject(): void { this.project.open("example-project"); }

  runCommand(command: string): void { if (command === "theme") this.toggleTheme(); if (command === "open") this.chooseProject(); }

  sectionLabel(): string { return this.i18n.translate(`nav.${this.activeSection()}`); }

  @HostListener("document:keydown", ["$event"])
  onShortcut(event: KeyboardEvent): void { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); this.paletteOpen.set(!this.paletteOpen()); } }

  private readTheme(): "light" | "dark" { return this.storage()?.getItem("tanit.theme") === "dark" ? "dark" : "light"; }
  private applyTheme(theme: "light" | "dark"): void { if (typeof document !== "undefined") document.documentElement.dataset["theme"] = theme; }
  private storage(): Storage | undefined { return typeof localStorage === "undefined" ? undefined : localStorage; }
}
