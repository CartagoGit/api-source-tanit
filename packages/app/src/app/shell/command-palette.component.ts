import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, input, output, signal, ViewChild } from "@angular/core";

import { CommandStore, PaletteCommand } from "../core/state/command.store";
import { I18nService } from "../core/i18n/i18n.service";

@Component({
  selector: "tanit-command-palette",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="scrim" (click)="close.emit()"></div>
      <section class="palette" role="dialog" aria-modal="true" [attr.aria-label]="i18n.translate('palette.placeholder')">
        <input #search autofocus [value]="query()" (input)="query.set(search.value)" [placeholder]="i18n.translate('palette.placeholder')" (keydown)="onKeydown($event)" />
        <div role="listbox">
          @for (command of filteredCommands(); track command.id; let index = $index) {
            <button type="button" role="option" [attr.aria-selected]="index === selectedIndex()" [class.selected]="index === selectedIndex()" (click)="choose(command)">
              <span>{{ i18n.translate(command.labelKey) }}</span><kbd>{{ command.shortcut }}</kbd>
            </button>
          } @empty { <p>No matching commands</p> }
        </div>
        <button class="close" type="button" (click)="close.emit()">{{ i18n.translate("palette.close") }}</button>
      </section>
    }
  `,
  styles: `
    .scrim { position: fixed; inset: 0; z-index: 10; background: rgb(0 0 0 / 35%); }
    .palette { position: fixed; z-index: 11; top: 18%; left: 50%; width: min(560px, calc(100vw - 32px)); transform: translateX(-50%); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-panel); box-shadow: 0 18px 60px rgb(0 0 0 / 20%); padding: var(--space-3); }
    input { width: 100%; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-ink); padding: var(--space-3); }
    input:focus { outline: 2px solid var(--color-focus); outline-offset: 1px; }
    [role="listbox"] { display: grid; gap: var(--space-1); margin-top: var(--space-3); }
    [role="option"] { display: flex; justify-content: space-between; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-ink); padding: var(--space-3); text-align: left; }
    [role="option"].selected, [role="option"]:hover { background: color-mix(in srgb, var(--color-copper) 14%, transparent); }
    kbd { color: var(--color-muted); font-family: var(--font-code); }
    .close { margin-top: var(--space-2); border: 0; background: transparent; color: var(--color-muted); font-size: 12px; }
  `,
})
export class CommandPaletteComponent {
  private readonly commands = inject(CommandStore);
  readonly i18n = inject(I18nService);
  readonly open = input(false);
  readonly close = output<void>();
  readonly chosen = output<string>();
  readonly query = signal("");
  readonly selectedIndex = signal(0);
  @ViewChild("search") search?: ElementRef<HTMLInputElement>;

  filteredCommands(): ReadonlyArray<PaletteCommand> {
    const query = this.query().trim().toLowerCase();
    return this.commands.commands().filter((command) => this.i18n.translate(command.labelKey).toLowerCase().includes(query));
  }

  choose(command: PaletteCommand): void {
    this.chosen.emit(command.id);
    this.close.emit();
  }

  onKeydown(event: KeyboardEvent): void {
    const count = this.filteredCommands().length;
    if (event.key === "ArrowDown") { event.preventDefault(); this.selectedIndex.set(Math.min(this.selectedIndex() + 1, Math.max(0, count - 1))); }
    if (event.key === "ArrowUp") { event.preventDefault(); this.selectedIndex.set(Math.max(0, this.selectedIndex() - 1)); }
    if (event.key === "Enter") { event.preventDefault(); const command = this.filteredCommands()[this.selectedIndex()]; if (command) this.choose(command); }
    if (event.key === "Escape") { event.preventDefault(); this.close.emit(); }
  }

  @HostListener("document:keydown", ["$event"])
  onGlobalKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); this.open() ? this.close.emit() : undefined; }
  }
}
