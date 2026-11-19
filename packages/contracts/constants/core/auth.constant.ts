/**
 * Variable names used by the authentication flow.
 *
 * These are not the writer's private detail: three places **share**
 * them and must agree exactly — the login script that saves the
 * token, the collection's `auth` block, and every request's
 * Authorization header. If one drifted from the others, the
 * collection would silently fail to authenticate: Postman would
 * send `Bearer {{token}}` with an empty `token` and the API would
 * answer 401 for a reason that has nothing to do with what was
 * being tested.
 *
 * That is exactly the criterion for a constant to be a contract:
 * more than one module depends on its exact value.
 */

/** Login user. Goes to the environment, not the collection. */
export const AUTH_USERNAME_VARIABLE = "authUsername";

/** Login password. Stored empty and marked as secret. */
export const AUTH_PASSWORD_VARIABLE = "authPassword";

/**
 * Where the login script saves the token.
 *
 * The most-shared of the three, and the one that breaks most silently.
 */
export const AUTH_TOKEN_VARIABLE = "token";

/** Environment variable that holds the API key. */
export const AUTH_API_KEY_VARIABLE = "apiKey";

/** OAuth2 client id. Postman asks for it by name. */
export const AUTH_CLIENT_ID_VARIABLE = "clientId";

/** OAuth2 client secret. Stored empty and as a secret. */
export const AUTH_CLIENT_SECRET_VARIABLE = "clientSecret";
