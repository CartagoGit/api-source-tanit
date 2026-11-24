import type { ClientUnresolvedReason, IClientConsumptionResult } from "../../../../../contracts/interfaces/core/client-consumption.interface";
import type { I18nService } from "../../core/i18n/i18n.service";

const STATE_KEYS: Readonly<Record<string, string>> = {
  resolved: "clientUsage.resolved",
  unresolved: "clientUsage.unresolved",
  matched: "clientUsage.matched",
  missing: "clientUsage.missing",
  ambiguous: "clientUsage.ambiguous",
  unknown: "clientUsage.unknown",
};

export function clientUsageStatusLabel(i18n: I18nService, state: string): string {
  return i18n.translate(STATE_KEYS[state] ?? state);
}

export function clientUsageReasonLabel(i18n: I18nService, reason: ClientUnresolvedReason | IClientConsumptionResult["diagnostics"][number]["reason"]): string {
  switch (reason) {
    case "shadowed-client": return i18n.translate("clientUsage.reasons.shadowed-client");
    case "unresolved-alias": return i18n.translate("clientUsage.reasons.unresolved-alias");
    case "unsupported-call": return i18n.translate("clientUsage.reasons.unsupported-call");
    case "dynamic-url": return i18n.translate("clientUsage.reasons.dynamic-url");
    case "invalid-url": return i18n.translate("clientUsage.reasons.invalid-url");
    case "relative-url": return i18n.translate("clientUsage.reasons.relative-url");
    case "dynamic-method": return i18n.translate("clientUsage.reasons.dynamic-method");
    case "unknown-options": return i18n.translate("clientUsage.reasons.unknown-options");
    case "unsupported-template": return i18n.translate("clientUsage.reasons.unsupported-template");
    case "unsupported-script": return i18n.translate("clientUsage.reasons.unsupported-script");
    case "parse-failed": return i18n.translate("clientUsage.reasons.parse-failed");
  }
}
