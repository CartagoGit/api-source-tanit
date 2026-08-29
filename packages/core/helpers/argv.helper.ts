/**
 * Leer un flag de la línea de comandos, una sola vez.
 *
 * Esta función de seis líneas estaba copiada **cuatro veces**, y las
 * copias no coincidían:
 *
 * | Dónde | Devuelve | Nombre |
 * |---|---|---|
 * | `project-loader.service` | `string \| null` | `readFlag` |
 * | `project-context.service` | `string \| undefined` | `readFlag` |
 * | `push.script` | `string \| null` | `readFlag` |
 * | `init.script` | `string \| null` | `flag(name, argv)` — argumentos al revés |
 *
 * Dos de ellas viven en el núcleo y discrepan en cómo dicen "no está".
 * Eso no rompe el compilador y se manifiesta más tarde: quien lea una y
 * escriba `flag === undefined` acierta en una y falla en las otras tres,
 * porque `null === undefined` es `false`. Y la cuarta, además, tiene los
 * argumentos en el orden contrario, así que copiar una llamada de un
 * fichero a otro compila y hace otra cosa.
 *
 * ## Por qué `undefined` y no `null`
 *
 * Porque es lo que ya devuelve indexar un array fuera de rango, que es
 * de donde sale el valor. Con `noUncheckedIndexedAccess` activo,
 * `argv[i + 1]` **ya** es `string | undefined`: devolver `null` obliga a
 * convertir, y esa conversión es justo donde se pierde la diferencia.
 * Además `?? ` funciona igual con los dos, así que el sitio de llamada
 * no cambia.
 */

/**
 * El valor de `--flag valor`, o `undefined` si no está.
 *
 * Acepta también `--flag=valor`, que es como lo escribe la mitad de la
 * gente y como lo generan casi todos los scripts. Antes solo funcionaba
 * la forma con espacio y la otra se ignoraba en silencio: el flag
 * parecía no estar.
 */
export function readFlag(
  argv: ReadonlyArray<string>,
  name: string,
): string | undefined {
  const index = argv.indexOf(name);
  if (index !== -1) {
    const value = argv[index + 1];
    // `--output-dir --json` no es un valor: es el flag siguiente. Sin
    // esto, `--output-dir` sin valor se llevaba `--json` por delante.
    return value !== undefined && !value.startsWith("--") ? value : undefined;
  }
  const prefijo = `${name}=`;
  const pegado = argv.find((arg) => arg.startsWith(prefijo));
  return pegado?.slice(prefijo.length);
}

/** ¿Está el flag, con valor o sin él? */
export function hasFlag(argv: ReadonlyArray<string>, name: string): boolean {
  return argv.includes(name) || argv.some((arg) => arg.startsWith(`${name}=`));
}
