import { PercentPipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, HostListener, input, output, signal } from "@angular/core";

import { EndpointRecord } from "../../core/api/endpoints.client";
import { CodeSnippetComponent } from "./code-snippet.component";
import { SchemaViewerComponent } from "./schema-viewer.component";
import { TransportInspectorDirective } from "./transport-inspector.directive";

@Component({
  selector: "tanit-endpoint-detail",
  standalone: true,
  imports: [PercentPipe, SchemaViewerComponent, CodeSnippetComponent, TransportInspectorDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (endpoint(); as item) {
      <aside class="detail" [style.width.px]="width()" aria-label="Endpoint detail">
        <div class="resize-handle" (pointerdown)="startResize($event)" aria-label="Resize detail"></div>
        <header><div><span class="method">{{ item.method }}</span><h2>{{ item.path }}</h2><p>{{ item.description }}</p></div><button type="button" (click)="closed.emit()" aria-label="Close detail">×</button></header>
        <nav class="tabs" aria-label="Endpoint detail tabs">@for (tab of tabs; track tab) { <button type="button" [class.active]="tab === activeTab()" (click)="activeTab.set(tab)">{{ tab }}</button> }</nav>
        @switch (activeTab()) {
          @case ('Overview') { <dl><dt>Operation</dt><dd>{{ item.operationId }}</dd><dt>Service</dt><dd>{{ item.service }} · {{ item.framework }}</dd><dt>Transport</dt><dd>{{ item.transport }}</dd></dl><div class="transport" tanitTransportInspector [diagnostic]="item.transport" (filter)="transportFilter.emit($event)"><strong>{{ transportTitle(item.transport) }}</strong><p>{{ transportDescription(item) }}</p></div>@for (diagnostic of item.diagnostics; track diagnostic.code) { <button class="diagnostic" type="button" (click)="filter.emit(diagnostic.code)"><strong>{{ diagnostic.code }}</strong> {{ diagnostic.message }}</button> } }
          @case ('Request') { <dl><dt>Parameters</dt><dd>@for (parameter of item.parameters; track parameter.name) { <span class="chip">{{ parameter.name }} · {{ parameter.location }}</span> }</dd></dl><tanit-schema-viewer [schema]="item.requestSchema" /> }
          @case ('Responses') { @for (response of item.responses; track response.status) { <article class="response"><strong>{{ response.status }}</strong><span>{{ response.description }}</span></article> } }
          @case ('Validation') { <p>Validation: <strong>{{ item.validation }}</strong></p> }
          @case ('Auth') { <p>Authentication: <strong>{{ item.auth }}</strong></p> }
          @case ('Evidence') { @for (evidence of item.evidence; track evidence.sourceFile) { <button class="evidence" type="button" (click)="openLocation(evidence.sourceFile, evidence.line, evidence.column)">{{ evidence.sourceFile }}:{{ evidence.line }}:{{ evidence.column }} · {{ evidence.confidence | percent }}</button> } }
          @case ('Source') { <tanit-code-snippet [code]="item.code" [sourceFile]="item.sourceFile" [line]="item.evidence[0]?.line ?? 0" [column]="item.evidence[0]?.column ?? 0" /> }
        }
      </aside>
    }
  `,
  styles: `
    :host { display: block; min-width: 300px; }
    .detail { position: relative; display: grid; align-content: start; gap: 14px; height: 100%; min-width: 300px; max-width: 720px; overflow: auto; padding: 20px; border-left: 1px solid var(--color-border); background: var(--color-panel); }
    .resize-handle { position: absolute; top: 0; bottom: 0; left: -4px; width: 8px; cursor: col-resize; }
    header { display: flex; justify-content: space-between; gap: 12px; } h2 { margin: 6px 0; font-size: 20px; overflow-wrap: anywhere; } header p, dd { color: var(--color-muted); } header button { border: 0; background: transparent; font-size: 24px; cursor: pointer; }
    .method, .chip { display: inline-block; color: var(--color-copper-strong); font: 11px var(--font-code); } .chip { margin: 3px; padding: 4px 6px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
    .tabs { display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid var(--color-border); } .tabs button { border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--color-muted); padding: 8px 5px; cursor: pointer; } .tabs button.active { border-color: var(--color-copper); color: var(--color-ink); }
    dl { display: grid; grid-template-columns: 100px 1fr; gap: 8px; margin: 0; } dt { color: var(--color-muted); font-size: 12px; } dd { margin: 0; overflow-wrap: anywhere; }
    .transport, .response { padding: 12px; border: 1px solid var(--color-border); } .transport { cursor: pointer; } .transport p { color: var(--color-muted); } .response { display: flex; gap: 12px; margin-bottom: 8px; } .evidence { border: 0; background: transparent; color: var(--color-copper-strong); text-align: left; cursor: pointer; }
  `,
})
export class EndpointDetailComponent {
  readonly endpoint = input<EndpointRecord | null>(null);
  readonly closed = output<void>();
  readonly filter = output<string>();
  readonly transportFilter = output<string>();
  readonly open = output<{ file: string; line: number; column: number }>();
  readonly width = signal(460);
  readonly activeTab = signal("Overview");
  readonly tabs = ["Overview", "Request", "Responses", "Validation", "Auth", "Evidence", "Source"] as const;
  private resizing = false;
  private startX = 0;
  private startWidth = 0;

  startResize(event: Pick<PointerEvent, "clientX" | "pointerId" | "currentTarget">): void { this.resizing = true; this.startX = event.clientX; this.startWidth = this.width(); (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }
  @HostListener("document:pointermove", ["$event"]) onMove(event: PointerEvent): void { if (this.resizing) this.width.set(Math.min(720, Math.max(300, this.startWidth - event.clientX + this.startX))); }
  @HostListener("document:pointerup") onUp(): void { this.resizing = false; }
  openLocation(file: string, line: number, column: number): void { this.open.emit({ file, line, column }); }
  transportTitle(transport: EndpointRecord["transport"]): string { return ({ http: "HTTP request", grpc: "gRPC call", graphql: "GraphQL operation", websocket: "WebSocket message", sse: "Server-sent event", "message-broker": "Message broker message" } as const)[transport]; }
  transportDescription(item: EndpointRecord): string { switch (item.transport) { case "http": return `${item.method} request with ${item.parameters.length} parameter(s)`; case "grpc": return "Unary or streaming RPC with protobuf metadata"; case "graphql": return "Query or mutation with operation selection"; case "websocket": return "Bidirectional channel message"; case "sse": return "One-way event stream"; case "message-broker": return "Published or consumed message with delivery metadata"; } }
}