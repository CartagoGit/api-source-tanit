import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from "@angular/core";

import { I18nService } from "../core/i18n/i18n.service";
import { ProjectStore } from "../core/state/project.store";
import { ButtonComponent } from "../shared/button/button.component";
import { EmptyStateComponent } from "../shared/empty-state/empty-state.component";
import { SidebarComponent } from "./sidebar.component";
import { CommandPaletteComponent } from "./command-palette.component";
import { HomeComponent } from "../features/home/home.component";
import { EndpointsListComponent } from "../features/endpoints/endpoints-list.component";
import { ExportCenterComponent } from "../features/exports/export-center.component";
import { ServicesListComponent } from "../features/services/services-list.component";
import { HistoryListComponent } from "../features/history/history-list.component";
import { SettingsComponent } from "../features/settings/settings.component";
import { LiveToggleComponent } from "../features/live/live-toggle.component";
import { CheckComponent } from "../features/check/check.component";
import { SyncComponent } from "../features/sync/sync.component";
import { ValidateComponent } from "../features/validate/validate.component";
import { PushToPostmanComponent } from "../features/push/push-to-postman.component";

/**
 * The shell: the frame the app lives in.
 *
 * ## What it used to be
 *
 * A frame with nothing in it. Every section but the overview drew
 * the same two lines — a heading and "Open a project to inspect its
 * API surface." — and the eleven feature components the repository
 * carried were **never mounted**. The app was a screenshot of an
 * app.
 *
 * Worse, "open a project" did not open anything: it set the
 * project's *name* and left it there. So the shell had two
 * placeholder screens and no content behind either.
 *
 * ## What it is now
 *
 * The real sections, mounted, wired to the stores, and — the part
 * that matters — **guarded by the session**: the sections that read
 * a project only render when there is one, and they say so when
 * there is not.
 */
@Component({
  selector: "tanit-root",
  standalone: true,
  imports: [
    SidebarComponent,
    CommandPaletteComponent,
    ButtonComponent,
    EmptyStateComponent,
    HomeComponent,
    EndpointsListComponent,
    ExportCenterComponent,
    ServicesListComponent,
    HistoryListComponent,
    SettingsComponent,
    LiveToggleComponent,
    CheckComponent,
    SyncComponent,
    ValidateComponent,
    PushToPostmanComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell" [class.dark]="theme() === 'dark'">
      <tanit-sidebar [activeId]="activeSection()" (theme)="toggleTheme()" (select)="go($event)" />
      <main class="content reveal">
        <header>
          <div>
            <span class="eyebrow">{{ project.projectName() }}</span>
            <h1>{{ i18n.translate('home.title') }}</h1>
          </div>
          <tanit-button primary (click)="paletteOpen.set(true)">⌘K <span class="sr-only">{{ i18n.translate('palette.placeholder') }}</span></tanit-button>
        </header>
        @if (project.error(); as message) { <p class="error" role="alert">{{ message }}</p> }
        @switch (activeSection()) {
          @case ('overview') { <tanit-home /> }
          @case ('endpoints') { @if (project.isOpen()) { <tanit-endpoints-list /> } @else { <tanit-empty-state><h2>{{ i18n.translate('home.title') }}</h2><p>{{ i18n.translate('home.empty') }}</p><tanit-button primary (click)="go('overview')">{{ i18n.translate('home.open') }}</tanit-button></tanit-empty-state> } }
          @case ('exports') { @if (project.isOpen()) { <tanit-export-center /> } @else { <tanit-empty-state><h2>Export Center</h2><p>{{ i18n.translate('home.empty') }}</p></tanit-empty-state> } }
          @case ('services') { @if (project.isOpen()) { <tanit-services-list /> } @else { <tanit-empty-state><h2>Services</h2><p>{{ i18n.translate('home.empty') }}</p></tanit-empty-state> } }
          @case ('history') { @if (project.isOpen()) { <tanit-history-list /> } @else { <tanit-empty-state><h2>History</h2><p>{{ i18n.translate('home.empty') }}</p></tanit-empty-state> } }
          @case ('live') { <tanit-live-toggle /> }
          @case ('check') { <tanit-check /> }
          @case ('sync') { <tanit-sync /> }
          @case ('validate') { <tanit-validate /> }
          @case ('push') { <tanit-push-to-postman /> }
          @case ('settings') { <tanit-settings /> }
          @default { <tanit-empty-state><h2>{{ sectionLabel() }}</h2><p>{{ i18n.translate('home.empty') }}</p></tanit-empty-state> }
        }
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
    .error { margin: var(--space-4) 0 0; padding: 10px 12px; border: 1px solid var(--color-copper); background: color-mix(in srgb, var(--color-copper) 10%, transparent); }
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

  /** Goes to a section. */
  go(section: string): void { this.activeSection.set(section); }

  runCommand(command: string): void {
    if (command === "theme") this.toggleTheme();
    if (command === "open" || command === "recent") this.go("overview");
    if (command === "settings") this.go("settings");
    if (command === "search") this.go("endpoints");
    if (command === "export") this.go("exports");
    if (command === "rescan") this.go("overview");
    if (command === "help") this.go("diagnostics");
  }

  sectionLabel(): string { return this.i18n.translate(`nav.${this.activeSection()}`); }

  @HostListener("document:keydown", ["$event"])
  onShortcut(event: KeyboardEvent): void { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); this.paletteOpen.set(!this.paletteOpen()); } }

  private readTheme(): "light" | "dark" { return this.storage()?.getItem("tanit.theme") === "dark" ? "dark" : "light"; }
  private applyTheme(theme: "light" | "dark"): void { if (typeof document !== "undefined") document.documentElement.dataset["theme"] = theme; }
  private storage(): Storage | undefined { return typeof localStorage === "undefined" ? undefined : localStorage; }
}
