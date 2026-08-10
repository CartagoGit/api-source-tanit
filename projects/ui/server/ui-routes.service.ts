/**
 * Qué contesta la interfaz a cada petición, sin saber de HTTP.
 *
 * Esto es una función de `(ruta, cuerpo)` a `(estado, datos)`. No toca
 * `Bun.serve`, no abre puertos y no lee `process.argv`: se le pasa lo
 * que necesita. Por eso se puede probar entera sin levantar nada, que
 * es lo que separa una interfaz con tests de una que se prueba a mano.
 *
 * El transporte —el puerto, los CORS, el apagado limpio— vive en
 * `ui-server.service.ts`. Aquí solo está la respuesta.
 *
 * Ninguna ruta reimplementa lógica de producto: todas llaman al mismo
 * pipeline que usa el CLI. La interfaz es otra puerta al mismo sitio,
 * no una segunda implementación que se desincronice.
 */
import type { IUiDeps, IUiResponse } from "../../contracts/interfaces/cli/ui.interface.js";

const ok = (body: unknown): IUiResponse => ({ status: 200, body });

/**
 * Un error que la persona puede leer y accionar.
 *
 * Siempre lleva `nextAction`: un mensaje que dice qué ha pasado y no qué
 * hacer deja igual de atascado, y en una interfaz gráfica eso se nota
 * más porque no hay `--help` a mano.
 */
const fail = (status: number, reason: string, nextAction: string): IUiResponse => ({
  status,
  body: { ok: false, error: { reason, nextAction } },
});

/** El cuerpo de una petición, ya parseado. */
type Body = Record<string, unknown>;

function texto(body: Body, clave: string): string | undefined {
  const v = body[clave];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function lista(body: Body, clave: string): string[] | undefined {
  const v = body[clave];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;
}

/**
 * Resuelve una petición de la interfaz.
 *
 * `path` sin query. `body` es `{}` para las de solo lectura.
 */
export async function handleUiRequest(
  path: string,
  body: Body,
  deps: IUiDeps,
): Promise<IUiResponse> {
  switch (path) {
    /** Lo que la interfaz necesita para dibujarse: formatos y frameworks. */
    case "/api/capabilities":
      return ok({
        ok: true,
        formats: deps.formats(),
        frameworks: deps.frameworks(),
      });

    /**
     * Enseña lo detectado **antes** de escribir nada.
     *
     * Es el paso que ya hace bien el asistente de terminal, y el que
     * evita la sorpresa de encontrarse una carpeta nueva sin haberla
     * pedido.
     */
    case "/api/inspect": {
      const projectRoot = texto(body, "projectRoot");
      if (!projectRoot) {
        return fail(400, "Falta la carpeta del proyecto.", "Elige la raíz de tu API.");
      }
      if (!(await deps.exists(projectRoot))) {
        return fail(
          404,
          `No existe la carpeta '${projectRoot}'.`,
          "Comprueba la ruta: tiene que ser la raíz del proyecto, donde está su manifiesto.",
        );
      }
      const summary = await deps.summarize(projectRoot);
      if (summary.routesInCode === 0) {
        return ok({
          ok: true,
          summary,
          // No es un error: un proyecto sin rutas todavía es legítimo.
          // Pero decirlo aquí evita generar una colección vacía y que
          // parezca que la herramienta falló.
          notice:
            "No se ha reconocido ninguna ruta. Si sabes de qué framework es, " +
            "puedes forzarlo; si el proyecto aún no tiene rutas, esto es correcto.",
        });
      }
      return ok({ ok: true, summary });
    }

    /** Genera de verdad. Solo después de que se haya visto lo detectado. */
    case "/api/generate": {
      const projectRoot = texto(body, "projectRoot");
      if (!projectRoot) {
        return fail(400, "Falta la carpeta del proyecto.", "Elige la raíz de tu API.");
      }
      if (!(await deps.exists(projectRoot))) {
        return fail(404, `No existe la carpeta '${projectRoot}'.`, "Comprueba la ruta.");
      }
      const formats = lista(body, "formats");
      const desconocidos = (formats ?? []).filter((f) => !deps.formats().includes(f));
      if (desconocidos.length > 0) {
        return fail(
          400,
          `Formatos que no existen: ${desconocidos.join(", ")}.`,
          `Los válidos son: ${deps.formats().join(", ")}.`,
        );
      }
      const result = await deps.generate({
        projectRoot,
        outputDir: texto(body, "outputDir"),
        ...(formats ? { formats } : {}),
      });
      return ok({ ok: true, result });
    }

    default:
      return fail(
        404,
        `No hay nada en '${path}'.`,
        "Rutas disponibles: /api/capabilities, /api/inspect, /api/generate.",
      );
  }
}
