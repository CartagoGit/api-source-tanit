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

/** What the UI needs from the rest of the program. */
export interface IUiDeps {
  /**
   * Available languages, already loaded.
   *
   * Injected rather than imported for the same reason as the rest:
   * the UI does not decide where they come from — bundled, the
   * user's folder, or both — and tests can give it their own.
   */
  readonly locales: () => II18nCatalog;
  /** Saved settings, or defaults the first time. */
  readonly readSettings: () => Promise<ISettingsRead>;
  /**
   * Change a few fields and return the result.
   *
   * Saved **field by field** rather than the whole object: the UI
   * writes on every control touch, and sending the whole object
   * would mean two tabs clobber each other's last write.
   */
  readonly patchSettings: (
    cambios: Partial<Omit<ISettings, "version">>,
  ) => Promise<ISettings>;
  /**
   * List folders of a path, for picker-browse.
   *
   * Returns directory names and nothing else: an endpoint that
   * returned content would be an arbitrary file reader.
   */
  readonly browse: (path?: string) => Promise<IBrowseListing>;
  /**
   * What would happen if we generated, without generating.
   *
   * Invokes the pipeline — which builds in memory — and plans
   * from its result. Predicting filenames by hand would be a
   * second implementation that would eventually drift from
   * `generate`, which is the very bug a dry-run is supposed to
   * prevent.
   */
  readonly dryRun: (params: {
    readonly projectRoot: string;
    readonly outputDir?: string | undefined;
    readonly formats?: ReadonlyArray<string> | undefined;
    readonly framework?: string | undefined;
    /**
     * Framework subdirectory within the project. f00011 S3.
     *
     * If the UI knows it (a form field the user fills), it is
     * passed to the pipeline; otherwise the orchestrator decides
     * via monorepo detection. The value is validated in
     * `generation.pipeline.ts`.
     */
    readonly frameworkSearchRoot?: string | undefined;
  }) => Promise<IDryRunPlan>;
  /** Inspect a project without writing. What `summary` does. */
  readonly summarize: (projectRoot: string) => Promise<IProjectSummary>;
  /** Generate the collection. What `generate` does. */
  readonly generate: (params: {
    readonly projectRoot: string;
    readonly outputDir?: string | undefined;
    readonly formats?: ReadonlyArray<string> | undefined;
    /**
     * Forced framework, from the catalog (`frameworks()`).
     *
     * Accepting it here — not in a separate channel — is what
     * keeps **a single** generation path: the value travels to
     * the `--framework` flag the CLI already understands, which
     * skips autodetection. In a monorepo or with an aliased
     * dependency, detection cannot always succeed; this is the
     * workaround.
     */
    readonly framework?: string | undefined;
    /**
     * Framework subdirectory within the project. f00011 S3.
     *
     * Same contract as `dryRun`: if the UI knows it, it travels
     * to the CLI's `--framework-search-root`; if not, the
     * orchestrator decides.
     */
    readonly frameworkSearchRoot?: string | undefined;
  }) => Promise<IUiGenerateResult>;
  /**
   * The generation history, already limited and ordered.
   *
   * Injected — rather than calling `readHistory()` directly from
   * the route — for the same reason as the rest of the
   * collaborators: testing `handleUiRequest` with doubles
   * without touching disk. The UI asks here for what the
   * dashboard will show; an arbitrary `limit` is not sent from
   * the page so the server decides how much to load.
   */
  readonly history: (params: {
    readonly limit?: number | undefined;
    readonly projectRoot?: string | undefined;
  }) => Promise<IHistoryReadResult>;
  /** Output formats that exist, from the registry. */
  readonly formats: () => ReadonlyArray<string>;
  /** Supported frameworks, from the registry. */
  readonly frameworks: () => ReadonlyArray<string>;
  /** Does this directory exist? Injected to be testable. */
  readonly exists: (path: string) => Promise<boolean>;
}

/** What generate returns, as the UI displays it. */
export interface IUiGenerateResult {
  readonly collectionPath: string | null;
  readonly requests: number;
  readonly folders: number;
  readonly extraPaths: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

/** A response already resolved: status and body, no HTTP envelope. */
export interface IUiResponse {
  readonly status: number;
  readonly body: unknown;
}

/** A started server. */
export interface IUiServer {
  readonly url: string;
  readonly port: number;
  stop(): void;
}

/** What is needed to start the server. */
export interface IUiServerOptions {
  readonly deps: IUiDeps;
  /** The UI HTML, already embedded: the binary does not read files. */
  readonly html: string;
  readonly port?: number | undefined;
}
