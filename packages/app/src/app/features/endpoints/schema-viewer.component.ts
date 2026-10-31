import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

interface SchemaNode { readonly path: string; readonly label: string; readonly value: unknown; readonly level: number; readonly branch: boolean; }

@Component({
  selector: "tanit-schema-viewer",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./schema-viewer.component.html",
  styleUrls: ["./schema-viewer.component.scss"],
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