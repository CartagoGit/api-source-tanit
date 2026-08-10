/**
 * Los nombres de variable del flujo de autenticación.
 *
 * No son detalle de quien los escribe: los **comparten** tres sitios que
 * tienen que coincidir exactamente —el script del login que guarda el
 * token, el bloque `auth` de la colección, y la cabecera de cada
 * petición—. Si uno bailara respecto a los otros, la colección dejaría
 * de autenticar sin que nada fallara: Postman mandaría `Bearer {{token}}`
 * con `token` vacío y la API contestaría 401 por un motivo que no tiene
 * nada que ver con lo que se estaba probando.
 *
 * Ese es exactamente el criterio para que una constante sea contrato:
 * que más de un módulo dependa de su valor concreto.
 */

/** Usuario del login. Va al environment, no a la colección. */
export const AUTH_USERNAME_VARIABLE = "authUsername";

/** Contraseña del login. Va vacía y marcada como secreto. */
export const AUTH_PASSWORD_VARIABLE = "authPassword";

/**
 * Donde el script del login guarda el token.
 *
 * El más compartido de los tres, y el que más silenciosamente rompe.
 */
export const AUTH_TOKEN_VARIABLE = "token";

/** Variable de entorno donde vive la clave de API. */
export const AUTH_API_KEY_VARIABLE = "apiKey";

/** Cliente del flujo OAuth2. Postman lo pide por nombre. */
export const AUTH_CLIENT_ID_VARIABLE = "clientId";

/** Secreto de cliente para OAuth2. Va vacío y como secreto. */
export const AUTH_CLIENT_SECRET_VARIABLE = "clientSecret";
