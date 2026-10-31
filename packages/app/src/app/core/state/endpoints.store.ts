import { Injectable, computed, inject, signal } from "@angular/core";

import { EndpointsClient, EndpointQuery, EndpointRecord } from "../api/endpoints.client";
import { ProjectStore } from "./project.store";

/**
 * The endpoint list, as the explorer shows it.
 *
 * ## The filters moved to the backend
 *
 * They used to be applied here, with a `filter()` over the whole
 * array. That only worked because the array was invented and finite:
 * the app held five thousand endpoints, so it could filter them all
 * at once. With the real backend the list is **paged**, and a filter
 * applied to a page answers "is it in this page" — so a search for
 * an endpoint that lives on page three would have said "no results"
 * while the endpoint was right there.
 *
 * So the store sends the filter to the backend and draws what comes
 * back. The visible count and the indexed count both come from the
 * answer, which is the only place that knows both.
 *
 * ## The detail is fetched on demand
 *
 * The list carries enough to draw a row. The parameters, the
 * responses and the request schema need another round trip, and only
 * for the endpoint the user actually selected.
 */
@Injectable({ providedIn: "root" })
export class EndpointsStore {
  private readonly client = inject(EndpointsClient);
  private readonly project = inject(ProjectStore);

  /** The endpoints the backend answered with, filtered. */
  readonly all = signal<readonly EndpointRecord[]>([]);
  /** How many endpoints match the filter. */
  readonly total = signal(0);
  /** How many endpoints the project has. */
  readonly indexedTotal = signal(0);
  readonly selectedId = signal<string | null>(null);
  readonly query = signal<EndpointQuery>({});
  /** Whether a request is in flight. */
  readonly loading = signal(false);
  /** The last failure, in words a person can read. */
  readonly error = signal<string | null>(null);

  /** The endpoints the user sees. */
  readonly filtered = computed(() => this.all());
  /** The selected endpoint, with its detail if it has been fetched. */
  readonly selected = computed(() => this.all().find((endpoint) => endpoint.id === this.selectedId()) ?? null);

  setQuery(query: EndpointQuery): void {
    this.query.set(query);
  }

  select(id: string | null): void {
    this.selectedId.set(id);
  }

  selectFromUrl(search: string): void {
    this.setQuery({ ...this.query(), search });
  }

  /**
   * Asks the backend for the endpoints that match the filter.
   *
   * It does nothing without a project: the API needs a session, and
   * a session needs a root. Asking anyway would produce a
   * `SESSION_NOT_FOUND` that the user cannot act on.
   */
  async refresh(): Promise<void> {
    const projectRoot = this.project.projectRoot();
    if (projectRoot === null) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.client.list(projectRoot, this.query());
      this.all.set(result.endpoints);
      this.total.set(result.total);
      this.indexedTotal.set(result.indexedTotal);
    } catch (error) {
      this.error.set(describe(error));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Fills the selected endpoint's detail.
   *
   * A failure leaves the endpoint as it was — the row still shows
   * what the summary knew — and records why the detail is missing.
   */
  async loadDetail(endpoint: { readonly id: string; readonly method: string; readonly path: string }): Promise<void> {
    const projectRoot = this.project.projectRoot();
    if (projectRoot === null) return;
    try {
      const detail = await this.client.detail(projectRoot, endpoint.method, endpoint.path);
      this.all.update((endpoints) =>
        endpoints.map((item) =>
          item.id === endpoint.id
            ? {
                ...item,
                parameters: detail.parameters,
                responses: detail.responses,
                requestSchema: detail.requestSchema,
              }
            : item,
        ),
      );
    } catch (error) {
      this.error.set(describe(error));
    }
  }
}

/** The message of a failure, in words a person can read. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
