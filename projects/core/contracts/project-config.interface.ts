/**
 * Interfaz de configuración del proyecto.
 *
 * Todo proyecto que use este paquete debe proporcionar un objeto
 * `ProjectConfig` con sus valores específicos (nombre, variables,
 * prefijos de rutas, zonas, etc.). El paquete en sí NO contiene
 * ningún valor de proyecto: solo esta interfaz y los servicios
 * que la consumen.
 *
 * Ejemplo mínimo:
 * ```ts
 * import type { ProjectConfig } from "./contracts/project-config.interface.js";
 *
 * export const config: ProjectConfig = {
 *   name: "mi-api",
 *   collectionName: "Mi API (Catálogo)",
 *   collectionDescription: "Colección Postman de Mi API.",
 *   baseUrl: "http://localhost/api",
 *   variables: [
 *     { key: "baseUrl", value: "http://localhost/api", type: "string" },
 *     { key: "token", value: "", type: "string" },
 *   ],
 *   filePrefixes: {},
 *   zones: [],
 *   zoneOrder: [],
 *   defaultZone: "Otros",
 *   authDescriptions: {},
 *   loginEndpointName: "Login",
 * };
 * ```
 */
import type { PostmanVariable } from "./postman.interface.js";

/**
 * Configuración completa que un proyecto debe proporcionar.
 */
export interface ProjectConfig {
  /** Nombre corto del proyecto (usado como basename del JSON de salida). */
  name: string;

  /** Nombre visible de la colección en Postman (`info.name`). */
  collectionName: string;

  /**
   * ID fijo de la colección en Postman (UUID). Opcional.
   *
   * Si no se declara, se deriva de forma determinista del nombre del
   * proyecto, de modo que regenerar y re-importar ACTUALIZA la colección
   * existente en lugar de crear una copia.
   *
   * Fíjalo a mano si renombras el proyecto o lo mueves de carpeta y
   * quieres conservar la colección que ya tienes en Postman.
   */
  collectionId?: string;

  /** Descripción de la colección (`info.description`). */
  collectionDescription: string;

  /** URL base por defecto (incluye `/api` si aplica). */
  baseUrl: string;

  /** Variables de colección Postman. */
  variables: PostmanVariable[];

  /**
   * Mapa archivo de rutas → prefijos externos aplicados por su
   * ServiceProvider. Si un archivo no está aquí, se asume `["api"]`.
   *
   * Ejemplo:
   * ```ts
   * {
   *   "routes/api.php": [],
   *   "routes/pedidos.php": ["api", "pedidos"],
   * }
   * ```
   */
  filePrefixes: Record<string, string[]>;

  /**
   * Prefijos de URI que definen zonas lógicas. Orden de prioridad:
   * la primera coincidencia gana.
   *
   * Ejemplo:
   * ```ts
   * [
   *   ["login", "Auth"],
   *   ["certificados", "Auth"],
   *   ["productos", "Recursos"],
   * ]
   * ```
   */
  zones: ReadonlyArray<readonly [string, string]>;

  /** Orden en que se imprimen las zonas en list/stats. */
  zoneOrder: string[];

  /** Zona por defecto cuando un endpoint no encaja con ningún prefijo. */
  defaultZone: string;

  /**
   * Descripciones reutilizadas en el campo `description` de las
   * requests. Clave libre (p. ej. "sanctumToken", "jwtToken", "externalApiKey").
   */
  authDescriptions: Record<string, string>;

  /**
   * Nombre del endpoint de login para el auto-token. Si no existe
   * un endpoint con este nombre, no se aplica el script de auto-token.
   */
  loginEndpointName: string;

  /**
   * Reglas especiales de agrupación por URI. Si una URI empieza con
   * alguno de estos prefijos, se agrupa bajo la clave dada en lugar
   * de usar el primer segmento.
   *
   * Ejemplo:
   * ```ts
   * {
   *   "tol/tecdoc": "tol/tecdoc",
   *   "proveedores-externos": "proveedores-externos",
   * }
   * ```
   */
  uriGroupOverrides?: Record<string, string>;

  /**
   * Environments adicionales a generar junto a la colección. Si está
   * vacío o undefined, no se genera ningún environment. Cada `baseUrl`
   * reemplaza el del config solo en ese environment.
   *
   * Para generar dev/staging/prod automáticamente, usa
   * `defaultEnvironments(baseUrl)` de
   * `services/environment-builder.service.ts`.
   */
  environments?: ReadonlyArray<{
    name: string;
    color?: string;
    overrides?: Record<string, string>;
  }>;

  /**
   * Dot-path donde viene el token en la respuesta del login:
   * `data.access_token` (Sanctum/Laravel Passport), `access_token`
   * (tymon/jwt-auth), `token`…
   *
   * Opcional. Si no se declara, el script generado prueba en ejecución
   * los caminos habituales y usa el primero que traiga un string no
   * vacío. Decláralo solo si tu API devuelve el token en un sitio raro.
   */
  tokenResponsePath?: string;
}
