import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";

interface ISkippedNonHttpExportWarning {
  readonly kind: "skipped-non-http-export";
  readonly format: string;
  readonly transport: string;
  readonly endpoint: string;
  readonly name: string;
}

export function partitionHttpSpecs(
  specs: ReadonlyArray<EndpointSpec>,
): {
  readonly httpSpecs: EndpointSpec[];
  readonly skippedSpecs: EndpointSpec[];
} {
  const httpSpecs: EndpointSpec[] = [];
  const skippedSpecs: EndpointSpec[] = [];
  for (const spec of specs) {
    if (spec.transport === undefined || spec.transport === "http") {
      httpSpecs.push(spec);
    } else {
      skippedSpecs.push(spec);
    }
  }
  return { httpSpecs, skippedSpecs };
}

export function warnSkippedNonHttpExports(
  format: string,
  skippedSpecs: ReadonlyArray<EndpointSpec>,
): void {
  for (const spec of skippedSpecs) {
    const payload: ISkippedNonHttpExportWarning = {
      kind: "skipped-non-http-export",
      format,
      transport: spec.transport ?? "http",
      endpoint: `${spec.method} ${spec.uri}`,
      name: spec.name,
    };
    console.warn(JSON.stringify(payload));
  }
}