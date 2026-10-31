import { ChangeDetectionStrategy, Component, effect, input, output } from "@angular/core";

import {
  ENDPOINT_CONFIDENCES,
  ENDPOINT_TRANSPORTS,
  EndpointConfidence,
  EndpointQuery,
} from "../../core/api/endpoints.client";

/**
 * The filter bar of the endpoint explorer.
 *
 * Every filter here is answered by the **backend**. They used to be
 * applied in the client, over a list the app had invented — a filter
 * over invented data is decoration. Now the same filters narrow the
 * real project, and the count that comes back is the count of the
 * project, not of a page.
 *
 * The vocabularies are the core's: `ws` is a WebSocket, `high` is a
 * confidence level, `none` is the absence of a validation.
 */
@Component({
  selector: "tanit-endpoint-filters",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="filters" (submit)="$event.preventDefault()" aria-label="Endpoint filters">
      <label class="search">Search <input [value]="value().search ?? ''" (input)="patch({ search: inputValue($event) })" placeholder="Path, method, name" /></label>
      <label>Service <input [value]="value().service ?? ''" (input)="patch({ service: inputValue($event) || undefined })" /></label>
      <label>Framework <input [value]="value().framework ?? ''" (input)="patch({ framework: inputValue($event) || undefined })" /></label>
      <label>Source file <input [value]="value().sourceFile ?? ''" (input)="patch({ sourceFile: inputValue($event) || undefined })" /></label>
      <label>Transport <select [value]="value().transport ?? ''" (change)="patch({ transport: transportValue($event) })"><option value="">All</option>@for (transport of transports; track transport) { <option [value]="transport">{{ transport }}</option> }</select></label>
      <label>Method <input [value]="value().method ?? ''" (input)="patch({ method: inputValue($event) || undefined })" /></label>
      <label>Auth <input [value]="value().auth ?? ''" (input)="patch({ auth: inputValue($event) || undefined })" placeholder="bearer" /></label>
      <label>Validation <input [value]="value().validation ?? ''" (input)="patch({ validation: inputValue($event) || undefined })" placeholder="zod" /></label>
      <label>Responses <input [value]="value().responses ?? ''" (input)="patch({ responses: inputValue($event) || undefined })" placeholder="200" /></label>
      <label>Confidence <select [value]="value().confidence ?? ''" (change)="patch({ confidence: confidenceValue($event) })"><option value="">All</option>@for (level of confidences; track level) { <option [value]="level">{{ level }}</option> }</select></label>
      <button type="button" (click)="changed.emit({})">Clear</button>
    </form>
  `,
  styles: `
    :host { display: block; }
    .filters { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 10px; padding: 14px; border: 1px solid var(--color-border); background: var(--color-panel); }
    label { display: grid; gap: 4px; color: var(--color-muted); font-size: 11px; }
    .search { grid-column: span 2; }
    input, select, button { min-height: 34px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-ink); padding: 6px 8px; font: inherit; }
    button { align-self: end; cursor: pointer; }
    @media (max-width: 900px) { .filters { grid-template-columns: repeat(2, 1fr); } .search { grid-column: span 2; } }
  `,
})
export class FiltersComponent {
  readonly value = input<EndpointQuery>({});
  readonly changed = output<EndpointQuery>();
  readonly transports = ENDPOINT_TRANSPORTS;
  readonly confidences = ENDPOINT_CONFIDENCES;

  constructor() { effect(() => void this.value()); }

  patch(partial: EndpointQuery): void { this.changed.emit({ ...this.value(), ...partial }); }
  inputValue(event: Event): string { return (event.target as HTMLInputElement).value; }
  transportValue(event: Event): EndpointQuery["transport"] { const value = this.inputValue(event); return ENDPOINT_TRANSPORTS.includes(value as typeof ENDPOINT_TRANSPORTS[number]) ? value as EndpointQuery["transport"] : undefined; }
  confidenceValue(event: Event): EndpointConfidence | undefined { const value = this.inputValue(event); return ENDPOINT_CONFIDENCES.includes(value as EndpointConfidence) ? value as EndpointConfidence : undefined; }
}
