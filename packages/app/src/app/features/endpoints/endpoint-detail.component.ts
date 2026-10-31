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
  templateUrl: "./endpoint-detail.component.html",
  styleUrls: ["./endpoint-detail.component.scss"],
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
   * What to draw when the backend did not say.
   *
   * The app used to fill the gaps with `"unknown"` and `"none"`,
   * which read like answers. Not knowing is not knowing, and saying
   * so is the difference between a report and a guess.
   */
  reported(value: string | undefined): string {
    return value ?? "not reported";
  }

  /**
   * The transport, in words.
   *
   * The vocabulary is the core's — `ws`, not `websocket`; `kafka`,
   * not `message-broker` — and a transport nobody has heard of (the
   * model is open, a scanner may add one) still gets a title instead
   * of an empty space.
   */
  transportTitle(transport: string | undefined): string {
    if (transport === undefined) return "Transport not reported";
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
      case undefined: return "The scanner did not report a transport for this route.";
      default: return "Message exchanged over a broker";
    }
  }
}
