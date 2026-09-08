import { Injectable, signal } from "@angular/core";

import en from "./locales/en.json";
import es from "./locales/es.json";

type Locale = "en" | "es";
type Catalog = Record<string, string>;

@Injectable({ providedIn: "root" })
export class I18nService {
  private readonly catalogs: Record<Locale, Catalog> = { en, es };
  readonly locale = signal<Locale>(this.readLocale());

  translate(key: string): string {
    return this.catalogs[this.locale()][key] ?? this.catalogs.en[key] ?? key;
  }

  setLocale(locale: Locale): void {
    this.locale.set(locale);
    this.storage()?.setItem("tanit.locale", locale);
  }

  private readLocale(): Locale {
    return this.storage()?.getItem("tanit.locale") === "en" ? "en" : "es";
  }

  private storage(): Storage | undefined {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  }
}
