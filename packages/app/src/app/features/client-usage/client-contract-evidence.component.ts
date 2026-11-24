import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";

import type {
  IJsonRequestCheck,
  IJsonResponseCheck,
} from "../../../../../contracts/interfaces/core/client-consumption.interface";
import { I18nService } from "../../core/i18n/i18n.service";
import { BadgeComponent } from "../../shared/badge/badge.component";

@Component({
  selector: "tanit-client-contract-evidence",
  standalone: true,
  imports: [BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./client-contract-evidence.component.html",
  styleUrls: ["./client-contract-evidence.component.scss"],
})
export class ClientContractEvidenceComponent {
  readonly i18n = inject(I18nService);
  readonly request = input<IJsonRequestCheck>();
  readonly response = input<IJsonResponseCheck>();
  readonly checks = computed(() => {
    const request = this.request();
    const response = this.response();
    return [
      ...(request ? [{ direction: "request" as const, evidence: request, status: undefined }] : []),
      ...(response ? [{ direction: "response" as const, evidence: response, status: response.status }] : []),
    ];
  });

  verdictLabel(verdict: IJsonRequestCheck["verdict"]): string {
    switch (verdict) {
      case "compatible": return this.i18n.translate("clientContract.verdict.compatible");
      case "incompatible": return this.i18n.translate("clientContract.verdict.incompatible");
      case "unknown": return this.i18n.translate("clientContract.verdict.unknown");
    }
  }

  reasonLabel(reason: NonNullable<IJsonRequestCheck["reason"] | IJsonResponseCheck["reason"]>): string {
    switch (reason) {
      case "unsupported-schema": return this.i18n.translate("clientContract.reason.unsupported-schema");
      case "invalid-json": return this.i18n.translate("clientContract.reason.invalid-json");
      case "missing-field": return this.i18n.translate("clientContract.reason.missing-field");
      case "unexpected-field": return this.i18n.translate("clientContract.reason.unexpected-field");
      case "type-mismatch": return this.i18n.translate("clientContract.reason.type-mismatch");
      case "enum-mismatch": return this.i18n.translate("clientContract.reason.enum-mismatch");
      case "unsupported-json": return this.i18n.translate("clientContract.reason.unsupported-json");
      case "missing-client-json": return this.i18n.translate("clientContract.reason.missing-client-json");
      case "missing-backend-schema": return this.i18n.translate("clientContract.reason.missing-backend-schema");
      case "missing-client-type": return this.i18n.translate("clientContract.reason.missing-client-type");
      case "optional-field": return this.i18n.translate("clientContract.reason.optional-field");
    }
  }

  suggestion(direction: "request" | "response", evidence: IJsonRequestCheck | IJsonResponseCheck): string {
    switch (evidence.reason) {
      case "missing-backend-schema":
        return this.i18n.translate("clientContract.addSchema");
      case "missing-client-type":
        return this.i18n.translate("clientContract.addType");
      case "missing-client-json":
        return this.i18n.translate("clientContract.addBodyEvidence");
      default:
        if (evidence.verdict === "incompatible") {
          return direction === "request"
            ? this.i18n.translate("clientContract.alignRequest")
            : this.i18n.translate("clientContract.alignResponse");
        }
        return evidence.verdict === "unknown" ? this.i18n.translate("clientContract.inspectSources") : "";
    }
  }
}
