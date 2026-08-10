/**
 * Lo que la interfaz —de terminal y web— necesita declarar.
 *
 * `IUiDeps` es el que importa: la interfaz web recibe sus colaboradores
 * inyectados en vez de importarlos, y por eso sus rutas se pueden probar
 * enteras sin levantar un puerto. Declararlo aquí es lo que permite que
 * el doble de test y la implementación real se tipen contra lo mismo.
 *
 * Lo demás son las formas de la salida por terminal: columnas de tabla,
 * métricas del panel y la paleta. Nada de esto pinta nada; solo dice qué
 * forma tiene lo que se va a pintar.
 */

import type { IProjectSummary } from "../core/domain.interface.js";
import type { ANSI_CODES } from "../../constants/cli/terminal.constant.js";

export interface IColumn {
  readonly header: string;
  /** Alineación del contenido. Los números se leen mejor a la derecha. */
  readonly align?: "left" | "right";
  /**
   * Ancho mínimo que conserva al recortar.
   *
   * `GET` con dos caracteres no es un método; con seis, cualquiera lo es.
   */
  readonly min?: number;
}

/** Las métricas que se enseñan al terminar. */
export interface IQualityMetrics {
  readonly framework: string;
  readonly requests: number;
  readonly folders: number;
  /** Endpoints cuyas reglas se leyeron del código. */
  readonly withRules: number;
  /** Endpoints de escritura, que son los que pueden llevar body. */
  readonly writeEndpoints: number;
  /** De esos, cuántos acabaron con body. */
  readonly withBody: number;
  /** Esquema de autenticación detectado, y por qué. */
  readonly auth: { readonly type: string; readonly evidence: string };
  readonly warnings: ReadonlyArray<string>;
}

/** Los colores que se pueden pedir. Se derivan de la paleta. */
export type ColorName = keyof typeof ANSI_CODES;

/** Un pintor: colorea o no, según se haya decidido una vez al arrancar. */
export interface IPainter {
  readonly enabled: boolean;
  paint(text: string, color: ColorName): string;
  /** Varios estilos a la vez: `paint(t, "bold", "green")`. */
  style(text: string, ...colors: ColorName[]): string;
}

/** Lo que la interfaz necesita del resto del programa. */
export interface IUiDeps {
  /** Resume un proyecto sin escribir nada. Es lo que hace `summary`. */
  readonly summarize: (projectRoot: string) => Promise<IProjectSummary>;
  /** Genera la colección. Es lo que hace `generate`. */
  readonly generate: (params: {
    readonly projectRoot: string;
    readonly outputDir?: string | undefined;
    readonly formats?: ReadonlyArray<string> | undefined;
  }) => Promise<IUiGenerateResult>;
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
