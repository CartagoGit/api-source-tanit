import { Injectable, signal } from "@angular/core";

/**
 * The theme, and the switch that changes it.
 *
 * ## What was wrong
 *
 * The theme lived inside the shell component: a signal, a
 * `localStorage` key and a line that set `data-theme` on the
 * document. Only the shell could see it.
 *
 * That is why the settings screen could not show which theme was on:
 * it did not know. And had it changed the theme by writing to the
 * storage, the shell would have kept drawing the old one until the
 * app was reloaded — two truths about one thing, and the one on the
 * screen is the wrong one.
 *
 * ## What it is now
 *
 * A store, like the rest of the app's state. The shell applies it,
 * the settings screen reads it and switches it, and both see the
 * same truth because there is only one truth.
 */
@Injectable({ providedIn: "root" })
export class ThemeStore {
  /** The theme in use: `light` or `dark`. */
  readonly theme = signal<"light" | "dark">(this.read());

  constructor() {
    this.apply(this.theme());
  }

  /** Switches between light and dark. */
  toggle(): void {
    this.set(this.theme() === "light" ? "dark" : "light");
  }

  /** Sets the theme, and remembers it. */
  set(theme: "light" | "dark"): void {
    this.theme.set(theme);
    this.storage()?.setItem("tanit.theme", theme);
    this.apply(theme);
  }

  private read(): "light" | "dark" {
    return this.storage()?.getItem("tanit.theme") === "dark" ? "dark" : "light";
  }

  private apply(theme: "light" | "dark"): void {
    if (typeof document === "undefined") return;
    document.documentElement.dataset["theme"] = theme;
  }

  private storage(): Storage | undefined {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  }
}
