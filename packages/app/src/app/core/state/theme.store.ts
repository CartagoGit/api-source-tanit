import { DOCUMENT } from "@angular/common";
import { Injectable, inject, signal } from "@angular/core";

const THEMES = [
  { id: "system", labelKey: "theme.system" },
  { id: "light", labelKey: "theme.light" },
  { id: "dark", labelKey: "theme.dark" },
  { id: "sand", labelKey: "theme.sand" },
  { id: "forest", labelKey: "theme.forest" },
  { id: "midnight", labelKey: "theme.midnight" },
] as const;
type Theme = (typeof THEMES)[number]["id"];
const STORAGE_KEY = "tanit.theme";

function isTheme(value: string | null | undefined): value is Theme {
  return THEMES.some((theme) => theme.id === value);
}

@Injectable({ providedIn: "root" })
export class ThemeStore {
  private readonly document = inject(DOCUMENT);
  private readonly selection = signal<Theme>(this.read());
  readonly theme = this.selection.asReadonly();
  readonly options = THEMES;

  constructor() {
    this.apply(this.theme());
  }

  set(theme: Theme): void {
    this.selection.set(theme);
    this.apply(theme);
    try {
      this.document.defaultView?.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage may be unavailable in a private or restricted browser context.
    }
  }

  private read(): Theme {
    try {
      const saved = this.document.defaultView?.localStorage.getItem(STORAGE_KEY);
      if (isTheme(saved)) return saved;
    } catch {
      // Use the system appearance when storage is unavailable.
    }
    return "system";
  }

  private apply(theme: Theme): void {
    this.document.documentElement.dataset["theme"] = theme;
  }
}
