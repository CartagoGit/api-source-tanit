/**
 * Los frameworks que este proyecto sabe reconocer.
 *
 * Es **el catálogo**, y vive aquí y no dentro del registro por una razón
 * medida: `SUPPORTED_FRAMEWORKS` se derivaba de
 * `DEFAULT_REGISTRY.detectors`, así que leer la lista de nombres
 * obligaba a importar `framework.registry`, y con él **los veintiún
 * scanners** con sus parsers de PHP, Go, Java, Python y Rust detrás.
 *
 * El plugin MCP lo hacía solo para declarar un `z.enum` de nombres. Un
 * `import` de veinte kilobytes de expresiones regulares para escribir
 * una lista de strings.
 *
 * ## Por qué una lista literal y no una derivada
 *
 * Porque la dependencia va al revés: el catálogo es **dato**, y el
 * registro es quien lo cumple. Derivarlo del registro invierte eso y
 * obliga a arrastrar la implementación para conocer la interfaz.
 *
 * El riesgo evidente es que las dos listas se separen — y es un riesgo
 * real, este repositorio ya lo pagó: `NON_LARAVEL_FRAMEWORKS` enumeraba
 * once de doce frameworks, Laravel no estaba, y `summary` se iba por un
 * camino distinto contando rutas declaradas en vez de endpoints.
 *
 * Por eso hay un test que compara esta lista con los detectores
 * registrados y falla si sobra o falta uno. La lista paralela no es
 * peligrosa; la lista paralela **que nadie compara** sí.
 */

/**
 * Los identificadores, en orden alfabético.
 *
 * El orden importa poco funcionalmente, pero un orden estable hace que
 * añadir uno sea una línea de diff en vez de un bloque reordenado.
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
