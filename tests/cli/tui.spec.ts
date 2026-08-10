/**
 * Las piezas visuales del asistente.
 *
 * Se prueban solas porque son puras: dado un texto y un ancho, sale una
 * cadena. Lo que se comprueba no es que "quede bonito" —eso no se puede
 * medir— sino las tres cosas que se rompen de verdad y solo se ven en la
 * terminal de otra persona: que el color se apague cuando nadie mira,
 * que una celda coloreada no descuadre la tabla, y que una terminal
 * estrecha no parta las filas.
 */
import { describe, expect, test } from "vitest";

import {
  createPainter,
  padEnd,
  shouldUseColor,
  truncate,
  visibleWidth,
} from "../../projects/ui/ansi.helper";
import { DEFAULT_TERMINAL_WIDTH } from "../../projects/contracts/constants/cli/terminal.constant";
import { renderTable } from "../../projects/ui/table.helper";
import { bar, renderDashboard } from "../../projects/ui/dashboard.helper";

const color = createPainter(true);
const plain = createPainter(false);

describe("cuándo hay color", () => {
  // https://no-color.org — si está, no hay color, valga lo que valga.
  test("`NO_COLOR` gana a todo, incluso a un TTY", () => {
    expect(shouldUseColor({ NO_COLOR: "" }, true)).toBe(false);
    expect(shouldUseColor({ NO_COLOR: "1", FORCE_COLOR: "1" }, true)).toBe(false);
  });

  // Un pipe o un fichero no dibujan: ahí el color es basura en el texto.
  test("sin TTY no se pinta", () => {
    expect(shouldUseColor({}, false)).toBe(false);
  });

  test("`FORCE_COLOR` lo enciende aunque no sea un TTY", () => {
    expect(shouldUseColor({ FORCE_COLOR: "1" }, false)).toBe(true);
  });

  test("`FORCE_COLOR=0` no cuenta como encenderlo", () => {
    expect(shouldUseColor({ FORCE_COLOR: "0" }, false)).toBe(false);
  });

  test("`TERM=dumb` lo apaga", () => {
    expect(shouldUseColor({ TERM: "dumb" }, true)).toBe(false);
  });

  test("con TTY y sin nada raro, sí", () => {
    expect(shouldUseColor({ TERM: "xterm-256color" }, true)).toBe(true);
  });

  test("un pintor apagado devuelve el texto intacto", () => {
    expect(plain.paint("hola", "green")).toBe("hola");
    expect(plain.style("hola", "bold", "red")).toBe("hola");
  });
});

describe("ancho visible", () => {
  // El fallo clásico de alinear texto con color: los códigos de escape
  // ocupan cero en pantalla y mucho en el string.
  test("las secuencias ANSI no cuentan", () => {
    const painted = color.paint("GET", "green");
    expect(painted.length).toBeGreaterThan(3);
    expect(visibleWidth(painted)).toBe(3);
  });

  test("`padEnd` rellena por lo visible, no por lo real", () => {
    expect(visibleWidth(padEnd(color.paint("GET", "green"), 8))).toBe(8);
    expect(visibleWidth(padEnd("GET", 8))).toBe(8);
  });

  test("`truncate` respeta el ancho pedido", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
    expect(visibleWidth(truncate(color.paint("abcdefghij", "red"), 5))).toBe(5);
  });

  test("`truncate` no toca lo que ya cabe", () => {
    expect(truncate("abc", 10)).toBe("abc");
  });
});

describe("la tabla", () => {
  const columns = [
    { header: "Método", min: 6 },
    { header: "URI", min: 10 },
  ];
  const rows = [
    ["GET", "/api/users"],
    ["DELETE", "/api/users/{{id}}"],
  ];

  test("cabecera, separador y una línea por fila", () => {
    const lines = renderTable(columns, rows, 60);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(/^─+\s+─+$/);
  });

  test("todas las filas miden lo mismo salvo el recorte final", () => {
    const lines = renderTable(columns, rows, 60);
    // Se compara la posición donde empieza la segunda columna.
    const starts = lines.map((l) => l.indexOf("/") === -1 ? null : l.indexOf("/"));
    const real = starts.filter((s): s is number => s !== null);
    expect(new Set(real).size).toBe(1);
  });

  // Una tabla más ancha que la ventana la parte el emulador por donde le
  // apetece, y deja de ser una tabla.
  test("nunca se pasa del ancho dado", () => {
    for (const width of [20, 30, 40, 80]) {
      for (const line of renderTable(columns, rows, width)) {
        expect(visibleWidth(line), `ancho ${width}: ${line}`).toBeLessThanOrEqual(width);
      }
    }
  });

  /**
   * Recortar todas las columnas por igual acaba dejando el método en
   * `GE`, que no dice nada, mientras la URI sigue sobrando. Se recorta la
   * más ancha.
   */
  test("el recorte respeta el mínimo de cada columna", () => {
    const lines = renderTable(columns, rows, 22);
    expect(lines[2]).toContain("GET");
    expect(lines[3]).toContain("DELETE");
  });

  test("con celdas de color el alineado se mantiene", () => {
    const painted = [[color.paint("GET", "green"), "/a"], [color.paint("POST", "yellow"), "/b"]];
    const lines = renderTable(columns, painted, 60);
    expect(lines[2]?.indexOf("/a")).toBe(lines[3]?.indexOf("/b"));
  });

  test("sin columnas no dibuja nada", () => {
    expect(renderTable([], [], 80)).toEqual([]);
  });

  test("sin filas deja la cabecera", () => {
    expect(renderTable(columns, [], 80)).toHaveLength(2);
  });

  test("no deja espacios de relleno al final de la línea", () => {
    for (const line of renderTable(columns, rows, 80)) {
      expect(line).toBe(line.trimEnd());
    }
  });
});

describe("las barras del resumen", () => {
  test("miden cobertura, con su fracción y su porcentaje", () => {
    const line = bar(plain, "Reglas", 5, 9);
    expect(line).toContain("5/9");
    expect(line).toContain("56%");
  });

  test("lo lleno y lo vacío suman siempre lo mismo", () => {
    for (const [done, total] of [[0, 10], [5, 10], [10, 10], [3, 7]] as const) {
      const line = bar(plain, "x", done, total);
      const filled = (line.match(/█/g) ?? []).length;
      const empty = (line.match(/░/g) ?? []).length;
      expect(filled + empty, `${done}/${total}`).toBe(24);
    }
  });

  /**
   * Un proyecto sin endpoints de escritura no tiene una cobertura de
   * body del 0% — tiene que no viene al caso. Una barra vacía se lee
   * como "mal".
   */
  test("con total cero dice `no aplica`, no 0%", () => {
    const line = bar(plain, "Bodies", 0, 0);
    expect(line).toContain("no aplica");
    expect(line).not.toContain("0%");
  });

  test("no se sale de la barra aunque `done` pase de `total`", () => {
    const line = bar(plain, "x", 20, 10);
    expect((line.match(/█/g) ?? []).length).toBe(24);
  });
});

describe("el resumen entero", () => {
  const metrics = {
    framework: "express",
    requests: 9,
    folders: 3,
    withRules: 5,
    writeEndpoints: 5,
    withBody: 5,
    auth: { type: "bearer", evidence: "hay un endpoint de login" },
    warnings: ["dos frameworks a la vez"],
  };

  test("enseña framework, endpoints, barras y auth", () => {
    const text = renderDashboard(plain, metrics).join("\n");
    expect(text).toContain("express");
    expect(text).toContain("9 en 3 carpetas");
    expect(text).toContain("Reglas");
    expect(text).toContain("bearer");
  });

  // Una detección automática que no se puede contrastar hay que
  // creérsela a ciegas.
  test("la evidencia del auth va al lado del tipo", () => {
    expect(renderDashboard(plain, metrics).join("\n")).toContain("hay un endpoint de login");
  });

  test("los avisos se listan", () => {
    expect(renderDashboard(plain, metrics).join("\n")).toContain("dos frameworks a la vez");
  });

  // Un número de cobertura sin la acción que sugiere es un dato, no una
  // ayuda.
  test("dice cuántos endpoints hay que mirar a mano", () => {
    expect(renderDashboard(plain, metrics).join("\n")).toContain("4 endpoint(s) sin reglas");
  });

  test("con todo cubierto no sugiere revisar nada", () => {
    const perfect = { ...metrics, withRules: 9 };
    expect(renderDashboard(plain, perfect).join("\n")).not.toContain("sin reglas en el código");
  });
});

describe("el ancho por defecto", () => {
  test("es un ancho de terminal razonable", () => {
    expect(DEFAULT_TERMINAL_WIDTH).toBe(80);
  });
});
