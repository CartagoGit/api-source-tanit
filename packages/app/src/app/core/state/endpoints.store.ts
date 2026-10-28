import { Injectable, computed, inject, signal } from "@angular/core";

import { EndpointsClient, EndpointQuery, EndpointRecord, createEndpointDataset } from "../api/endpoints.client";

function fuzzyMatch(query: string, value: string): boolean {
  let queryIndex = 0;
  const normalized = value.toLowerCase();
  for (const character of normalized) if (character === query[queryIndex]) queryIndex += 1;
  return queryIndex === query.length;
}

@Injectable({ providedIn: "root" })
export class EndpointsStore {
  private readonly client = inject(EndpointsClient);
  readonly all = signal<readonly EndpointRecord[]>(createEndpointDataset());
  readonly selectedId = signal<string | null>(null);
  readonly query = signal<EndpointQuery>({});
  readonly filtered = computed(() => this.all().filter((endpoint) => {
    const query = this.query();
    const search = query.search?.trim().toLowerCase();
    return (!query.service || endpoint.service === query.service)
      && (!query.framework || endpoint.framework === query.framework)
      && (!query.transport || endpoint.transport === query.transport)
      && (!query.method || endpoint.method === query.method)
      && (!query.auth || endpoint.auth === query.auth)
      && (!query.validation || endpoint.validation === query.validation)
      && (!query.responses || endpoint.responseSummary.includes(query.responses))
      && (query.confidence === undefined || endpoint.evidence.some((item) => item.confidence >= query.confidence!))
      && (!query.sourceFile || endpoint.sourceFile.includes(query.sourceFile))
      && (!query.diagnosticCode || endpoint.diagnostics.some((diagnostic) => diagnostic.code === query.diagnosticCode))
      && (!search || fuzzyMatch(search, `${endpoint.path} ${endpoint.method} ${endpoint.description}`));
  }));
  readonly selected = computed(() => this.all().find((endpoint) => endpoint.id === this.selectedId()) ?? null);

  setQuery(query: EndpointQuery): void { this.query.set(query); }
  select(id: string | null): void { this.selectedId.set(id); }
  selectFromUrl(search: string): void { this.setQuery({ ...this.query(), search }); }
  async refresh(): Promise<void> {
    const result = await this.client.list();
    this.all.set(result.endpoints);
  }
}