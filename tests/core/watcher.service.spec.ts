/**
 * El vigilante de ficheros.
 *
 * El test que más importa de este fichero es el de la carpeta de salida.
 * La herramienta **escribe dentro de lo que vigila**: la colección va a
 * `<proyecto>/export-to-postman/`, que cuelga de la raíz observada. Un
 * watcher que no la ignore ve su propia escritura, regenera, escribe, se
 * ve otra vez — y no para nunca. Es la misma forma del bucle infinito
 * que se llevó por delante una sesión entera de WSL en este repo.
 */
import { describe, expect, test, vi } from "vitest";

import { createDebouncer, shouldIgnore } from "../../projects/core/domain/watcher.service";
import { OUTPUT_DIR_NAME } from "../../projects/contracts/constants/core/postman.constant";
import { DEFAULT_DEBOUNCE_MS } from "../../projects/contracts/constants/core/runtime-limits.constant";
import { IGNORED_DIRS } from "../../projects/contracts/constants/core/watch.constant";

describe("shouldIgnore", () => {
  // EL test. Sin esto, el watcher se retroalimenta.
  test("la carpeta de salida se ignora, que es lo que evita el bucle", () => {
    expect(shouldIgnore(`${OUTPUT_DIR_NAME}/api.postman_collection.json`)).toBe(true);
  });

  test("y también anidada dentro del proyecto", () => {
    expect(shouldIgnore(`packages/api/${OUTPUT_DIR_NAME}/x.json`)).toBe(true);
  });

  test("está en la lista de siempre, no depende de que se configure", () => {
    expect(IGNORED_DIRS.has(OUTPUT_DIR_NAME)).toBe(true);
  });

  test.each(["node_modules", "vendor", ".git", "dist", "__pycache__", ".venv"])(
    "%s se ignora",
    (dir) => {
      expect(shouldIgnore(`${dir}/algo.js`)).toBe(true);
    },
  );

  test("un fichero de rutas de verdad NO se ignora", () => {
    expect(shouldIgnore("src/routes/users.route.ts")).toBe(false);
    expect(shouldIgnore("app/Http/Controllers/UserController.php")).toBe(false);
    expect(shouldIgnore("routes/api.php")).toBe(false);
  });

  test("los temporales de editor se ignoran", () => {
    expect(shouldIgnore("src/users.ts~")).toBe(true);
    expect(shouldIgnore("src/.users.ts.swp")).toBe(true);
  });

  test("una ruta vacía se ignora en vez de reventar", () => {
    expect(shouldIgnore("")).toBe(true);
    expect(shouldIgnore(".")).toBe(true);
  });

  test("se pueden añadir carpetas extra sin perder las de siempre", () => {
    const extra = new Set(["mis-cosas"]);
    expect(shouldIgnore("mis-cosas/x.ts", extra)).toBe(true);
    expect(shouldIgnore("node_modules/x.ts", extra)).toBe(true);
    expect(shouldIgnore("src/x.ts", extra)).toBe(false);
  });

  test("funciona con separadores de Windows", () => {
    expect(shouldIgnore(`node_modules\\paquete\\index.js`)).toBe(true);
    expect(shouldIgnore(`src\\routes\\users.ts`)).toBe(false);
  });
});

describe("createDebouncer", () => {
  test("agrupa varios cambios seguidos en una sola llamada", async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createDebouncer(100, fn);
    d.trigger("a");
    d.trigger("b");
    d.trigger("c");
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(["a", "b", "c"]);
    vi.useRealTimers();
  });

  test("no repite la misma ruta en el lote", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createDebouncer(50, fn);
    d.trigger("a");
    d.trigger("a");
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledWith(["a"]);
    vi.useRealTimers();
  });

  test("el reloj se reinicia con cada cambio", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createDebouncer(100, fn);
    d.trigger("a");
    vi.advanceTimersByTime(80);
    d.trigger("b");
    vi.advanceTimersByTime(80);
    // Han pasado 160 ms pero solo 80 desde el último: aún no.
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test("el lote se vacía tras dispararse", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createDebouncer(10, fn);
    d.trigger("a");
    vi.advanceTimersByTime(10);
    d.trigger("b");
    vi.advanceTimersByTime(10);
    expect(fn).toHaveBeenNthCalledWith(2, ["b"]);
    vi.useRealTimers();
  });

  // Sin `cancel`, el proceso no termina al hacer Ctrl+C: queda un timer
  // pendiente y el event loop sigue teniendo trabajo.
  test("cancel evita el disparo pendiente", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createDebouncer(50, fn);
    d.trigger("a");
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
    expect(d.pending()).toBe(0);
    vi.useRealTimers();
  });

  test("el valor por defecto es razonable para un Ctrl+S", () => {
    expect(DEFAULT_DEBOUNCE_MS).toBeGreaterThan(50);
    expect(DEFAULT_DEBOUNCE_MS).toBeLessThan(1000);
  });
});
