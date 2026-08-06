/**
 * Configuración del proyecto host (PLANTILLA AGNÓSTICA).
 *
 * Copia esta carpeta a `examples/<tu-proyecto>/` o `resources/postman/examples/<tu-proyecto>/`
 * y edita los valores. Si no la creas, el paquete generará un ProjectConfig
 * zero-config automáticamente detectando:
 *   - nombre (composer.json → vendor/name)
 *   - baseUrl (.env → APP_URL + "/api")
 *   - prefijos de rutas (RouteServiceProvider::mapXxxRoutes())
 *
 * @see ../../contract/project-config.interface.ts para todos los campos disponibles.
 */
import type { ProjectConfig } from "../../contract/project-config.interface.js";

export const config: ProjectConfig = {
  name: "example-app",
  collectionName: "Example App (Postman)",
  collectionDescription:
    "Colección Postman generada automáticamente para example-app.",
  baseUrl: "http://localhost/api",

  variables: [
    { key: "baseUrl", value: "http://localhost/api", type: "string" },
    { key: "token", value: "", type: "string" },
    // Añade aquí variables propias del proyecto (ej. tenantId, apiKey, etc.)
  ],

  /**
   * Mapa archivo de rutas → prefijos externos aplicados por su
   * ServiceProvider. Si un archivo no aparece aquí, se asume `["api"]`.
   * Si está vacío, el paquete detecta automáticamente del RouteServiceProvider.
   */
  filePrefixes: {
    // "routes/api.php": [],
    // "routes/pedidos.php": ["api", "pedidos"],
  },

  /**
   * Agrupación lógica por prefijo de URI (orden de prioridad).
   * Cada par es [prefijo_o_segmento, zona].
   */
  zones: [
    // ["login", "Auth"],
    // ["usuarios", "Recursos"],
  ],

  /** Orden en que se imprimen las zonas en list/stats. */
  zoneOrder: ["Auth", "Recursos", "Comercial", "Operaciones", "Otros"],

  /** Zona por defecto cuando un endpoint no encaja con ningún prefijo. */
  defaultZone: "Otros",

  /** Descripciones reutilizadas en el campo `description` de las requests. */
  authDescriptions: {
    // bearer: "Bearer token de Sanctum/Passport",
  },

  /** Nombre del endpoint de Login para el auto-token. */
  loginEndpointName: "Login",

  /**
   * Reglas especiales de agrupación por URI (opcional).
   * Si una URI empieza con alguno de estos prefijos, se agrupa bajo la clave dada.
   */
  uriGroupOverrides: {
    // "tol/tecdoc": "tol/tecdoc",
  },

  /**
   * Environments a generar junto a la colección. Si está vacío, no se
   * genera ninguno. Para auto-generar Local/Dev/Staging/Producción, deja
   * el array vacío y usa `--envs dev,staging,prod` en el CLI.
   */
  environments: [
    { name: "Local", color: "#FF6B6B" },
    { name: "Dev", color: "#4ECDC4" },
    { name: "Staging", color: "#FFD93D" },
    { name: "Producción", color: "#95E1D3" },
  ],

  /**
   * Patrón dot-path para extraer el token de la respuesta de Login.
   *   - "access_token"        → JWT (tymon/jwt-auth)
   *   - "data.access_token"   → Sanctum / Laravel Passport
   *   - "data.token"          → otros Sanctum
   * Si está vacío o undefined, no se inyecta auto-token.
   */
  /**
   * Opcional. Déjalo vacío salvo que tu API devuelva el token en un
   * camino poco habitual: el script generado prueba en ejecución
   * `access_token`, `token`, `accessToken`, `data.access_token`,
   * `data.token`, `data.accessToken`, `jwt` e `id_token`.
   */
  tokenResponsePath: "",
};