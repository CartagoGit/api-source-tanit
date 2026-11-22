import { ChangeDetectionStrategy, Component, inject, input, output, signal } from "@angular/core";

import { appMetadata } from "../core/app-metadata";
import { ExternalLinkService } from "../core/host/external-link.service";
import { GitHubMarkComponent } from "../shared/github-mark.component";
import { I18nService } from "../core/i18n/i18n.service";

const PROJECT_INDEPENDENT_SECTIONS = new Set(["overview", "settings", "help", "client-usage"]);

export function isProjectIndependentSection(section: string): boolean {
  return PROJECT_INDEPENDENT_SECTIONS.has(section);
}

/** One destination in the sidebar. */
interface NavigationItem {
  readonly id: string;
  readonly labelKey: string;
}

/**
 * A group of destinations.
 *
 * ## Why the sidebar is grouped
 *
 * It used to be a flat list of fourteen entries, and the list grew
 * every time the app learned to do something new — which is the
 * wrong way round. A navigation should tell the user **what the app
 * is for**, not enumerate its features; a flat list of fourteen does
 * neither, and it grew to fourteen because the app learned to
 * generate, check, validate, count, push and watch.
 *
 * The groups answer that:
 *
 *   · **inspect** — what is in the project;
 *   · **produce** — what to do with it;
 *   · **observe** — what is happening to it.
 *
 * And `schemas` is gone. It was an entry that led nowhere: the shell
 * had no case for it, so it fell through to the empty state — a
 * navigation entry that opened a blank page. The schema of an
 * endpoint is not a section; it is part of the endpoint's detail,
 * and that is where it lives.
 */
interface NavigationGroup {
  readonly id: string;
  readonly labelKey: string;
  readonly items: ReadonlyArray<NavigationItem>;
}

@Component({
  selector: "tanit-sidebar",
  standalone: true,
  imports: [GitHubMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./sidebar.component.html",
  styleUrls: ["./sidebar.component.scss"],
})
export class SidebarComponent {
  readonly metadata = appMetadata();
  readonly linkFailed = signal(false);
  private readonly externalLinks = inject(ExternalLinkService);
  readonly select = output<string>();
  readonly i18n = inject(I18nService);

  /**
   * The groups, in the order they are read.
   *
   * The order is the order of a working session: look at what the
   * project has, do something with it, then watch what happens.
   */
  readonly groups: ReadonlyArray<NavigationGroup> = [
    {
      id: "inspect",
      labelKey: "nav.group.inspect",
      items: [
        { id: "overview", labelKey: "nav.overview" },
        { id: "endpoints", labelKey: "nav.endpoints" },
        { id: "client-usage", labelKey: "nav.clientUsage" },
        { id: "services", labelKey: "nav.services" },
      ],
    },
    {
      id: "produce",
      labelKey: "nav.group.produce",
      items: [
        { id: "exports", labelKey: "nav.exports" },
        { id: "stats", labelKey: "nav.stats" },
        { id: "check", labelKey: "nav.check" },
        { id: "validate", labelKey: "nav.validate" },
        { id: "sync", labelKey: "nav.sync" },
        { id: "push", labelKey: "nav.push" },
      ],
    },
    {
      id: "observe",
      labelKey: "nav.group.observe",
      items: [
        { id: "live", labelKey: "nav.live" },
        { id: "history", labelKey: "nav.history" },
        { id: "diagnostics", labelKey: "nav.diagnostics" },
      ],
    },
    {
      id: "preferences",
      labelKey: "nav.group.preferences",
      items: [
        { id: "settings", labelKey: "nav.settings" },
        { id: "help", labelKey: "nav.help" },
      ],
    },
  ];

  readonly activeId = input("overview");
  readonly projectOpen = input(false);
  readonly menuOpen = signal(false);

  async openRepository(event: MouseEvent): Promise<void> {
    this.linkFailed.set(false);
    this.linkFailed.set(!(await this.externalLinks.open(event, this.metadata.repository)));
  }

  choose(section: string, menuButton?: HTMLButtonElement): void {
    this.closeMenu(menuButton);
    this.select.emit(section);
  }

  closeMenu(menuButton?: HTMLButtonElement): void {
    if (!this.menuOpen()) return;
    menuButton?.focus({ preventScroll: true });
    this.menuOpen.set(false);
  }

  /** The id of the heading that labels a group. */
  groupId(group: NavigationGroup): string {
    return `nav-group-${group.id}`;
  }

  visibleItems(group: NavigationGroup): ReadonlyArray<NavigationItem> {
    return this.projectOpen()
      ? group.items
      : group.items.filter(({ id }) => isProjectIndependentSection(id));
  }
}
