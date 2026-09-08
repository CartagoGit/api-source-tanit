import { ChangeDetectionStrategy, Component, effect, input, output } from "@angular/core";

import { ENDPOINT_TRANSPORTS, EndpointQuery } from "../../core/api/endpoints.client";

@Component({
  selector: "tanit-endpoint-filters",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="filters" (submit)="$event.preventDefault()" aria-label="Endpoint filters">
      <label class="search">Search <input [value]="value().search ?? ''" (input)="patch({ search: inputValue($event) })" placeholder="Path, method, description" /></label>
      <label>Service <input [value]="value().service ?? ''" (input)="patch({ service: inputValue($event) || undefined })" /></label>
      <label>Framework <input [value]="value().framework ?? ''" (input)="patch({ framework: inputValue($event) || undefined })" /></label>
      <label>Source file <input [value]="value().sourceFile ?? ''" (input)="patch({ sourceFile: inputValue($event) || undefined })" /></label>
      <label>Transport <select [value]="value().transport ?? ''" (change)="patch({ transport: transportValue($event) })"><option value="">All</option>@for (transport of transports; track transport) { <option [value]="transport">{{ transport }}</option> }</select></label>
      <label>Method <input [value]="value().method ?? ''" (input)="patch({ method: inputValue($event) || undefined })" /></label>
      <label>Auth <select [value]="value().auth ?? ''" (change)="patch({ auth: inputValue($event) || undefined })"><option value="">All</option><option value="none">None</option><option value="bearer">Bearer</option><option value="api-key">API key</option></select></label>
      <label>Validation <select [value]="value().validation ?? ''" (change)="patch({ validation: inputValue($event) || undefined })"><option value="">All</option><option value="validated">Validated</option><option value="unvalidated">Unvalidated</option></select></label>
      <label>Responses <input [value]="value().responses ?? ''" (input)="patch({ responses: inputValue($event) || undefined })" placeholder="200" /></label>
      <label>Confidence <input type="number" min="0" max="1" step="0.01" [value]="value().confidence ?? ''" (input)="patch({ confidence: numberValue($event) })" /></label>
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

  constructor() { effect(() => void this.value()); }

  patch(partial: EndpointQuery): void { this.changed.emit({ ...this.value(), ...partial }); }
  inputValue(event: Event): string { return (event.target as HTMLInputElement).value; }
  numberValue(event: Event): number | undefined { const value = Number((event.target as HTMLInputElement).value); return Number.isFinite(value) ? value : undefined; }
  transportValue(event: Event): EndpointQuery["transport"] { const value = this.inputValue(event); return ENDPOINT_TRANSPORTS.includes(value as typeof ENDPOINT_TRANSPORTS[number]) ? value as EndpointQuery["transport"] : undefined; }
}