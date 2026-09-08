import { Injectable, signal } from "@angular/core";
import type { IPaletteCommand } from "../../../../../contracts/interfaces/ui/palette-command.interface";

@Injectable({ providedIn: "root" })
export class CommandStore {
  readonly commands = signal<ReadonlyArray<IPaletteCommand>>([
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
