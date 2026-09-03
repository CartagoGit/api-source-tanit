/**
 * f00010 S3: la tarjeta "evidencia + salud" en `index.html.constant.ts`.
 *
 * Lo que se fija aquí es el **contrato de render**, no la integración
 * (esa vive en `ui-server.test.ts`, que levanta `expostman ui` de
 * verdad). El contrato es:
 *
 *   1. La página lleva un contenedor `#deteccion` con la rejilla de
 *      evidencia y salud.
 *   2. Las clases CSS existen y los colores vienen de variables del
 *      tema, no de literales — así un cambio de tema pinta la sección
 *      sin tocarla.
 *   3. El JS pinta con `createElement` + `textContent`. Nunca
 *      `innerHTML = ...` con datos del summary: la señal, el peso, el
 *      archivo y los porcentajes van por `textContent`, porque
 *      `innerHTML` interpreta el contenido como HTML y un nombre de
 *      archivo con `<` o `&` rompería el render o abriría XSS.
 *   4. Hay emoji en los lugares que la propuesta pide: la brújula
 *      precede cada señal y un círculo de color (🟢 / 🟡 / 🔴) marca
 *      cada tramo de salud.
 *   5. La función `pintaDeteccion` está definida y se llama desde el
 *      handler de `/api/inspect`.
 *
 * Se prueba como string: la constante es el HTML completo. Si la
 * constante cambiase, se rompería el render en la máquina de quien la
 * usa — el peor tipo de fallo —, así que más vale que el contrato esté
 * escrito en un test que en un comentario.
 */
import { describe, expect, test } from "vitest";

import { UI_HTML } from "../../packages/ui/web/index.html.constant";

describe("f00010 S3 — sección de detección (evidencia + salud)", () => {
  test("la página lleva el contenedor con su título y dos bloques", () => {
    expect(UI_HTML).toMatch(/<section[^>]*id="deteccion"[^>]*>/);
    expect(UI_HTML).toContain('id="deteccion-titulo"');
    expect(UI_HTML).toContain('id="evidencia-lista"');
    expect(UI_HTML).toContain('id="salud-cuadro"');
    // Accesibilidad: la sección se anuncia por su título.
    expect(UI_HTML).toContain('aria-labelledby="deteccion-titulo"');
    // Los dos bloques pintables también son regiones en vivo.
    expect(UI_HTML).toContain('id="evidencia-lista" aria-live="polite"');
    expect(UI_HTML).toContain('id="salud-cuadro" aria-live="polite"');
  });

  test("todas las clases CSS de la tarjeta existen en el <style>", () => {
    for (const clase of [
      "deteccion",
      "deteccion-cuerpo",
      "deteccion-bloque",
      "deteccion-bloque-titulo",
      "evidencia-lista",
      "evidencia-item",
      "evidencia-senial",
      "evidencia-peso",
      "evidencia-archivo",
      "salud-grid",
      "salud-celda",
      "salud-celda--ok",
      "salud-celda--aviso",
      "salud-celda--error",
      "salud-etiqueta",
      "salud-porcentaje",
      "salud-barra",
      "salud-barra-relleno",
    ]) {
      // Cada clase debe aparecer como selector CSS, no solo como
      // valor de un atributo: `.${clase}{` o `.${clase} `.
      const patron = new RegExp(
        `\\.${clase.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}[\\s,{:]`,
      );
      expect(UI_HTML.match(patron), `falta la regla .${clase}`).not.toBeNull();
    }
  });

  test("los colores del bloque nuevo vienen de variables del tema", () => {
    // El bloque va desde `.deteccion {` hasta el último cierre de la
    // sección salud (justo antes del @media de reduced-motion).
    const inicio = UI_HTML.indexOf(".deteccion {");
    const fin = UI_HTML.indexOf(
      ".salud-celda--error .salud-porcentaje { color: var(--error); }",
    );
    expect(inicio).toBeGreaterThan(0);
    expect(fin).toBeGreaterThan(inicio);
    const bloque = UI_HTML.slice(
      inicio,
      fin + ".salud-celda--error .salud-porcentaje { color: var(--error); }".length,
    );
    // Ningún hexadecimal introducido por la sección.
    expect(bloque).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // Y se apoya en las variables ya definidas.
    expect(bloque).toContain("var(--ok)");
    expect(bloque).toContain("var(--aviso)");
    expect(bloque).toContain("var(--error)");
    expect(bloque).toContain("var(--borde)");
  });

  test("--aviso está definida en los cuatro bloques del tema", () => {
    // Cuatro bloques: :root por defecto, prefers-color-scheme dark,
    // [data-tema="dark"], [data-tema="light"]. Si uno se queda sin
    // la variable, las barras amarillas se pintan del color por
    // defecto del navegador.
    const matches = UI_HTML.match(/--aviso:\s*[^;]+;/g) ?? [];
    expect(matches.length).toBe(4);
  });

  test("las funciones de pintado existen y se llaman tras el inspect", () => {
    expect(UI_HTML).toMatch(/function\s+pintaDeteccion\s*\(/);
    expect(UI_HTML).toMatch(/function\s+pintaEvidencia\s*\(/);
    expect(UI_HTML).toMatch(/function\s+pintaSalud\s*\(/);
    // Quien inspecciona debe terminar llamando a pintaDeteccion(s).
    expect(UI_HTML).toMatch(/pintaDeteccion\(\s*s\s*\)/);
  });

  test("no se asigna innerHTML con datos del summary (XSS-safe)", () => {
    // Encontramos cada asignación `.innerHTML = ...` y la
    // clasificamos como segura si la parte derecha es exactamente la
    // cadena vacía (es lo que se usa para limpiar contenedores).
    // Cualquier otro valor se considera una regresión de XSS: los
    // nombres de archivo y las señales vienen del detector y pueden
    // traer `<`, `>`, `&` o comillas.
    const asignaciones = UI_HTML.match(/\.innerHTML\s*=[^;\n]*/g) ?? [];
    const problematicas = asignaciones.filter((a) => !/=\s*""\s*$/.test(a));
    expect(
      problematicas,
      `innerHTML con datos: ${problematicas.join(" | ")}`,
    ).toEqual([]);
  });

  test("los datos del summary se pintan con textContent", () => {
    // Cada campo que pintaDeteccion toca debe aparecer cerca
    // (≤ 400 chars) de un textContent, en cualquier dirección.
    // La heurística es laxa porque cubre el contrato sin parsear
    // JS: detecta la regresión típica (cambiar textContent por
    // innerHTML para "meter HTML") sin atarse a la forma exacta
    // del código.
    const campos = [
      "e.signal",
      "e.artifact",
      "valor",
      'pct + "%"',
      "emoji",
    ];
    for (const campo of campos) {
      const escaped = campo.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
      const re = new RegExp(
        `\\.textContent[\\s\\S]{0,400}${escaped}|${escaped}[\\s\\S]{0,400}\\.textContent`,
      );
      expect(
        UI_HTML.match(re),
        `campo "${campo}" sin textContent cercano`,
      ).not.toBeNull();
    }
  });

  test("los emojis de evidence + health están en la constante", () => {
    // La brújula precede cada señal de evidencia (en el CSS via
    // `content:`) y los círculos de color viven en el JS. Como el
    // HTML viaja dentro de `String.raw`, los escapes unicode se
    // preservan tal cual: el test admite las dos formas
    // (escapes o emojis literales) para no atarse a una sola.
    const escapes = [
      "\\u{1F9ED}", // 🧭 brújula
      "\\u{1F7E2}", // 🟢 verde
      "\\u{1F7E1}", // 🟡 amarillo
      "\\u{1F534}", // 🔴 rojo
    ];
    const literales = ["🧭", "🟢", "🟡", "🔴"];
    const todosComoEscape = escapes.every((e) => UI_HTML.includes(e));
    const todosComoLiteral = literales.every((e) => UI_HTML.includes(e));
    expect(todosComoEscape || todosComoLiteral).toBe(true);
  });

  test("los tres tramos de salud se eligen por porcentaje", () => {
    // Los umbrales (75 / 50) viven en el JS, no en el HTML como tal:
    // basta con que existan las tres ramas y los emoticonos
    // asociados. Si alguien cambia los tramos, este test le obliga
    // a mantener los tres.
    expect(UI_HTML).toMatch(/pct >= 75 \? "ok"/);
    expect(UI_HTML).toMatch(/pct >= 50 \? "aviso"/);
    expect(UI_HTML).toMatch(/: "error"/);
    // Y las clases CSS existen para los tres estados.
    expect(UI_HTML).toContain(".salud-celda--ok");
    expect(UI_HTML).toContain(".salud-celda--aviso");
    expect(UI_HTML).toContain(".salud-celda--error");
  });

  test("la tarjeta se esconde en errores y se muestra en aciertos", () => {
    // f00010 S3: si el inspect falla, la tarjeta no debe quedarse
    // con los datos del proyecto anterior. La cadena exacta puede
    // cambiar; lo que se fija es la estructura: dentro de la rama
    // !res.ok, antes del return, se hace hidden = true sobre el
    // contenedor.
    expect(UI_HTML).toMatch(
      /!res\.ok[\s\S]{0,400}\$\("deteccion"\)[\s\S]{0,80}hidden\s*=\s*true/,
    );
    // Y si acierta, se hace visible.
    expect(UI_HTML).toMatch(/seccion\.hidden\s*=\s*false/);
  });
});
