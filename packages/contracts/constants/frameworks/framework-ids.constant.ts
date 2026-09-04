/**
 * Frameworks this project knows how to detect.
 *
 * This **is the catalog**, and it lives here (not inside the
 * registry) for one measured reason: `SUPPORTED_FRAMEWORKS` used to
 * be derived from `DEFAULT_REGISTRY.detectors`, so reading the
 * list of names required importing `framework.registry`, and with
 * it **all twenty-one scanners** with their PHP, Go, Java, Python
 * and Rust parsers behind.
 *
 * The MCP plugin did that just to declare a `z.enum` of names. A
 * twenty-kilobyte `import` of regexes to write a list of strings.
 *
 * ## Why a literal list, not a derived one
 *
 * Because the dependency goes the other way: the catalog is
 * **data**, and the registry is what fulfills it. Deriving it from
 * the registry flips that and forces dragging the implementation
 * to know the interface.
 *
 * The obvious risk is that the two lists drift — and this
 * repository already paid for that: `NON_LARAVEL_FRAMEWORKS`
 * enumerated eleven of twelve frameworks, Laravel was missing, and
 * `summary` went off on its own counting declared routes instead of
 * endpoints.
 *
 * Hence a test that compares this list against the registered
 * detectors and fails if one is missing or extra. A parallel list is
 * not dangerous; a parallel list **that nobody compares** is.
 */

/**
 * Identifiers, in alphabetical order.
 *
 * Order matters little functionally, but a stable order makes
 * adding one a one-line diff instead of a re-ordered block.
 */
export const FRAMEWORK_IDS = [
  "aspnet",
  "django",
  "express",
  "fastapi",
  "fastify",
  "fiber",
  "flask",
  "gin",
  "graphql",
  "hono",
  "ktor",
  "laravel",
  "nestjs",
  "nextjs",
  "openapi",
  "phoenix",
  "rails",
  "rust",
  "springboot",
  "symfony",
  "trpc",
] as const;

/**
 * Un identificador de framework conocido.
 *
 * Se deriva de la lista, así que añadir uno arriba lo hace válido aquí
 * sin tocar nada más — y escribir mal un nombre deja de compilar, que es
 * lo que un `string` suelto no puede darte.
 */
export type KnownFrameworkId = (typeof FRAMEWORK_IDS)[number];
