/**
 * El canal por el que sale una versión de Tanit.
 *
 * ## Por qué un canal y no sólo un número
 *
 * El número dice **qué** hay; el canal dice **cuánto se puede esperar**.
 * `1.0.0` dice "API estable, no la toques". Un alfa dice "esto se
 * rompe y hay que probarlo". Publicar con el número equivocado no es
 * un detalle cosmético: quien instala espera un contrato, y un alfa
 * que se presenta como estable rompe esa expectativa en el peor
 * momento.
 *
 * La escalera es explícita y se sube de uno en uno:
 *
 *   · `alpha` — se rompe. La forma todavía se mueve.
 *   · `beta` — la forma está; puede haber fallos de comportamiento.
 *   · `rc` — candidata a la release. Sólo falta decidir el número.
 *   · `stable` — la release. A partir de aquí, versionado normal.
 */
export type ReleaseChannel = "alpha" | "beta" | "rc" | "stable";
