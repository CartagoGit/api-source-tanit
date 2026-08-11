/**
 * Los idiomas que trae la interfaz, y cómo se elige uno.
 *
 * Quince, por número de hablantes. No es una lista cerrada: se pueden
 * añadir más dejando un fichero en la carpeta de idiomas del usuario, y
 * eso es deliberado — un idioma nuevo no debería exigir tocar código ni
 * recompilar nada.
 *
 * ## Por qué el código y no el nombre
 *
 * El identificador es el código BCP 47 (`es`, `pt-BR`, `zh-Hans`),
 * porque es lo que dicen el navegador (`navigator.language`) y el
 * sistema (`LANG`). Guardar «Español» obligaría a traducir de vuelta en
 * cada arranque, y ahí es donde se pierden los acentos y las mayúsculas.
 *
 * ## El nombre va en su propio idioma
 *
 * `nativeName` está en el idioma que nombra —«Français», no «Francés»—
 * porque quien busca su idioma en una lista no sabe cómo se dice el
 * suyo en el idioma que está viendo. Es la razón por la que todos los
 * selectores de idioma del mundo lo hacen así.
 */

/** Un idioma que la interfaz sabe hablar. */
export interface ILocale {
  /** Código BCP 47. Es lo que dicen el navegador y el sistema. */
  readonly code: string;
  /** Cómo se llama el idioma **en ese idioma**. */
  readonly nativeName: string;
  /** Se escribe de derecha a izquierda. Cambia el `dir` del documento. */
  readonly rtl?: boolean;
}

/**
 * El idioma al que se cae cuando no hay nada mejor.
 *
 * Inglés, y no español, aunque la prosa interna del repositorio sea
 * española: lo que ve quien usa la herramienta es superficie de
 * producto, y ahí ya se decidió el inglés (`r00003`).
 */
export const FALLBACK_LOCALE = "en";

/**
 * Los quince, en orden de hablantes.
 *
 * El orden importa poco funcionalmente, pero uno estable hace que
 * añadir un idioma sea una línea de diff en vez de un bloque
 * reordenado.
 */
export const BUNDLED_LOCALES: ReadonlyArray<ILocale> = [
  { code: "en", nativeName: "English" },
  { code: "zh-Hans", nativeName: "简体中文" },
  { code: "hi", nativeName: "हिन्दी" },
  { code: "es", nativeName: "Español" },
  { code: "ar", nativeName: "العربية", rtl: true },
  { code: "fr", nativeName: "Français" },
  { code: "bn", nativeName: "বাংলা" },
  { code: "pt", nativeName: "Português" },
  { code: "ru", nativeName: "Русский" },
  { code: "ur", nativeName: "اردو", rtl: true },
  { code: "id", nativeName: "Bahasa Indonesia" },
  { code: "de", nativeName: "Deutsch" },
  { code: "ja", nativeName: "日本語" },
  { code: "tr", nativeName: "Türkçe" },
  { code: "ko", nativeName: "한국어" },
];
