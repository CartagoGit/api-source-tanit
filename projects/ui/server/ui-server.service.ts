/**
 * El transporte de `expostman ui`: puerto, seguridad y apagado.
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

/** Levanta la interfaz y devuelve dónde ha quedado escuchando. */
export function startUiServer(options: IUiServerOptions): IUiServer {
  const desde = options.port ?? DEFAULT_UI_PORT;

  for (let intento = 0; intento < INTENTOS; intento++) {
    const port = desde + intento;
    try {
      const server = Bun.serve({
        port,
        hostname: HOST,
        fetch: async (request) => {
          const { pathname } = new URL(request.url);

          // La interfaz, servida desde memoria.
          if (pathname === "/" || pathname === "/index.html") {
            return new Response(options.html, {
              status: 200,
              headers: {
                "content-type": "text/html; charset=utf-8",
                // Nada de esto sale de la máquina, pero una interfaz que
                // ejecuta lo que le manden es una interfaz prestada.
                "content-security-policy":
                  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
              },
            });
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
                    nextAction: "Es un fallo de la interfaz; recarga la página.",
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
