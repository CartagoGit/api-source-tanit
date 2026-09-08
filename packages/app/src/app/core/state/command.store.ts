import { Injectable, signal } from "@angular/core";

export interface PaletteCommand {
  readonly id: string;
  readonly labelKey: string;
  readonly shortcut?: string;
}

@Injectable({ providedIn: "root" })
export class CommandStore {
  readonly commands = signal<ReadonlyArray<PaletteCommand>>([
    { id: "open", labelKey: "palette.open", shortcut: "O" },
    { id: "rescan", labelKey: "palette.rescan", shortcut: "R" },
    { id: "search", labelKey: "palette.search", shortcut: "/" },
    { id: "export", labelKey: "palette.export", shortcut: "E" },
    { id: "settings", labelKey: "palette.settings", shortcut: "," },
    { id: "help", labelKey: "palette.help", shortcut: "?" },
    { id: "theme", labelKey: "palette.theme", shortcut: "T" },
    { id: "recent", labelKey: "palette.recent", shortcut: "P" },
  ]);
}
