/**
 * Vigilar el proyecto y avisar cuando algo cambia.
 *
 * El motivo de que esto exista es de flujo: quien añade un endpoint no
 * quiere acordarse de regenerar la colección. Pero el motivo de que
 * tenga tanto cuidado es otro, y es el que importa aquí.
 *
 * **La herramienta escribe DENTRO de lo que vigila.** La colección va a
 * `<proyecto>/export-to-postman/`, que cuelga de la misma raíz que se
 * está observando. Un watcher ingenuo ve su propia escritura, regenera,
 * vuelve a escribir, se ve otra vez — y no para. Es un bucle infinito
 * que se come el disco y la CPU, exactamente la forma del que se llevó
 * por delante una sesión entera de WSL en este mismo repo.
 *
 * Por eso la carpeta de salida se ignora **siempre**, no por
 * configuración, y por eso `shouldIgnore` es una función pura con sus
 * tests: es la pieza de la que depende que esto no se cuelgue.
 *
 * El otro cuidado es el rebote. Guardar un fichero en un editor puede
 * disparar varios eventos (escritura, renombrado del temporal, cambio de
 * atributos), y un `Ctrl+S` repetido dispara más. Sin agrupar, cada uno
 * lanzaría un escaneo completo del proyecto.
 */
import { watch, type FSWatcher } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";

import { OUTPUT_DIR_NAME } from "../contracts/postman.constant.js";

/** Cuánto se espera a que pare el teclado antes de regenerar. */
export const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Carpetas que nunca aportan rutas y sí mucho ruido.
 *
 * `node_modules` es el caso extremo: un `bun install` a medias dispara
 * miles de eventos y ninguno es un endpoint.
 */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  OUTPUT_DIR_NAME,
  "node_modules",
  "vendor",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "target",
  "out",
  ".next",
  ".nuxt",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
  "coverage",
  "tmp",
]);

/** Ficheros que cambian solos y no son código: temporales de editor. */
const IGNORED_FILE_RE = /(^\.|~$|\.swp$|\.swx$|\.tmp$|^\d+$)/;

/**
 * Si una ruta relativa debe ignorarse.
 *
 * Pura y exportada a propósito: es la pieza que evita el bucle
 * infinito, y una pieza así tiene que poder probarse sin montar un
 * sistema de ficheros.
 */
export function shouldIgnore(
  relativePath: string,
  extraIgnored: ReadonlySet<string> = new Set(),
): boolean {
  if (!relativePath || relativePath === ".") return true;
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  for (const segment of segments) {
    if (IGNORED_DIRS.has(segment)) return true;
    if (extraIgnored.has(segment)) return true;
  }
  const fileName = segments[segments.length - 1] ?? "";
  // Un fichero sin punto puede ser una carpeta; solo se filtran los que
  // parecen temporales.
  return IGNORED_FILE_RE.test(fileName);
}

/**
 * Agrupa llamadas seguidas en una sola, `ms` después de la última.
 *
 * Devuelve también un `cancel` para poder cerrar sin dejar un timer
 * suelto: sin él, el proceso no termina al hacer Ctrl+C porque el event
 * loop sigue teniendo trabajo pendiente.
 */
export function createDebouncer(
  ms: number,
  fn: (batch: readonly string[]) => void,
): { trigger(path: string): void; cancel(): void; pending(): number } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let batch: string[] = [];

  return {
    trigger(path: string): void {
      if (!batch.includes(path)) batch.push(path);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const current = batch;
        batch = [];
        timer = null;
        fn(current);
      }, ms);
    },
    cancel(): void {
      if (timer) clearTimeout(timer);
      timer = null;
      batch = [];
    },
    pending(): number {
      return batch.length;
    },
  };
}

export interface IWatchOptions {
  /** Raíz del proyecto a vigilar. */
  readonly root: string;
  /** Milisegundos de espera tras el último cambio. */
  readonly debounceMs?: number;
  /** Carpetas extra a ignorar, además de las de siempre. */
  readonly ignoreDirs?: ReadonlySet<string>;
  /** Qué hacer cuando un lote de cambios se asienta. */
  readonly onChange: (changed: readonly string[]) => void | Promise<void>;
}

/** Lo que devuelve `watchProject` para poder parar. */
export interface IWatchHandle {
  close(): void;
}

/**
 * Vigila `root` y llama a `onChange` con las rutas que han cambiado.
 *
 * Usa `fs.watch` recursivo, sin sondeo. Si el sistema operativo no lo
 * soporta —`recursive` no está en todos los BSD— lanza con un mensaje
 * que lo dice, en vez de quedarse mirando solo el primer nivel y no
 * enterarse de nada.
 *
 * Nunca hay dos `onChange` a la vez: si llega un cambio mientras se está
 * regenerando, se encola y se ejecuta después. Dos generaciones
 * simultáneas escribirían el mismo fichero a la vez.
 */
export function watchProject(options: IWatchOptions): IWatchHandle {
  const { root, onChange } = options;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const extraIgnored = options.ignoreDirs ?? new Set<string>();

  let running = false;
  let queued: string[] | null = null;

  async function run(batch: readonly string[]): Promise<void> {
    if (running) {
      // Se acumula en vez de perderse: quien guardó mientras se
      // regeneraba espera que su cambio también entre.
      queued = [...(queued ?? []), ...batch];
      return;
    }
    running = true;
    try {
      await onChange(batch);
    } finally {
      running = false;
      const next = queued;
      queued = null;
      if (next && next.length > 0) void run(next);
    }
  }

  const debouncer = createDebouncer(debounceMs, (batch) => void run(batch));

  let watcher: FSWatcher;
  try {
    watcher = watch(root, { recursive: true }, (_event, fileName) => {
      if (!fileName) return;
      const raw = fileName.toString();
      // `fs.watch` da la ruta **relativa** a la carpeta vigilada en Linux
      // y Windows, y absoluta en algunos casos de macOS. Hay que
      // distinguirlas: pasar una ruta ya relativa por `relative()` la
      // resuelve contra el cwd y sale un `../../../..` que no es nada.
      //
      // No es teórico: con el cwd en `/tmp/...` el resultado contenía un
      // segmento `tmp`, que está en la lista de ignorados, así que el
      // watcher descartaba **todos** los cambios y parecía no funcionar.
      const candidate = (isAbsolute(raw) ? relative(root, raw) : raw)
        .split(sep)
        .join("/");
      if (!candidate) return;
      if (shouldIgnore(candidate, extraIgnored)) return;
      debouncer.trigger(candidate);
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No se pudo vigilar ${root}: ${detail}\n` +
        "  El modo watch necesita `fs.watch` recursivo, que no está en todos\n" +
        "  los sistemas. Sin él solo se vería el primer nivel de carpetas, que\n" +
        "  es peor que no vigilar: parecería funcionar y no avisaría de nada.",
    );
  }

  return {
    close(): void {
      debouncer.cancel();
      watcher.close();
    },
  };
}
