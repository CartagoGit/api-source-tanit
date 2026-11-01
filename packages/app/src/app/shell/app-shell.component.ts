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
import { StatsComponent } from "../features/stats/stats.component";
import { DiagnosticsComponent } from "../features/diagnostics/diagnostics.component";

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
    StatsComponent,
    DiagnosticsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./app-shell.component.html",
  styleUrls: ["./app-shell.component.scss"],
})
export class AppComponent {
  readonly i18n = inject(I18nService);
  readonly project = inject(ProjectStore);
  readonly paletteOpen = signal(false);
  readonly activeSection = signal("overview");
  readonly theme = signal<"light" | "dark">(this.readTheme());

  /**
   * The label of each section, by section id.
   *
   * It used to be built in runtime — `nav.${this.activeSection()}` —
   * which is a key nobody can check: if a section had no key, the
   * screen said `nav.undefined` and nobody would know why. A key
   * written here can be compared against the catalog by the gate.
   */
  readonly sectionLabels: Readonly<Record<string, string>> = {
    overview: "nav.overview",
    endpoints: "nav.endpoints",
    services: "nav.services",
    exports: "nav.exports",
    stats: "nav.stats",
    check: "nav.check",
    validate: "nav.validate",
    sync: "nav.sync",
    push: "nav.push",
    live: "nav.live",
    history: "nav.history",
    diagnostics: "nav.diagnostics",
    settings: "nav.settings",
  };

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
    // "Rescan" used to just go back to the overview. It now asks
    // the backend what the project looks like **now** — the session
    // watches the files, and its snapshot may be older than the
    // project on disk. The command had a name and no behaviour.
    if (command === "rescan") { void this.rescan(); return; }
    if (command === "help") this.go("diagnostics");
  }

  /**
   * Re-reads the project and refreshes what depends on it.
   *
   * The scan happens in the backend; the app asks for the summary
   * and then asks again for what the screens draw.
   */
  async rescan(): Promise<void> {
    if (!this.project.isOpen()) {
      this.go("overview");
      return;
    }
    await this.project.refresh();
    this.go("overview");
  }

  sectionLabel(): string {
    return this.i18n.translate(this.sectionLabels[this.activeSection()] ?? "nav.overview");
  }

  @HostListener("document:keydown", ["$event"])
  onShortcut(event: KeyboardEvent): void { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); this.paletteOpen.set(!this.paletteOpen()); } }

  private readTheme(): "light" | "dark" { return this.storage()?.getItem("tanit.theme") === "dark" ? "dark" : "light"; }
  private applyTheme(theme: "light" | "dark"): void { if (typeof document !== "undefined") document.documentElement.dataset["theme"] = theme; }
  private storage(): Storage | undefined { return typeof localStorage === "undefined" ? undefined : localStorage; }
}
