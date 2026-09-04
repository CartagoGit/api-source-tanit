/**
 * What the UI — terminal and web — needs to declare.
 *
 * `IUiDeps` is the one that matters: the web UI receives its
 * collaborators injected instead of imported, which is why its
 * routes can be tested end-to-end without opening a port.
 * Declaring it here is what lets the test double and the real
 * implementation both be typed against the same thing.
 *
 * The rest are shapes for terminal output: table columns, panel
 * metrics, the palette. None of these render anything; they only
 * say what shape what will be rendered takes.
 */

import type { IProjectSummary } from "../core/domain.interface.js";
import type { II18nCatalog } from "./i18n.interface.js";
import type { ISettings, ISettingsRead } from "./settings.interface.js";
import type { IBrowseListing } from "./browse.interface.js";
import type { IDryRunPlan } from "./dry-run.interface.js";
import type { IHistoryReadResult } from "./history.interface.js";
import type { ANSI_CODES } from "../../constants/cli/terminal.constant.js";

export interface IColumn {
  readonly header: string;
  /** Content alignment. Right-aligned numbers read better. */
  readonly align?: "left" | "right";
  /**
   * Minimum width kept after truncation.
   *
   * "GET" at two characters is not a method; with six, anything is.
   */
  readonly min?: number;
}

/** The metrics shown when generation finishes. */
export interface IQualityMetrics {
  readonly framework: string;
  readonly requests: number;
  readonly folders: number;
  /** Endpoints whose validation rules were read from source. */
  readonly withRules: number;
  /** Write endpoints — the ones that can carry a body. */
  readonly writeEndpoints: number;
  /** Of those, how many ended up with a body. */
  readonly withBody: number;
  /** Detected authentication scheme, and why. */
  readonly auth: { readonly type: string; readonly evidence: string };
  readonly warnings: ReadonlyArray<string>;
}

/** The colors that can be requested. Derived from the palette. */
export type ColorName = keyof typeof ANSI_CODES;

/** A painter: colors or not, depending on what's been decided at startup. */
export interface IPainter {
  readonly enabled: boolean;
  paint(text: string, color: ColorName): string;
  /** Multiple styles at once: `paint(t, "bold", "green")`. */
  style(text: string, ...colors: ColorName[]): string;
}

/** Lo que la interfaz necesita del resto del programa. */
export interface IUiDeps {
  /**
   * Los idiomas disponibles, ya cargados.
   *
   * Se inyecta en vez de importarse por lo mismo que el resto: la
   * interfaz no decide de dónde salen —empaquetados, de la carpeta de
   * quien la usa, o los dos— y así el test puede darle los suyos.
   */
  readonly locales: () => II18nCatalog;
  /** Los ajustes guardados, o los de por defecto la primera vez. */
  readonly readSettings: () => Promise<ISettingsRead>;
  /**
   * Cambia unos cuantos y devuelve el resultado.
   *
   * Se guarda **campo a campo** y no el objeto entero: la interfaz
   * escribe al tocar cada control, y mandar el objeto completo haría
   * que dos pestañas se pisaran lo que la otra acaba de cambiar.
   */
  readonly patchSettings: (
    cambios: Partial<Omit<ISettings, "version">>,
  ) => Promise<ISettings>;
  /**
   * Lista las carpetas de una ruta, para elegir explorando.
   *
   * Devuelve nombres de directorio y nada más: un endpoint que
   * devolviera contenido sería un lector de ficheros arbitrario.
   */
  readonly browse: (path?: string) => Promise<IBrowseListing>;
  /**
   * Qué pasaría si se generara, sin generar.
   *
   * Llama al pipeline —que construye en memoria— y planifica desde su
   * resultado. Predecir los nombres a mano sería una segunda
   * implementación que acabaría diciendo una cosa mientras `generate`
   * hace otra, que es el fallo que un ensayo viene a evitar.
   */
  readonly dryRun: (params: {
    readonly projectRoot: string;
    readonly outputDir?: string | undefined;
    readonly formats?: ReadonlyArray<string> | undefined;
    readonly framework?: string | undefined;
    /**
     * Subdirectorio del framework dentro del proyecto. f00011 S3.
     *
     * Si la UI lo conoce (un campo en el formulario que la persona
     * rellena), se pasa al pipeline; si no, el orquestador decide por
     * monorepo. El valor se valida en `generation.pipeline.ts`.
     */
    readonly frameworkSearchRoot?: string | undefined;
  }) => Promise<IDryRunPlan>;
  /** Resume un proyecto sin escribir nada. Es lo que hace `summary`. */
  readonly summarize: (projectRoot: string) => Promise<IProjectSummary>;
  /** Genera la colección. Es lo que hace `generate`. */
  readonly generate: (params: {
    readonly projectRoot: string;
    readonly outputDir?: string | undefined;
    readonly formats?: ReadonlyArray<string> | undefined;
    /**
     * Framework forzado, del catálogo (`frameworks()`).
     *
     * Aceptarlo aquí y no una segunda vía es lo que mantiene **una sola
     * ruta** de generación: el valor viaja hasta el `--framework` que ya
     * entiende el CLI, que se salta la autodetección. En un monorepo o
     * con una dependencia con alias, la detección no puede acertar
     * siempre; esta es la salida para esa persona.
     */
    readonly framework?: string | undefined;
    /**
     * Subdirectorio del framework dentro del proyecto. f00011 S3.
     *
     * Mismo contrato que `dryRun`: si la UI lo conoce, viaja hasta el
     * `--framework-search-root` del CLI; si no, el orquestador decide.
     */
    readonly frameworkSearchRoot?: string | undefined;
  }) => Promise<IUiGenerateResult>;
  /**
   * El historial de generaciones, ya limitado y ordenado.
   *
   * Se inyecta —en vez de llamarse directamente a `readHistory()` desde
   * la ruta— por la misma razón que el resto de colaboradores: poder
   * probar `handleUiRequest` con dobles, sin tocar el disco. La UI
   * pide aquí lo que va a enseñar en el dashboard; un `limit`
   * arbitrario no se manda desde la página para que el servidor
   * decida cuánto cargar.
   */
  readonly history: (params: {
    readonly limit?: number | undefined;
    readonly projectRoot?: string | undefined;
  }) => Promise<IHistoryReadResult>;
  /** Los formatos de salida que existen, del registro. */
  readonly formats: () => ReadonlyArray<string>;
  /** Los frameworks soportados, del registro. */
  readonly frameworks: () => ReadonlyArray<string>;
  /** ¿Existe este directorio? Inyectado para poder probarlo. */
  readonly exists: (path: string) => Promise<boolean>;
}

/** Lo que devuelve generar, en lo que la interfaz enseña. */
export interface IUiGenerateResult {
  readonly collectionPath: string | null;
  readonly requests: number;
  readonly folders: number;
  readonly extraPaths: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

/** Una respuesta ya resuelta: estado y cuerpo, sin envoltorio HTTP. */
export interface IUiResponse {
  readonly status: number;
  readonly body: unknown;
}

/** Un servidor levantado. */
export interface IUiServer {
  readonly url: string;
  readonly port: number;
  stop(): void;
}

/** Lo que hace falta para levantarlo. */
export interface IUiServerOptions {
  readonly deps: IUiDeps;
  /** El HTML de la interfaz, ya embebido: el binario no lee ficheros. */
  readonly html: string;
  readonly port?: number | undefined;
}
