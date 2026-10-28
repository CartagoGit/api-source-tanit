import { PercentPipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, TemplateRef, ViewChild, effect, inject } from "@angular/core";

import { EndpointQuery } from "../../core/api/endpoints.client";
import { EndpointsStore } from "../../core/state/endpoints.store";
import { VirtualScrollerComponent } from "../../shared/virtual-scroll/virtual-scroller.component";
import { EndpointDetailComponent } from "./endpoint-detail.component";
import { FiltersComponent } from "./filters.component";

@Component({
  selector: "tanit-endpoints-list",
  standalone: true,
  imports: [PercentPipe, VirtualScrollerComponent, FiltersComponent, EndpointDetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="explorer">
      <header class="heading"><div><span class="eyebrow">Endpoints Explorer</span><h1>Operations</h1><p>{{ store.filtered().length }} visible · {{ store.all().length }} indexed</p></div><button type="button" (click)="clearSelection()">Reset selection</button></header>
      <tanit-endpoint-filters [value]="store.query()" (changed)="apply($event)" />
      <div class="workspace">
        <div class="list-pane">
          <tanit-virtual-scroller [items]="store.filtered()" [itemHeight]="72" [height]="560" [itemTemplate]="endpointTemplate" [trackBy]="trackBy" />
          <ng-template #endpointTemplate let-item let-index="index"><button class="endpoint-row" type="button" [class.selected]="item.id === store.selectedId()" (click)="select(item.id)" [attr.aria-label]="item.method + ' ' + item.path"><span class="index">{{ index + 1 }}</span><span class="verb">{{ item.method }}</span><span class="path"><strong>{{ item.path }}</strong><small>{{ item.service }} · {{ item.transport }} · {{ item.description }}</small></span><span class="confidence">{{ item.evidence[0]?.confidence | percent }}</span></button></ng-template>
        </div>
        <tanit-endpoint-detail [endpoint]="store.selected()" (closed)="clearSelection()" (filter)="filterDiagnostic($event)" (transportFilter)="filterTransport($event)" (open)="openLocation($event)" />
      </div>
    </section>
  `,
  styles: `
    :host { display: block; min-height: 100%; } .explorer { display: grid; gap: 18px; } .heading { display: flex; justify-content: space-between; gap: 16px; } h1 { margin: 5px 0; font-size: 32px; } .eyebrow, .heading p { color: var(--color-muted); } .heading p { margin: 0; } .heading button { align-self: start; border: 1px solid var(--color-border); background: var(--color-panel); color: var(--color-ink); padding: 8px 10px; cursor: pointer; } .workspace { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 460px); min-height: 560px; border: 1px solid var(--color-border); background: var(--color-panel); } .list-pane { min-width: 0; padding: 8px; } .endpoint-row { display: grid; grid-template-columns: 36px 64px minmax(0, 1fr) 52px; align-items: center; gap: 8px; width: 100%; min-height: 64px; border: 0; border-bottom: 1px solid var(--color-border); background: transparent; color: var(--color-ink); text-align: left; cursor: pointer; } .endpoint-row:hover, .endpoint-row.selected { background: color-mix(in srgb, var(--color-copper) 10%, transparent); } .index, .confidence, small { color: var(--color-muted); font-size: 11px; } .verb { color: var(--color-copper-strong); font: 11px var(--font-code); } .path { min-width: 0; overflow: hidden; } .path strong, .path small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .confidence { text-align: right; } @media (max-width: 900px) { .workspace { grid-template-columns: 1fr; } .workspace tanit-endpoint-detail { min-height: 420px; } }
  `,
})
export class EndpointsListComponent {
  readonly store = inject(EndpointsStore);
  @ViewChild("endpointTemplate", { static: true }) readonly endpointTemplate!: TemplateRef<unknown>;
  readonly trackBy = (item: { id: string }): string => item.id;

  constructor() {
    effect(() => {
      const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
      const query = this.queryFromUrl(params);
      if (JSON.stringify(query) !== JSON.stringify(this.store.query())) this.store.setQuery(query);
      const endpoint = params.get("endpoint");
      if (endpoint && endpoint !== this.store.selectedId()) this.store.select(endpoint);
    });
  }

  apply(query: EndpointQuery): void { this.store.setQuery(query); this.updateUrl(query); }
  select(id: string): void { this.store.select(id); this.updateUrl({ ...this.store.query(), endpoint: id } as EndpointQuery & { endpoint: string }); }
  clearSelection(): void { this.store.select(null); this.updateUrl(this.store.query()); }
  filterDiagnostic(value: string): void { this.apply({ ...this.store.query(), diagnosticCode: value }); }
  filterTransport(value: string): void { this.apply({ ...this.store.query(), transport: value as EndpointQuery["transport"] }); }
  openLocation(location: { file: string; line: number; column: number }): void { if (typeof window !== "undefined") window.open(`tanit://open?file=${encodeURIComponent(location.file)}&line=${location.line}&column=${location.column}`, "_blank"); }
  private updateUrl(query: EndpointQuery & { endpoint?: string }): void { if (typeof history === "undefined") return; const params = new URLSearchParams(); for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value)); history.replaceState(null, "", `${location.pathname}?${params.toString()}`); }
  private queryFromUrl(params: URLSearchParams): EndpointQuery {
    const transport = params.get("transport");
    const confidence = params.get("confidence");
    return {
      service: params.get("service") ?? undefined,
      framework: params.get("framework") ?? undefined,
      transport: transport && ["http", "grpc", "graphql", "websocket", "sse", "message-broker"].includes(transport) ? transport as EndpointQuery["transport"] : undefined,
      method: params.get("method") ?? undefined,
      auth: params.get("auth") ?? undefined,
      validation: params.get("validation") ?? undefined,
      responses: params.get("responses") ?? undefined,
      confidence: confidence ? Number(confidence) : undefined,
      sourceFile: params.get("sourceFile") ?? undefined,
      diagnosticCode: params.get("diagnosticCode") ?? undefined,
      search: params.get("search") ?? undefined,
    };
  }
}