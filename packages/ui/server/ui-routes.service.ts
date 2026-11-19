/**
 * What the interface replies to each request, without knowing about
 * HTTP.
 *
 * This is a function from `(path, body)` to `(status, data)`. It
 * does not touch `Bun.serve`, does not open ports and does not read
 * `process.argv`: it is given what it needs. That is why it can be
 * tested in full without bringing anything up, which is what
 * separates an interface with tests from one tested by hand.
 *
 * Transport — the port, the CORS, the clean shutdown — lives in
 * `ui-server.service.ts`. Only the response is here.
 *
 * No route reimplements product logic: every route calls the same
 * pipeline the CLI uses. The interface is another door to the same
 * place, not a second implementation that drifts.
 */
import type { IUiDeps, IUiResponse } from "../../contracts/interfaces/cli/ui.interface.js";
import type { ISettings } from "../../contracts/interfaces/cli/settings.interface.js";
import { THEME_MODES } from "../../contracts/constants/cli/theme.constant.js";

const ok = (body: unknown): IUiResponse => ({ status: 200, body });

/**
 * An error the user can read and act on.
 *
 * It always carries `nextAction`: a message that says what happened
 * but not what to do leaves them just as stuck, and in a graphical
 * interface that hurts more because there is no `--help` at hand.
 */
const fail = (status: number, reason: string, nextAction: string): IUiResponse => ({
  status,
  body: { ok: false, error: { reason, nextAction } },
});

/** A request's body, already parsed. */
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
 * Resolves an interface request.
 *
 * `path` without query. `body` is `{}` for the read-only ones.
 */
export async function handleUiRequest(
  path: string,
  body: Body,
  deps: IUiDeps,
): Promise<IUiResponse> {
  switch (path) {
    /** What the interface needs to render itself: formats and frameworks. */
    /**
     * The locales, so the page can paint its selector.
     *
     * It lives apart from `/api/capabilities` because it changes for
     * a different reason: formats and frameworks belong to the
     * product, and locales belong to the user — anyone can add one
     * by dropping in a file, and this response changes without the
     * product having changed.
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
          // The files someone left and could we not read. They go in the
          // response, not in a server log, because whoever wrote
          // them is looking at the interface, not the terminal.
          rejected: catalogo.rejected,
        },
      };
    }

    /**
     * The saved settings.
     *
     * They live on their own route because they belong to the user
     * of the interface, not to the product — same as locales.
     */
    case "/api/settings": {
      const { settings, problem } = await deps.readSettings();
      return {
        status: 200,
        body: {
          ok: true,
          settings,
          // Why the saved settings could not be used, if so. It travels to
          // the interface, not to a log: settings that vanish
          // without explanation look like a program bug.
          problem,
        },
      };
    }

    /**
     * Saves a few settings.
     *
     * There is no save button: the interface calls here as soon as a
     * control is touched. A button is forgettable, and then the
     * setting someone changed is gone next time — which is exactly
     * what persistent settings exist to avoid.
     */
    case "/api/settings/save": {
      // We reuse the readers from the file itself rather than writing
      // our own: two ways of reading "a non-empty string" end up
      // differing in the rare case, which is the one that breaks.
      const locale = texto(body, "locale");
      const theme = texto(body, "theme");
      const proyecto = texto(body, "lastProjectRoot");
      const salida = texto(body, "lastOutputDir");
      const framework = texto(body, "lastFramework");
      const formatos = lista(body, "lastFormats");

      // Audit 2026-09-04 P3 #21 (settings validation on write):
      // previously `theme` was cast to `ISettings["theme"]` without
      // validation; a POST with theme="banana" would save OK and
      // only be sanitised on the next read, with the effect
      // "successful save → restart → setting gone". We validate the
      // write the same way the read does: if it is not in
      // THEME_MODES, an immediate 400, with nothing written to disk.
      if (theme && !THEME_MODES.includes(theme as ISettings["theme"] & string)) {
        return fail(
          400,
          `theme "${theme}" no es válido.`,
          `Valores admitidos: ${THEME_MODES.join(", ")}.`,
        );
      }

      // We build it in one go and not field by field: the settings are
      // `readonly`, on purpose — an object mutated piecemeal ends up
      // being saved halfway when someone adds an early `return`.
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

    /**
     * Browse folders, to pick source and destination without typing
     * the path by hand — where the most mistakes happen: a typo
     * returns "does not exist" and leaves no clue where you were.
     */
    case "/api/browse":
      // The listing already carries its own `ok`, which says whether
      // the folder could be read. We respect it as is instead of
      // forcing it to `true`: a folder without permission is a
      // legitimate answer from the explorer, not a route failure.
      return ok({ ...(await deps.browse(texto(body, "path"))) });

    /**
     * The rehearsal. It shows which files would come out and
     * **which would be overwritten**, which is what actually matters
     * from the second time on.
     */
    case "/api/dry-run": {
      const projectRoot = texto(body, "projectRoot");
      if (!projectRoot) {
        return fail(
          400,
          "No project folder was given.",
          "Pick the project root: the folder where its manifest lives.",
        );
      }
      if (!(await deps.exists(projectRoot))) {
        return fail(
          404,
          `The folder '${projectRoot}' does not exist.`,
          "Check the path: it has to be the project root, where its manifest lives.",
        );
      }

      const plan = await deps.dryRun({
        projectRoot,
        outputDir: texto(body, "outputDir"),
        formats: lista(body, "formats"),
        framework: texto(body, "framework"),
      });

      // An invalid plan — a format that does not exist — is a 400:
      // something impossible was requested, the rehearsal did not
      // fail.
      if (!plan.ok) {
        return fail(
          400,
          plan.reason ?? "The plan is not valid.",
          "Pick formats from the list the interface offers.",
        );
      }
      return ok({ ok: true, plan });
    }

    case "/api/capabilities":
      return ok({
        ok: true,
        formats: deps.formats(),
        frameworks: deps.frameworks(),
        /**
         * Which formats Postman imports. Not decoration: `bruno` is
         * another product's native format, and offering it as
         * equivalent — without saying it must be opened there — would
         * be misleading anyone who picks it expecting to reimport in
         * Postman.
         */
        postmanImportable: deps.formats().filter((f) => f !== "bruno"),
      });

    /**
     * Shows what was detected **before** writing anything.
     *
     * It is the step the terminal assistant already does well, and
     * the one that avoids the surprise of finding a new folder you
     * did not ask for.
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
          // Not an error: a project with no routes yet is legitimate. But
          // saying so here prevents generating an empty collection
          // that looks like a tool failure.
          notice:
            "No routes were recognised. If you know which framework it is, " +
            "you can force it; if the project has no routes yet, this is correct.",
        });
      }
      return ok({ ok: true, summary });
    }

        /** Generates for real. Only after the detected view has been shown. */
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

      /**
       * The forced framework is validated against the catalogue before
       * reaching the pipeline: rejecting it here is an actionable
       * 400 with the exact list; letting it through only to have
       * the pipeline silently ignore it would produce the opposite
       * of what the user asked for.
       */
      const framework = texto(body, "framework");
      if (framework && !deps.frameworks().includes(framework)) {
        return fail(
          400,
          `Unknown framework: ${framework}.`,
          `Valid ones are: ${deps.frameworks().join(", ")}.`,
        );
      }

      const outputDir = texto(body, "outputDir");

      const result = await deps.generate({
        projectRoot,
        ...(outputDir ? { outputDir } : {}),
        ...(formats ? { formats } : {}),
        ...(framework ? { framework } : {}),
      });

      /**
       * Writing outside the project is a legitimate use — collecting
       * several collections in one place — but it cannot look like
       * just another warning in the result: we say **where** the
       * output will appear, and only when the chosen folder is not
       * the one inside the project.
       */
      const avisoDestino =
        outputDir && outputDir !== `${projectRoot}/tanit`
          ? `The output was written outside the project: ${result.collectionPath ?? outputDir}.`
          : undefined;

      return ok({
        ok: true,
        result,
        ...(avisoDestino ? { notice: avisoDestino } : {}),
      });
    }

    /**
     * Generation history, for the dashboard.
     *
     * Returns the last N entries (`limit`, 20 by default) and lets
     * the UI render them without having to re-read each project.
     * A `projectRoot` filters to a single project; without it, all
     * of them.
     *
     * Not decorative: the route exists **because** the page calls
     * it on load, and rendering it as part of the main form is what
     * materialises FEAT-001 (multi-project dashboard).
     */
    case "/api/history": {
      const limitText = body["limit"];
      const limitNum =
        typeof limitText === "number" && Number.isInteger(limitText) && limitText > 0
          ? limitText
          : undefined;
      const projectRootText = texto(body, "projectRoot");
      const history = await deps.history({
        ...(limitNum !== undefined ? { limit: limitNum } : {}),
        ...(projectRootText !== undefined ? { projectRoot: projectRootText } : {}),
      });
      return ok(history);
    }

    default:
      return fail(
        404,
        `Nothing at '${path}'.`,
        "Available routes: /api/locales, /api/settings, /api/settings/save, " +
          "/api/browse, /api/dry-run, /api/capabilities, /api/inspect, " +
          "/api/generate, /api/history.",
      );
  }
}
