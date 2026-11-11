import { z } from "zod";

const Rfc6901PointerSchema = z.string().regex(/^#(?:\/(?:[^~]|~[01])*)*$/, "Expected an RFC 6901 JSON pointer fragment");

/** One runtime contract for every carrier; omission means no comparison was run. */
export const ContractScanEvidenceSchema = z.object({
  kind: z.enum(["code", "documentation"]),
  completeness: z.enum(["complete", "partial", "unknown"]),
  artifacts: z.array(z.string()),
  limitations: z.array(z.string()),
  links: z.array(z.object({
    url: z.string().url().refine(value => {
      try {
        const parsed = new URL(value);
        const authority = value.match(/^https?:\/\/([^/?#]*)/i)?.[1] ?? "";
        return ["http:", "https:"].includes(parsed.protocol) && !authority.includes("@");
      }
      catch { return false; }
    }, "Links must be credential-free HTTP(S) URLs"),
    file: z.string(), pointer: Rfc6901PointerSchema,
  })).optional(),
});
export const ContractSourceSchema = ContractScanEvidenceSchema.extend({
  framework: z.string(), serviceId: z.string(),
});
export const ContractOperationEvidenceSchema = z.object({
  framework: z.string(), file: z.string(), line: z.number().int().nonnegative(),
  pointer: Rfc6901PointerSchema.optional(),
  references: z.array(z.object({ file: z.string(), pointer: Rfc6901PointerSchema })).optional(),
  description: z.string().optional(),
});
export const ContractComparisonSchema = z.object({
  serviceId: z.string(), method: z.string(), path: z.string(),
  status: z.enum(["matched", "documented-only", "observed-only", "conflict", "unknown"]),
  documented: z.array(ContractOperationEvidenceSchema),
  observed: z.array(ContractOperationEvidenceSchema),
  conflicts: z.array(z.object({ field: z.string(), documented: z.string(), observed: z.string() })),
  limitations: z.array(z.string()),
});
export const ContractEvidenceReportSchema = z.object({
  scope: z.literal("static-scan"),
  sources: z.array(ContractSourceSchema),
  operations: z.array(ContractComparisonSchema),
});
