import { ChangeDetectionStrategy, Component, HostListener, input, output, signal } from "@angular/core";

import { EndpointRecord } from "../../core/api/endpoints.client";
import { SchemaViewerComponent } from "./schema-viewer.component";
import { TransportInspectorDirective } from "./transport-inspector.directive";

/**
 * The detail of one endpoint.
 *
 * ## What it shows, and what it does not
 *
 * Every tab here reads from the backend. The **Request** and
 * **Responses** tabs are empty until the endpoint is selected and its
 * detail is fetched — the panel says so instead of showing placeholders.
 *
 * Two tabs that were here are gone, and their absence is the point:
 *
 *   · **Source** showed the code of the route. The code was
 *     **invented**: a generator wrote a plausible snippet per
 *     endpoint, so the tab showed source that does not exist in the
 *     user's project. The API serves data about an endpoint, not the
 *     text of the file it came from — the browser has no business
 *     reading the user's source, and the desktop app can open the
 *     file itself from the location below.
 *   · **Evidence** showed a confidence percentage no scanner had
 *     measured, next to a file:line that pointed nowhere. What
 *     survives is the **Location** tab: the file and line the route
 *     was really declared at, when the scanner knew it, and nothing
 *     when it did not.
 */
@Component({
  selector: "tanit-endpoint-detail",
  standalone: true,
  imports: [SchemaViewerComponent, TransportInspectorDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (endpoint(); as item) {
      <aside class="detail" [style.width.px]="width()" aria-label="Endpoint detail">
        <div class="resize-handle" (pointerdown)="startResize($event)" aria-label="Resize detail"></div>
        <header><div><span class="method">{{ item.method }}</span><h2>{{ item.path }}</h2><p>{{ item.description || item.operationId }}</p></div><button type="button" (click)="closed.emit()" aria-label="Close detail">×</button></header>
        <nav class="tabs" aria-label="Endpoint detail tabs">@for (tab of tabs; track tab) { <button type="button" [class.active]="tab === activeTab()" (click)="activeTab.set(tab)">{{ tab }}</button> }</nav>
        @switch (activeTab()) {
          @case ('Overview') { <dl><dt>Operation</dt><dd>{{ item.operationId }}</dd><dt>Service</dt><dd>{{ item.service }} · {{ item.framework }}</dd><dt>Transport</dt><dd>{{ item.transport }}</dd><dt>Confidence</dt><dd>{{ item.confidence ?? "not reported" }}</dd></dl><div class="transport" tanitTransportInspector [diagnostic]="item.transport" (filter)="transportFilter.emit($event)"><strong>{{ transportTitle(item.transport) }}</strong><p>{{ transportDescription(item) }}</p></div> }
          @case ('Request') { @if (item.parameters.length) { <dl><dt>Parameters</dt><dd>@for (parameter of item.parameters; track parameter.name + parameter.location) { <span class="chip">{{ parameter.name }} · {{ parameter.location }}</span> }</dd></dl> } @if (item.requestSchema !== undefined) { <tanit-schema-viewer [schema]="item.requestSchema" /> } @else { <p class="empty">No request schema was found for this endpoint.</p> } }
          @case ('Responses') { @if (item.responses.length) { @for (response of item.responses; track response.status) { <article class="response"><strong>{{ response.status }}</strong><span>{{ response.description }}</span></article> } } @else { <p class="empty">No response was inferred for this endpoint.</p> } }
          @case ('Validation') { <p>Validation: <strong>{{ item.validation }}</strong></p> }
          @case ('Auth') { <p>Authentication: <strong>{{ item.auth }}</strong></p> }
          @case ('Location') { @if (item.sourceFile) { <p><button class="evidence" type="button" (click)="openLocation(item.sourceFile, item.line ?? 0)">{{ item.sourceFile }}{{ item.line ? ":" + item.line : "" }}</button></p> } @else { <p class="empty">The scanner did not report where this route was declared.</p> } }
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
    .transport, .response { padding: 12px; border: 1px solid var(--color-border); } .transport { cursor: pointer; } .transport p { color: var(--color-muted); } .response { display: flex; gap: 12px; margin-bottom: 8px; }
    .evidence { border: 0; background: transparent; color: var(--color-copper-strong); text-align: left; cursor: pointer; padding: 0; font: inherit; }
    .empty { color: var(--color-muted); }
  `,
})
export class EndpointDetailComponent {
  readonly endpoint = input<EndpointRecord | null>(null);
  readonly closed = output<void>();
  readonly transportFilter = output<string>();
  readonly open = output<{ file: string; line: number }>();
  readonly width = signal(460);
  readonly activeTab = signal("Overview");
  readonly tabs = ["Overview", "Request", "Responses", "Validation", "Auth", "Location"] as const;
  private resizing = false;
  private startX = 0;
  private startWidth = 0;

  startResize(event: Pick<PointerEvent, "clientX" | "pointerId" | "currentTarget">): void { this.resizing = true; this.startX = event.clientX; this.startWidth = this.width(); (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }
  @HostListener("document:pointermove", ["$event"]) onMove(event: PointerEvent): void { if (this.resizing) this.width.set(Math.min(720, Math.max(300, this.startWidth - event.clientX + this.startX))); }
  @HostListener("document:pointerup") onUp(): void { this.resizing = false; }
  openLocation(file: string, line: number): void { this.open.emit({ file, line }); }

  /**
   * The transport, in words.
   *
   * The vocabulary is the core's — `ws`, not `websocket`; `kafka`,
   * not `message-broker` — and a transport nobody has heard of (the
   * model is open, a scanner may add one) still gets a title instead
   * of an empty space.
   */
  transportTitle(transport: string): string {
    const titles: Record<string, string> = {
      http: "HTTP request",
      grpc: "gRPC call",
      ws: "WebSocket message",
      sse: "Server-sent event",
      kafka: "Kafka message",
      rabbitmq: "RabbitMQ message",
      nats: "NATS message",
      mqtt: "MQTT message",
    };
    return titles[transport] ?? `${transport} operation`;
  }

  transportDescription(item: EndpointRecord): string {
    switch (item.transport) {
      case "http": return `${item.method} request with ${item.parameters.length} parameter(s)`;
      case "grpc": return "Unary or streaming RPC with protobuf metadata";
      case "ws": return "Bidirectional channel message";
      case "sse": return "One-way event stream";
      default: return "Message exchanged over a broker";
    }
  }
}
