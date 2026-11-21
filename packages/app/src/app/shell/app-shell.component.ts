import { Location } from "@angular/common";
import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, inject, signal } from "@angular/core";

import { I18nService } from "../core/i18n/i18n.service";
import { ProjectStore } from "../core/state/project.store";
import { ThemeStore } from "../core/state/theme.store";
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
import { HelpComponent } from "../features/help/help.component";
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
    HelpComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./app-shell.component.html",
  styleUrls: ["./app-shell.component.scss"],
})
export class AppComponent {
  private readonly location = inject(Location);
  readonly i18n = inject(I18nService);
  readonly project = inject(ProjectStore);
  readonly paletteOpen = signal(false);
  readonly commandShortcut = "Ctrl+K";
  readonly activeSection = signal("overview");

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
    help: "nav.help",
  };

  constructor() {
    inject(ThemeStore);
    this.readSection(this.location.path());
    inject(DestroyRef).onDestroy(this.location.onUrlChange(() => this.readSection(this.location.path())));
    void this.project.restore();
  }

  private readSection(path: string): void {
    const section = path.split(/[?#]/, 1)[0]?.replace(/^\//, "").replace(/\/$/, "") ?? "";
    this.activeSection.set(Object.hasOwn(this.sectionLabels, section) ? section : "overview");
  }

  /** Goes to a section. */
  go(section: string): void {
    if (!Object.hasOwn(this.sectionLabels, section) || section === this.activeSection()) return;
    this.location.go(section === "overview" ? "/" : `/${section}`);
  }

  projectOpened(): void {
    if (this.activeSection() === "overview") this.go("endpoints");
  }

  showProjectPicker(): void {
    this.go("overview");
    if (typeof document !== "undefined" && typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => document.getElementById("project-path")?.focus());
    }
  }

  runCommand(command: string): void {
    if (command === "open" || command === "recent") this.showProjectPicker();
    if (command === "settings") this.go("settings");
    if (command === "search" || command === "export") {
      if (!this.project.isOpen()) this.showProjectPicker();
      else this.go(command === "search" ? "endpoints" : "exports");
    }
    // "Rescan" used to just go back to the overview. It now asks
    // the backend what the project looks like **now** — the session
    // watches the files, and its snapshot may be older than the
    // project on disk. The command had a name and no behaviour.
    if (command === "rescan") { void this.rescan(); return; }
    if (command === "help") this.go("help");
  }

  /**
   * Re-reads the project and refreshes what depends on it.
   *
   * The scan happens in the backend; the app asks for the summary
   * and then asks again for what the screens draw.
   */
  async rescan(): Promise<void> {
    if (!this.project.isOpen()) {
      this.showProjectPicker();
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
}
