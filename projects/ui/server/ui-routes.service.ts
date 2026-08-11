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
import type { ISettings } from "../../contracts/interfaces/cli/settings.interface.js";

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
    /**
     * Los idiomas, para que la página pinte su selector.
     *
     * Va aparte de `/api/capabilities` porque cambia por otro motivo:
     * los formatos y los frameworks son del producto, y los idiomas son
     * de quien lo usa —puede añadir uno dejando un fichero, y entonces
     * esta respuesta cambia sin que el producto haya cambiado—.
     */
    case "/api/locales": {
      const catalogo = deps.locales();
      return {
        status: 200,
        body: {
          ok: true,
          locales: catalogo.locales.map((l) => ({
            code: l.code,
            nativeName: l.nativeName,
            rtl: l.rtl,
            origin: l.origin,
            translations: l.translations,
          })),
          // Los ficheros que alguien dejó y no se pudieron leer. Van en
          // la respuesta y no en un log del servidor porque quien los
          // escribió está mirando la interfaz, no la terminal.
          rejected: catalogo.rejected,
        },
      };
    }

    /**
     * Los ajustes guardados.
     *
     * Van por su propia ruta porque son de quien usa la interfaz, no del
     * producto — igual que los idiomas.
     */
    case "/api/settings": {
      const { settings, problem } = await deps.readSettings();
      return {
        status: 200,
        body: {
          ok: true,
          settings,
          // El motivo por el que no se pudieron usar los guardados, si
          // lo hay. Viaja a la interfaz y no a un log: unos ajustes que
          // desaparecen sin explicación parecen un fallo del programa.
          problem,
        },
      };
    }

    /**
     * Guarda unos cuantos ajustes.
     *
     * No hay botón de guardar: la interfaz llama aquí al tocar un
     * control. Un botón se olvida, y entonces el ajuste que alguien
     * cambió no está la próxima vez, que es justo lo que unos ajustes
     * persistentes vienen a evitar.
     */
    case "/api/settings/save": {
      // Se reutilizan los lectores del propio fichero en vez de escribir
      // otros: dos formas de leer «una cadena no vacía» acaban difiriendo
      // en el caso raro, que es el que rompe.
      const locale = texto(body, "locale");
      const theme = texto(body, "theme");
      const proyecto = texto(body, "lastProjectRoot");
      const salida = texto(body, "lastOutputDir");
      const framework = texto(body, "lastFramework");
      const formatos = lista(body, "lastFormats");

      // Se construye de una vez y no campo a campo: los ajustes son
      // `readonly`, y eso es a propósito — un objeto que se muta a
      // trozos acaba guardándose a medias cuando alguien añade un
      // `return` temprano.
      const cambios: Partial<Omit<ISettings, "version">> = {
        ...(locale ? { locale } : {}),
        ...(theme ? { theme: theme as ISettings["theme"] } : {}),
        ...(proyecto ? { lastProjectRoot: proyecto } : {}),
        ...(salida ? { lastOutputDir: salida } : {}),
        ...(framework ? { lastFramework: framework } : {}),
        ...(formatos && formatos.length > 0 ? { lastFormats: formatos } : {}),
      };

      if (Object.keys(cambios).length === 0) {
        return fail(
          400,
          "No recognised setting was sent.",
          "Send at least one of: locale, theme, lastProjectRoot, lastOutputDir, " +
            "lastFormats, lastFramework.",
        );
      }

      return { status: 200, body: { ok: true, settings: await deps.patchSettings(cambios) } };
    }

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
          `The folder '${projectRoot}' does not exist.`,
          "Check the path: it has to be the project root, where its manifest lives.",
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
            "No routes were recognised. If you know which framework it is, " +
            "you can force it; if the project has no routes yet, this is correct.",
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
        return fail(404, `The folder '${projectRoot}' does not exist.`, "Comprueba la ruta.");
      }
      const formats = lista(body, "formats");
      const desconocidos = (formats ?? []).filter((f) => !deps.formats().includes(f));
      if (desconocidos.length > 0) {
        return fail(
          400,
          `Unknown formats: ${desconocidos.join(", ")}.`,
          `Valid ones are: ${deps.formats().join(", ")}.`,
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
        `Nothing at '${path}'.`,
        "Available routes: /api/locales, /api/settings, /api/settings/save, " +
          "/api/capabilities, /api/inspect, /api/generate.",
      );
  }
}
