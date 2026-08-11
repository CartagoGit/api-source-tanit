/**
 * Navegar carpetas desde la interfaz.
 *
 * Escribir la ruta a mano es donde más se falla: una errata devuelve «no
 * existe» y no queda pista de dónde estabas. Poder subir y bajar por el
 * árbol convierte eso en mirar.
 *
 * ## Solo carpetas, nunca contenido
 *
 * Se devuelven **nombres de directorio**. Ni ficheros ni, mucho menos, lo
 * que hay dentro de ellos. Dos motivos, y el segundo es el que manda:
 *
 *   · Lo que se elige aquí es una carpeta, y enseñar los miles de
 *     ficheros de un `node_modules` hace la lista inútil.
 *   · Esto es un servidor HTTP en la máquina de alguien. Un endpoint que
 *     devolviera contenido sería un lector de ficheros arbitrario, y da
 *     igual que escuche solo en `127.0.0.1`: la interfaz ya tuvo un CSRF
 *     por dar por bueno ese razonamiento.
 *
 * ## Un directorio ilegible no rompe la navegación
 *
 * Se marca y se sigue. Alguien navegando por `/` se cruza con carpetas
 * del sistema a las que no tiene acceso, y que la lista entera falle por
 * eso haría el explorador inservible justo donde más falta hace.
 */
import { readdir, stat } from "node:fs/promises";
import { dirname, join, parse, resolve, sep } from "node:path";
import { homedir } from "node:os";

import type {
  IBrowseEntry,
  IBrowseListing,
} from "../../contracts/interfaces/cli/browse.interface.js";

/**
 * Cuántas entradas se devuelven como mucho.
 *
 * Una carpeta con diez mil subdirectorios existe —`/nix/store`, un
 * `node_modules` grande— y mandarlos todos convierte la respuesta en
 * megabytes que además nadie va a leer. Se corta y se dice que se ha
 * cortado, que es distinto de mentir sobre el total.
 */
const MAXIMO = 500;

/** ¿Se puede leer y es un directorio? */
async function esDirectorio(ruta: string): Promise<boolean> {
  try {
    return (await stat(ruta)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Dónde empezar cuando no se dice nada.
 *
 * La carpeta personal y no la raíz del sistema: es donde está lo que
 * alguien quiere escanear, y empezar en `/` obliga a bajar cinco niveles
 * cada vez.
 */
export function defaultBrowseRoot(): string {
  return homedir();
}

/**
 * Lista los subdirectorios de una carpeta.
 *
 * `path` vacío o inexistente cae a la carpeta personal en vez de fallar:
 * quien abre el explorador por primera vez no ha elegido nada todavía, y
 * un error ahí sería un error por no haber hecho nada.
 */
export async function browseDirectory(path?: string): Promise<IBrowseListing> {
  const pedida = path?.trim();
  const objetivo = pedida ? resolve(pedida) : defaultBrowseRoot();

  if (!(await esDirectorio(objetivo))) {
    return {
      ok: false,
      path: objetivo,
      parent: dirname(objetivo),
      entries: [],
      truncated: false,
      reason: `'${objetivo}' is not a folder, or cannot be opened.`,
    };
  }

  let crudas: Array<{ name: string; isDirectory(): boolean; isSymbolicLink(): boolean }>;
  try {
    crudas = await readdir(objetivo, { withFileTypes: true });
  } catch (error) {
    return {
      ok: false,
      path: objetivo,
      parent: dirname(objetivo),
      entries: [],
      truncated: false,
      reason: `'${objetivo}' could not be read: ${(error as Error).message}`,
    };
  }

  const directorios = crudas
    .filter((e) => e.isDirectory() || e.isSymbolicLink())
    // Las ocultas fuera: quien las necesite puede escribir la ruta. Con
    // ellas, la carpeta personal empieza con treinta entradas de
    // configuración antes de la primera que a alguien le interesa.
    .filter((e) => !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  const recortado = directorios.length > MAXIMO;
  const entries: IBrowseEntry[] = [];

  for (const nombre of directorios.slice(0, MAXIMO)) {
    const completa = join(objetivo, nombre);
    entries.push({
      name: nombre,
      path: completa,
      // Un enlace a un fichero, o a un directorio que ya no está, se
      // marca ilegible en vez de desaparecer: verlo y no poder entrar
      // se entiende; que no salga parece que el explorador falla.
      readable: await esDirectorio(completa),
    });
  }

  // La raíz no tiene padre, y devolverse a sí misma haría que el botón
  // de subir pareciera roto.
  const raiz = parse(objetivo).root;
  const parent = objetivo === raiz ? null : dirname(objetivo);

  return {
    ok: true,
    path: objetivo,
    parent,
    entries,
    truncated: recortado,
    ...(recortado
      ? {
          reason:
            `Only the first ${MAXIMO} folders are listed, of ${directorios.length}. ` +
            "Type the path directly to reach one that is not here.",
        }
      : {}),
  };
}

/** Los separadores de la ruta, para pintar migas de pan. */
export function breadcrumbs(path: string): ReadonlyArray<IBrowseEntry> {
  const absoluta = resolve(path);
  const raiz = parse(absoluta).root;
  const partes = absoluta.slice(raiz.length).split(sep).filter(Boolean);

  const migas: IBrowseEntry[] = [{ name: raiz, path: raiz, readable: true }];
  let acumulada = raiz;
  for (const parte of partes) {
    acumulada = join(acumulada, parte);
    migas.push({ name: parte, path: acumulada, readable: true });
  }
  return migas;
}
