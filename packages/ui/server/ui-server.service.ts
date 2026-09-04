/**
 * El transporte de `apisrc ui`: puerto, seguridad y apagado.
 *
 * Sobre `Bun.serve`, que **ya está en el runtime que el binario lleva
 * dentro**. Eso es lo que hace que la interfaz no añada ni una
 * dependencia, y lo que descartó Electron: 150 MB por plataforma para
 * envolver exactamente lo mismo.
 *
 * Tres decisiones que no son negociables:
 *
 *   1. **Escucha solo en el bucle local** (`127.0.0.1`). Esto lee el
 *      código fuente del disco de quien lo usa; que sea alcanzable desde
 *      la red de la oficina no es una comodidad, es una filtración.
 *   2. **Busca un puerto libre** en vez de fallar. Un `EADDRINUSE` en
 *      una herramienta gráfica es un callejón sin salida para quien no
 *      sabe qué es un puerto.
 *   3. **Se apaga con SIGINT y SIGTERM.** Un servidor que no suelta el
 *      puerto obliga a buscar el proceso y matarlo a mano.
 */
import { handleUiRequest } from "./ui-routes.service.js";
import type { IUiServer, IUiServerOptions } from "../../contracts/interfaces/cli/ui.interface.js";
import { DEFAULT_UI_PORT } from "../../contracts/constants/cli/terminal.constant.js";

/** Solo el bucle local. Ver §1 de arriba. */
const HOST = "127.0.0.1";

/** Cuántos puertos se prueban antes de rendirse. */
const INTENTOS = 20;

/**
 * ¿Es un error de "puerto ocupado"?
 *
 * Se mira por el código y no por el mensaje: el texto cambia entre
 * sistemas y versiones, y un `includes("EADDRINUSE")` es de las cosas
 * que funcionan hasta que alguien actualiza algo.
 */
function puertoOcupado(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "EADDRINUSE";
}

/**
 * Un testigo nuevo por ejecución.
 *
 * `randomUUID` y no un contador ni la hora: tiene que ser imposible de
 * adivinar desde fuera, porque adivinarlo es exactamente el ataque.
 * Nuevo en cada arranque, así que cerrar y volver a abrir la interfaz
 * invalida cualquier página que hubiera quedado con el anterior.
 */
function nuevoTestigo(): string {
  return crypto.randomUUID();
}

/** Levanta la interfaz y devuelve dónde ha quedado escuchando. */
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

          // La interfaz, servida desde memoria, con el testigo dentro.
          //
          // El testigo va como atributo del `<script>` en vez de en una
          // cookie a propósito: una cookie la manda el navegador **sola**
          // en cualquier petición a este origen, incluidas las que
          // dispare otra web. Un atributo del HTML solo lo lee quien
          // puede leer el HTML, y eso es justo lo que la política de
          // mismo origen impide a un tercero.
          if (pathname === "/" || pathname === "/index.html") {
            return new Response(
              options.html.replace("<script>", `<script data-token="${testigo}">`),
              {
              status: 200,
              headers: {
                "content-type": "text/html; charset=utf-8",
                // Nada de esto sale de la máquina, pero una interfaz que
                // ejecuta lo que le manden es una interfaz prestada.
                "content-security-policy":
                  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
              },
              },
            );
          }

          /**
           * Solo contesta a la propia interfaz.
           *
           * Escuchar en `127.0.0.1` **no** basta, y esa es la trampa: el
           * servidor no es alcanzable desde la red, pero sí desde el
           * navegador de quien lo ejecuta. Cualquier web que esa persona
           * visite mientras la interfaz corre puede hacerle un POST aquí.
           *
           * Se probó: con `content-type: text/plain` —una petición
           * «simple», sin preflight— una página cualquiera conseguía que
           * `/api/generate` **escribiera ficheros donde quisiera**, vía
           * el `outputDir`. No podía leer la respuesta (eso sí lo corta
           * el navegador), pero el efecto ya había ocurrido.
           *
           * Dos comprobaciones, y las dos hacen falta:
           *
           *   · El **testigo**, que solo está en el HTML servido. Un
           *     tercero no puede leerlo.
           *   · El **origen**, cuando viene. Corta el caso antes incluso
           *     de mirar el cuerpo, y deja un mensaje que se entiende.
           *
           * Una petición sin `Origin` —curl, un test, un script— sí pasa:
           * ahí no hay navegador al que engañar, y bloquearla rompería el
           * uso legítimo desde la terminal sin ganar nada.
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
            // Se lee como texto y solo se parsea si hay algo. Un POST sin
            // cuerpo es legítimo —`/api/capabilities` no necesita
            // ninguno— y `json()` sobre un cuerpo vacío lanza: tratarlo
            // como «JSON inválido» hacía que la interfaz fallara nada
            // más cargar, en su primera petición.
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
