import { ChangeDetectionStrategy, Component, effect, ElementRef, inject, input, output, signal, ViewChild } from "@angular/core";

import { CommandStore } from "../core/state/command.store";
import type { IPaletteCommand } from "../../../../contracts/interfaces/ui/palette-command.interface";
import { I18nService } from "../core/i18n/i18n.service";

export function fuzzyMatch(query: string, candidate: string): boolean {
  let queryIndex = 0;
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedCandidate = candidate.toLowerCase();

  for (const character of normalizedCandidate) {
    if (character === normalizedQuery[queryIndex]) queryIndex += 1;
    if (queryIndex === normalizedQuery.length) return true;
  }
  return normalizedQuery.length === 0;
}

@Component({
  selector: "tanit-command-palette",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./command-palette.component.html",
  styleUrls: ["./command-palette.component.scss"],
})
export class CommandPaletteComponent {
  private readonly commands = inject(CommandStore);
  readonly i18n = inject(I18nService);
  readonly open = input(false);
  readonly close = output<void>();
  readonly chosen = output<string>();
  readonly query = signal("");
  readonly selectedIndex = signal(0);
  @ViewChild("palette") palette?: ElementRef<HTMLElement>;
  @ViewChild("search") search?: ElementRef<HTMLInputElement>;

  /**
   * Who had the focus before the palette opened.
   *
   * Without this, closing the palette **threw the focus away**: it
   * went to the document body, and a keyboard user had to start
   * again from the top of the page. A dialog that takes the focus
   * has to give it back.
   */
  private restoreFocusTo: HTMLElement | null = null;

  constructor() {
    effect(() => {
      if (this.open()) {
        this.restoreFocusTo =
          typeof document === "undefined"
            ? null
            : ((document.activeElement as HTMLElement | null) ?? null);
        // The input does not exist until the `@if` has rendered, so
        // the focus is taken **after** the DOM is there. A microtask
        // is too early: it runs before the view is refreshed.
        setTimeout(() => this.search?.nativeElement.focus(), 0);
        return;
      }
      const target = this.restoreFocusTo;
      this.restoreFocusTo = null;
      if (target !== null && typeof target.focus === "function") target.focus();
    });
  }

  /** The id of one option, so the input can point at it. */
  optionId(index: number): string {
    return `palette-option-${index}`;
  }

  filteredCommands(): ReadonlyArray<IPaletteCommand> {
    const query = this.query().trim().toLowerCase();
    return this.commands.commands().filter((command) => fuzzyMatch(query, `${this.i18n.translate(command.labelKey)} ${command.id} ${command.shortcut ?? ""}`));
  }

  updateQuery(value: string): void {
    this.query.set(value);
    this.selectedIndex.set(0);
  }

  choose(command: IPaletteCommand): void {
    this.chosen.emit(command.id);
    this.close.emit();
  }

  onKeydown(event: KeyboardEvent): void {
    const count = this.filteredCommands().length;
    if (event.key === "ArrowDown") { event.preventDefault(); this.selectedIndex.set(Math.min(this.selectedIndex() + 1, Math.max(0, count - 1))); }
    if (event.key === "ArrowUp") { event.preventDefault(); this.selectedIndex.set(Math.max(0, this.selectedIndex() - 1)); }
    if (event.key === "Enter") { event.preventDefault(); const command = this.filteredCommands()[this.selectedIndex()]; if (command) this.choose(command); }
    if (event.key === "Escape") { event.preventDefault(); this.close.emit(); }
    if (event.key === "Tab") {
      event.preventDefault();
      const focusable = this.palette?.nativeElement.querySelectorAll<HTMLElement>("input, button:not([disabled])");
      if (!focusable?.length) return;
      const current = Array.from(focusable).indexOf(document.activeElement as HTMLElement);
      const next = (current + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      focusable[next]?.focus();
    }
  }
}
