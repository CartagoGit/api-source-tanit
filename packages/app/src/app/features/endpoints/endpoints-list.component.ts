import { ChangeDetectionStrategy, Component, TemplateRef, ViewChild, effect, inject } from "@angular/core";

import {
  ENDPOINT_CONFIDENCES,
  EndpointConfidence,
  EndpointQuery,
} from "../../core/api/endpoints.client";
import { EndpointsStore } from "../../core/state/endpoints.store";
import { ProjectStore } from "../../core/state/project.store";
import { VirtualScrollerComponent } from "../../shared/virtual-scroll/virtual-scroller.component";
import { EndpointDetailComponent } from "./endpoint-detail.component";
import { FiltersComponent } from "./filters.component";
import { I18nService } from "../../core/i18n/i18n.service";

/**
 * The endpoint explorer.
 *
 * ## The list comes from the backend
 *
 * It used to be a list of five thousand invented endpoints, filtered
 * in the client. Now the filter goes to the backend and the answer
 * comes back: the visible count and the indexed count are both the
 * project's, not a page's.
 *
 * ## The detail is fetched when an endpoint is chosen
 *
 * The row carries what the summary knows. The parameters, the
 * responses and the schema need another round trip, and only for the
 * endpoint the user is actually looking at.
 */
@Component({
  selector: "tanit-endpoints-list",
  standalone: true,
  imports: [VirtualScrollerComponent, FiltersComponent, EndpointDetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./endpoints-list.component.html",
  styleUrls: ["./endpoints-list.component.scss"],
})
export class EndpointsListComponent {
  readonly i18n = inject(I18nService);
  readonly store = inject(EndpointsStore);
  private readonly project = inject(ProjectStore);
  @ViewChild("endpointTemplate", { static: true }) readonly endpointTemplate!: TemplateRef<unknown>;
  readonly trackBy = (item: { id: string }): string => item.id;

  constructor() {
    // The project: when it opens, the list has to be asked for. The
    // explorer used to stay empty until the user touched a filter,
    // because nothing ever asked.
    effect(() => {
      if (this.project.projectRoot() !== null) void this.store.refresh();
    });
    effect(() => {
      const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
      const query = this.queryFromUrl(params);
      if (JSON.stringify(query) !== JSON.stringify(this.store.query())) {
        this.store.setQuery(query);
        void this.store.refresh();
      }
      const endpoint = params.get("endpoint");
      if (endpoint && endpoint !== this.store.selectedId()) this.store.select(endpoint);
    });
  }

  /** Sends the filter to the backend and draws what comes back. */
  apply(query: EndpointQuery): void {
    this.store.setQuery(query);
    this.updateUrl(query);
    void this.store.refresh();
  }

  /** Selects an endpoint and fetches its detail. */
  select(item: { id: string; method: string; path: string }): void {
    this.store.select(item.id);
    this.updateUrl({ ...this.store.query(), endpoint: item.id } as EndpointQuery & { endpoint: string });
    void this.store.loadDetail(item);
  }

  clearSelection(): void { this.store.select(null); this.updateUrl(this.store.query()); }
  filterTransport(value: string): void { this.apply({ ...this.store.query(), transport: value as EndpointQuery["transport"] }); }
  refresh(): void { void this.store.refresh(); }
  openLocation(location: { file: string; line: number }): void { if (typeof window !== "undefined") window.open(`tanit://open?file=${encodeURIComponent(location.file)}&line=${location.line}`, "_blank"); }

  private updateUrl(query: EndpointQuery & { endpoint?: string }): void { if (typeof history === "undefined") return; const params = new URLSearchParams(); for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value)); history.replaceState(null, "", `${location.pathname}?${params.toString()}`); }

  private queryFromUrl(params: URLSearchParams): EndpointQuery {
    const transport = params.get("transport");
    const confidence = params.get("confidence");
    return {
      service: params.get("service") ?? undefined,
      framework: params.get("framework") ?? undefined,
      transport: transport ?? undefined,
      method: params.get("method") ?? undefined,
      auth: params.get("auth") ?? undefined,
      validation: params.get("validation") ?? undefined,
      responses: params.get("responses") ?? undefined,
      confidence: isConfidence(confidence) ? confidence : undefined,
      sourceFile: params.get("sourceFile") ?? undefined,
      search: params.get("search") ?? undefined,
    };
  }
}

/** Whether the URL carries a confidence the app knows. */
function isConfidence(value: string | null): value is EndpointConfidence {
  return value !== null && (ENDPOINT_CONFIDENCES as readonly string[]).includes(value);
}
