import { ChangeDetectionStrategy, Component, inject, input, output } from "@angular/core";

import { I18nService } from "../core/i18n/i18n.service";

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
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./sidebar.component.html",
  styleUrls: ["./sidebar.component.scss"],
})
export class SidebarComponent {
  readonly select = output<string>();
  readonly theme = output<void>();
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
      items: [{ id: "settings", labelKey: "nav.settings" }],
    },
  ];

  readonly activeId = input("overview");
  themeLabel = this.i18n.translate("theme.toggle");

  /** The id of the heading that labels a group. */
  groupId(group: NavigationGroup): string {
    return `nav-group-${group.id}`;
  }

  iconFor(id: string): string {
    return ({ overview: "O", endpoints: "E", services: "V", exports: "X", stats: "N", check: "C", validate: "A", sync: "Y", push: "P", live: "L", history: "H", diagnostics: "D", settings: "G" } as Record<string, string>)[id] ?? "-";
  }
}
