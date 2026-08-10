/**
 * El resumen de calidad de lo que se acaba de generar.
 *
 * No es decoración. Lo que responde es la única pregunta que se hace
 * quien acaba de generar una colección: **¿está esto completo?** Y la
 * respuesta útil no es "42 endpoints", es "42 endpoints, 35 con reglas
 * leídas del código y 7 adivinadas" — porque esos 7 son los que hay que
 * mirar a mano.
 *
 * De ahí que las barras midan **cobertura** y no progreso: el progreso
 * ya terminó cuando esto se imprime.
 */

import { padEnd } from "./ansi.helper.js";
import type { IQualityMetrics } from "../contracts/interfaces/cli/ui.interface.js";
import type { IPainter } from "../contracts/interfaces/cli/ui.interface.js";

/** Ancho de la barra. Suficiente para leer la proporción de un vistazo. */
const BAR_WIDTH = 24;

/**
 * Una barra de cobertura.
 *
 * Con `total` a cero no se dibuja una barra vacía —que se lee como "0%,
 * mal"— sino un "no aplica": un proyecto sin endpoints de escritura no
 * tiene una cobertura de body del 0%, tiene que no viene al caso.
 */
export function bar(
  painter: IPainter,
  label: string,
  done: number,
  total: number,
  labelWidth = 12,
): string {
  const head = padEnd(label, labelWidth);
  if (total === 0) return `  ${head} ${painter.paint("no aplica", "gray")}`;

  const ratio = Math.max(0, Math.min(1, done / total));
  const filled = Math.round(ratio * BAR_WIDTH);
  const percent = Math.round(ratio * 100);

  // El color dice si hace falta mirarlo, y el umbral no es arbitrario:
  // por debajo de la mitad, la colección está más adivinada que leída.
  const color = ratio >= 0.9 ? "green" : ratio >= 0.5 ? "yellow" : "red";
  const track = painter.paint("█".repeat(filled), color) + painter.paint("░".repeat(BAR_WIDTH - filled), "gray");
  return `  ${head} ${track} ${String(done).padStart(3)}/${String(total).padEnd(3)} ${painter.paint(`${percent}%`, color)}`;
}

/** El bloque entero, listo para imprimir. */
export function renderDashboard(
  painter: IPainter,
  metrics: IQualityMetrics,
): string[] {
  const lines: string[] = [
    "",
    painter.style("  Resumen", "bold"),
    "",
    `  ${padEnd("Framework", 12)} ${painter.paint(metrics.framework, "cyan")}`,
    `  ${padEnd("Endpoints", 12)} ${metrics.requests} en ${metrics.folders} carpetas`,
    "",
    bar(painter, "Reglas", metrics.withRules, metrics.requests),
    bar(painter, "Bodies", metrics.withBody, metrics.writeEndpoints),
    "",
  ];

  // La evidencia va al lado del tipo a propósito: una detección
  // automática que no se puede contrastar hay que creérsela a ciegas.
  const authColor = metrics.auth.type === "none" ? "gray" : "green";
  lines.push(
    `  ${padEnd("Auth", 12)} ${painter.paint(metrics.auth.type, authColor)} ` +
      painter.paint(`— ${metrics.auth.evidence}`, "gray"),
  );

  if (metrics.warnings.length > 0) {
    lines.push("");
    for (const warning of metrics.warnings) {
      lines.push(`  ${painter.paint("⚠", "yellow")} ${warning}`);
    }
  }

  // Lo que hay que mirar a mano, dicho explícitamente. Un número de
  // cobertura sin la acción que sugiere es un dato, no una ayuda.
  const guessed = metrics.requests - metrics.withRules;
  if (guessed > 0) {
    lines.push(
      "",
      `  ${painter.paint("·", "gray")} ${guessed} endpoint(s) with no rules in the code: ` +
        "su body sale de la inferencia y conviene revisarlo.",
    );
  }

  lines.push("");
  return lines;
}
