import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

interface SchemaNode { readonly path: string; readonly label: string; readonly value: unknown; readonly level: number; readonly branch: boolean; }

@Component({
  selector: "tanit-schema-viewer",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="schema" aria-label="Schema viewer">
      <header><strong>Schema</strong><button type="button" (click)="copyPath('$.')">Copy JSON path</button></header>
      <div class="tree" role="tree">@for (node of nodes(); track node.path) { <button type="button" class="node" [style.padding-left.px]="12 + node.level * 18" (click)="copyPath(node.path)" role="treeitem"><span>{{ node.branch ? "▾" : "•" }}</span><strong>{{ node.label }}</strong><small>{{ node.branch ? "" : valueText(node.value) }}</small></button> }</div>
    </section>
  `,
  styles: `.schema { border: 1px solid var(--color-border); background: var(--color-panel); } header { display: flex; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid var(--color-border); } button { border: 0; background: transparent; color: var(--color-copper-strong); cursor: pointer; } .tree { padding: 8px 0; } .node { display: flex; gap: 8px; width: 100%; padding-top: 4px; padding-bottom: 4px; text-align: left; } small { margin-left: auto; color: var(--color-muted); font: 12px var(--font-code); }`,
})
export class SchemaViewerComponent {
  readonly schema = input<unknown>(null);
  readonly nodes = computed(() => this.flatten(this.schema(), "$"));
  format(schema: unknown): string { return JSON.stringify(schema, null, 2) ?? "null"; }
  valueText(value: unknown): string { return typeof value === "string" ? value : JSON.stringify(value); }
  private flatten(value: unknown, path: string, level = 0): SchemaNode[] {
    if (typeof value !== "object" || value === null) return [{ path, label: path.split(".").at(-1) ?? path, value, level, branch: false }];
    const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);
    return entries.flatMap(([key, child]) => {
      const childPath = `${path}.${key}`;
      const branch = typeof child === "object" && child !== null;
      return [{ path: childPath, label: key, value: child, level, branch }, ...(branch ? this.flatten(child, childPath, level + 1) : [])];
    });
  }
  async copyPath(path: string): Promise<void> { if (typeof navigator !== "undefined" && navigator.clipboard) await navigator.clipboard.writeText(path); }
}