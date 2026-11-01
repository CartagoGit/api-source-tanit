import { ChangeDetectionStrategy, Component, HostListener, inject, input, output, signal } from "@angular/core";

import { EndpointRecord } from "../../core/api/endpoints.client";
import { I18nService } from "../../core/i18n/i18n.service";
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
  readonly i18n = inject(I18nService);
  readonly endpoint = input<EndpointRecord | null>(null);
  readonly closed = output<void>();
  readonly transportFilter = output<string>();
  readonly open = output<{ file: string; line: number }>();
  readonly width = signal(460);
  readonly activeTab = signal("overview");
  readonly tabs = [
    { id: "overview", labelKey: "endpoint.tabOverview" },
    { id: "request", labelKey: "endpoint.tabRequest" },
    { id: "responses", labelKey: "endpoint.tabResponses" },
    { id: "validation", labelKey: "endpoint.tabValidation" },
    { id: "auth", labelKey: "endpoint.tabAuth" },
    { id: "location", labelKey: "endpoint.tabLocation" },
  ] as const;
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
    return value ?? this.i18n.translate("endpoint.notReported");
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
    if (transport === undefined) return this.i18n.translate("endpoint.transportNotReported");
    const titles: Record<string, string> = {
      http: this.i18n.translate("endpoint.transportHttp"),
      grpc: this.i18n.translate("endpoint.transportGrpcCall"),
      ws: this.i18n.translate("endpoint.transportWebsocket"),
      sse: this.i18n.translate("endpoint.transportServerSent"),
      kafka: this.i18n.translate("endpoint.transportKafka"),
      rabbitmq: this.i18n.translate("endpoint.transportRabbitmq"),
      nats: this.i18n.translate("endpoint.transportNats"),
      mqtt: this.i18n.translate("endpoint.transportMqtt"),
    };
    return titles[transport] ?? `${transport} ${this.i18n.translate("endpoint.transportOperation")}`;
  }

  transportDescription(item: EndpointRecord): string {
    switch (item.transport) {
      case "http":
        return this.i18n.translate(
          item.parameters.length === 1 ? "endpoint.requestOne" : "endpoint.requestMany",
          { method: item.method, count: item.parameters.length },
        );
      case "grpc": return this.i18n.translate("endpoint.transportGrpc");
      case "ws": return this.i18n.translate("endpoint.transportWebsocketDescription");
      case "sse": return this.i18n.translate("endpoint.transportServerSentDescription");
      case undefined: return this.i18n.translate("endpoint.transportUnknown");
      default: return this.i18n.translate("endpoint.transportBroker");
    }
  }
}
