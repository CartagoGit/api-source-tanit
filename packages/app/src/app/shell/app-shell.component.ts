import { DOCUMENT, Location } from "@angular/common";
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, DestroyRef, ErrorHandler, HostListener, inject, signal } from "@angular/core";

import { I18nService } from "../core/i18n/i18n.service";
import { ProjectStore } from "../core/state/project.store";
import { ThemeStore } from "../core/state/theme.store";
import { isProjectIndependentSection, SidebarComponent } from "./sidebar.component";
import { CommandPaletteComponent } from "./command-palette.component";
import { HomeComponent } from "../features/home/home.component";
import { EndpointsListComponent } from "../features/endpoints/endpoints-list.component";
import { ExportCenterComponent } from "../features/exports/export-center.component";
import { ClientUsageComponent } from "../features/client-usage/client-usage.component";
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
    ClientUsageComponent,
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
  readonly nativeMotion = signal(false);
  readonly visibleSection = computed(() => {
    const section = this.activeSection();
    return this.project.isOpen() || isProjectIndependentSection(section) ? section : "overview";
  });
  private readonly document = inject(DOCUMENT);
  private readonly changeDetector = inject(ChangeDetectorRef, { optional: true });
  private readonly errorHandler = inject(ErrorHandler);
  private transition?: ViewTransition;
  private requestedSection = "overview";
  private navigationRevision = 0;
  private fromApp = false;
  private focusPickerOnArrival = false;

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
    "client-usage": "nav.clientUsage",
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
    this.requestedSection = this.sectionOf(this.location.path());
    this.activeSection.set(this.requestedSection);
    // The notification can contain the external hash URL on desktop.
    const stop = this.location.onUrlChange(() => this.navigate(this.sectionOf(this.location.path()), this.fromApp));
    inject(DestroyRef).onDestroy(() => {
      stop();
      this.navigationRevision++;
      this.transition?.skipTransition();
    });
    void this.project.restore();
  }

  private sectionOf(path: string): string {
    const section = path.split(/[?#]/, 1)[0]?.replace(/^\//, "").replace(/\/$/, "") ?? "";
    return Object.hasOwn(this.sectionLabels, section) ? section : "overview";
  }

  private navigate(section: string, scrollToStart: boolean): void {
    if (section === this.requestedSection) return;
    this.requestedSection = section;
    const revision = ++this.navigationRevision;
    this.transition?.skipTransition();
    this.transition = undefined;

    const window = this.document.defaultView;
    const update = (): void => {
      if (revision !== this.navigationRevision) return;
      this.activeSection.set(section);
      this.changeDetector?.detectChanges();
      if (scrollToStart && window?.scrollY) window.scrollTo({ top: 0, behavior: "instant" });
      if (this.focusPickerOnArrival && section === "overview") this.focusPicker();
      this.focusPickerOnArrival = false;
    };

    if (section === this.activeSection() || typeof this.document.startViewTransition !== "function"
      || window?.matchMedia?.("(prefers-reduced-motion: no-preference)").matches !== true) {
      this.nativeMotion.set(false);
      update();
      return;
    }

    this.nativeMotion.set(true);
    const transition = this.document.startViewTransition(update);
    this.transition = transition;
    // A rapid navigation can skip the snapshots, while still invoking the queued update callback.
    void transition.ready.catch(() => {});
    void transition.finished.catch((error: unknown) => this.errorHandler.handleError(error)).finally(() => {
      if (revision !== this.navigationRevision) return;
      this.transition = undefined;
      this.nativeMotion.set(false);
    });
  }

  go(section: string): void {
    if (!Object.hasOwn(this.sectionLabels, section) || section === this.requestedSection) return;
    this.fromApp = true;
    try {
      this.location.go(section === "overview" ? "/" : `/${section}`);
    } finally {
      this.fromApp = false;
    }
  }

  projectOpened(): void {
    if (this.activeSection() === "overview") this.go("endpoints");
  }

  showProjectPicker(): void {
    if (this.requestedSection === "overview") {
      if (this.activeSection() === "overview") this.focusPicker();
      else this.focusPickerOnArrival = true;
      return;
    }
    this.focusPickerOnArrival = true;
    this.go("overview");
  }

  private focusPicker(): void {
    this.document.getElementById("project-path")?.focus();
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
