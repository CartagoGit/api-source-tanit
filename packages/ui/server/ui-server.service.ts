/**
 * The transport for `apisrc ui`: port, security and shutdown.
 *
 * Built on top of `Bun.serve`, which is **already in the runtime
 * the binary ships with**. That is what lets the interface add no
 * dependency, and what ruled out Electron: 150 MB per platform to
 * wrap exactly the same thing.
 *
 * Three decisions that are non-negotiable:
 *
 *   1. **Listens only on the local loopback** (`127.0.0.1`). This
 *      reads source code from the user's disk; being reachable from
 *      the office network is not a convenience, it is a leak.
 *   2. **Picks a free port** instead of failing. An `EADDRINUSE` in
 *      a graphical tool is a dead end for whoever does not know
 *      what a port is.
 *   3. **Shuts down on SIGINT and SIGTERM.** A server that does not
 *      release the port forces you to track down the process and
 *      kill it by hand.
 */
import { handleUiRequest } from "./ui-routes.service.js";
import type { IUiServer, IUiServerOptions } from "../../contracts/interfaces/cli/ui.interface.js";
import { DEFAULT_UI_PORT } from "../../contracts/constants/cli/terminal.constant.js";

/** Local loopback only. See §1 above. */
const HOST = "127.0.0.1";

/** How many ports we try before giving up. */
const INTENTOS = 20;

/**
 * Is this a "port already in use" error?
 *
 * We look at the code, not the message: the text changes across
 * systems and versions, and `includes("EADDRINUSE")` is the kind of
 * thing that works until somebody updates something.
 */
function puertoOcupado(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "EADDRINUSE";
}

/**
 * A fresh token per run.
 *
 * `randomUUID`, not a counter nor the time: it must be impossible
 * to guess from the outside, because guessing it is exactly the
 * attack. New on every boot, so closing and reopening the interface
 * invalidates any page that may have cached the previous one.
 */
function nuevoTestigo(): string {
  return crypto.randomUUID();
}

/** Starts the interface and returns where it ended up listening. */
export function startUiServer(options: IUiServerOptions): IUiServer {
  const desde = options.port ?? DEFAULT_UI_PORT;
  const testigo = nuevoTestigo();

  for (let intento = 0; intento < INTENTOS; intento++) {
    const port = desde + intento;
    try {
      const server = Bun.serve({
        port,
        hostname: HOST,
        fetch: async (request) => {
          const { pathname } = new URL(request.url);

          // The interface, served from memory, with the token embedded.
          //
          // The token lives as an attribute of the `<script>` rather
          // than in a cookie on purpose: a cookie is sent by the
          // browser **on its own** on any request to this origin,
          // including ones fired by another site. An HTML attribute
          // is only read by whoever can read the HTML, and that is
          // exactly what same-origin policy blocks for a third
          // party.
          if (pathname === "/" || pathname === "/index.html") {
            return new Response(
              options.html.replace("<script>", `<script data-token="${testigo}">`),
              {
              status: 200,
              headers: {
                "content-type": "text/html; charset=utf-8",
                // None of this leaves the machine, but an interface that runs
                // whatever it is told is a borrowed interface.
                "content-security-policy":
                  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
              },
              },
            );
          }

          /**
           * Only answers to the interface itself.
           *
           * Listening on `127.0.0.1` **is not** enough, and that is
           * the trap: the server is not reachable from the network,
           * but it is from the browser of whoever is running it.
           * Any web page that person visits while the interface is
           * up can POST here.
           *
           * It was tested: with `content-type: text/plain` — a
           * "simple" request, no preflight — any page could get
           * `/api/generate` to **write files wherever it wanted**,
           * via `outputDir`. It could not read the response (the
           * browser does block that), but the damage was already
           * done.
           *
           * Two checks, both needed:
           *
           *   · The **token**, which only lives in the served HTML.
           *     A third party cannot read it.
           *   · The **origin**, when present. It cuts the case
           *     before even looking at the body, and leaves a
           *     message that makes sense.
           *
           * A request without `Origin` — curl, a test, a script —
           * does pass: there is no browser to fool there, and
           * blocking it would break legitimate terminal use without
           * gaining anything.
           */
          const origen = request.headers.get("origin");
          if (origen !== null && origen !== `http://${HOST}:${port}`) {
            return Response.json(
              {
                ok: false,
                error: {
                  reason: `This interface does not answer requests from ${origen}.`,
                  nextAction:
                    "Use the page the server itself serves. A web page cannot " +
                    "drive this interface, and that is deliberate.",
                },
              },
              { status: 403 },
            );
          }
          if (request.headers.get("x-tanit-token") !== testigo) {
            return Response.json(
              {
                ok: false,
                error: {
                  reason: "Missing or wrong request token.",
                  nextAction:
                    "The page the server serves carries it. If you are calling " +
                    "the API by hand, read it from the `data-token` attribute " +
                    "of the page's <script>.",
                },
              },
              { status: 403 },
            );
          }

          if (!pathname.startsWith("/api/")) {
            return new Response("no encontrado", { status: 404 });
          }

          let body: Record<string, unknown> = {};
          if (request.method === "POST") {
            // We read it as text and only parse if there is something. A POST
            // without body is legitimate — `/api/capabilities` needs
            // none — and `json()` over an empty body throws: treating
            // it as "invalid JSON" made the interface fail on its
            // very first request at load.
            const crudo = (await request.text()).trim();
            try {
              const parsed = crudo === "" ? {} : (JSON.parse(crudo) as unknown);
              if (typeof parsed === "object" && parsed !== null) {
                body = parsed as Record<string, unknown>;
              }
            } catch {
              return Response.json(
                {
                  ok: false,
                  error: {
                    reason: "El cuerpo de la petición no es JSON válido.",
                    nextAction: "This is an interface bug; reload the page.",
                  },
                },
                { status: 400 },
              );
            }
          }

          const resultado = await handleUiRequest(pathname, body, options.deps);
          return Response.json(resultado.body, { status: resultado.status });
        },
      });

      return {
        url: `http://${HOST}:${server.port}`,
        port: server.port,
        stop: () => server.stop(true),
      };
    } catch (error) {
      if (puertoOcupado(error)) continue;
      throw error;
    }
  }

  throw new Error(
    `No free port between ${desde} and ${desde + INTENTOS - 1}.\n` +
      "  · Cierra la otra instancia, o pasa `--port <n>`.",
  );
}
