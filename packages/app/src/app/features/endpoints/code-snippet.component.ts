import { ChangeDetectionStrategy, Component, input } from "@angular/core";

@Component({
  selector: "tanit-code-snippet",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="snippet" aria-label="Code snippet"><header><strong>Source</strong><button type="button" (click)="copy()">Copy</button></header><pre>{{ code() }}</pre><small>{{ location() }}</small></section>`,
  styles: `.snippet { border: 1px solid var(--color-border); background: #191d20; color: #edf0ec; } header { display: flex; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid #394044; } button { border: 0; background: transparent; color: #df895f; cursor: pointer; } pre { overflow: auto; margin: 0; padding: 12px; white-space: pre-wrap; font: 12px/1.5 var(--font-code); } small { display: block; padding: 0 12px 10px; color: #a5abb0; }`,
})
export class CodeSnippetComponent {
  readonly code = input("");
  readonly sourceFile = input("");
  readonly line = input(0);
  readonly column = input(0);
  location(): string { return this.locationFor(this.sourceFile(), this.line(), this.column()); }
  locationFor(sourceFile: string, line: number, column: number): string { return `${sourceFile}:${line}:${column}`; }
  async copy(): Promise<void> { if (typeof navigator !== "undefined" && navigator.clipboard) await navigator.clipboard.writeText(this.code()); }
}