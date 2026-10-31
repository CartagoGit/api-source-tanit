import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from "@angular/core";

import { ExportCapabilities, ExportFormat } from "../../core/api/exports.client";

/**
 * The formats the user can pick.
 *
 * The card shows what the **core** says each format does. The app
 * used to carry its own descriptions — "Collection and environment
 * compatible with Postman", "Canonical HTTP contract with schemas
 * and responses" — written by hand, never checked against the
 * exporter, and wrong the day an exporter changed. The backend says
 * what each one does now.
 */
@Component({
  selector: "tanit-format-capabilities",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./format-capabilities.component.html",
  styleUrls: ["./format-capabilities.component.scss"],
})
export class FormatCapabilitiesComponent {
  @Input() capabilities: readonly ExportCapabilities[] = [];
  @Input() selected: readonly ExportFormat[] = [];
  @Output() readonly changed = new EventEmitter<ExportFormat>();
}
