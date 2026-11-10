/**
 * f00010 S3: the "evidence + health" card in `index.html.constant.ts`.
 *
 * What is pinned here is the **render contract**, not the integration
 * (that lives in `ui-server.test.ts`, which actually starts
 * `expostman ui`). The contract is:
 *
 *   1. The page carries a `#deteccion` container with the evidence
 *      and health grid.
 *   2. The CSS classes exist and colors come from theme variables,
 *      not literals — that way a theme change paints the section
 *      without touching it.
 *   3. The JS paints with `createElement` + `textContent`. Never
 *      `innerHTML = ...` with summary data: the signal, the weight,
 *      the file and the percentages go through `textContent`,
 *      because `innerHTML` interprets content as HTML and a file
 *      name with `<` or `&` would break the render or open XSS.
 *   4. There are emojis where the proposal asks: the compass
 *      precedes each signal and a colored circle (🟢 / 🟡 / 🔴)
 *      marks each health band.
 *   5. The `pintaDeteccion` function is defined and called from the
 *      `/api/inspect` handler.
 *
 * It is tested as a string: the constant is the full HTML. If the
 * constant changed, the render would break on the user's machine —
 * the worst kind of failure —, so the contract is better written in
 * a test than in a comment.
 */
import { describe, expect, test } from "vitest";

import { UI_HTML } from "../../packages/ui/web/index.html.constant";

describe("f00010 S3 — detection section (evidence + health)", () => {
  test("the page carries the container with its title and two blocks", () => {
    expect(UI_HTML).toMatch(/<section[^>]*id="deteccion"[^>]*>/);
    expect(UI_HTML).toContain('id="deteccion-titulo"');
    expect(UI_HTML).toContain('id="evidencia-lista"');
    expect(UI_HTML).toContain('id="salud-cuadro"');
    // Accessibility: the section is announced by its title.
    expect(UI_HTML).toContain('aria-labelledby="deteccion-titulo"');
    // The two paintable blocks are also live regions.
    expect(UI_HTML).toContain('id="evidencia-lista" aria-live="polite"');
    expect(UI_HTML).toContain('id="salud-cuadro" aria-live="polite"');
  });

  test("all CSS classes of the card exist in the <style>", () => {
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
      // Each class must appear as a CSS selector, not only as an
      // attribute value: `.${clase}{` or `.${clase} `.
      const patron = new RegExp(
        `\\.${clase.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}[\\s,{:]`,
      );
      expect(UI_HTML.match(patron), `missing the rule .${clase}`).not.toBeNull();
    }
  });

  test("the colors of the new block come from theme variables", () => {
    // The block goes from `.deteccion {` to the last close of the
    // health section (just before the reduced-motion @media).
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
    // No hex introduced by the section.
    expect(bloque).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // And it relies on the already-defined variables.
    expect(bloque).toContain("var(--ok)");
    expect(bloque).toContain("var(--aviso)");
    expect(bloque).toContain("var(--error)");
    expect(bloque).toContain("var(--borde)");
  });

  test("--aviso is defined in the four theme blocks", () => {
    // Four blocks: :root default, prefers-color-scheme dark,
    // [data-tema="dark"], [data-tema="light"]. If one is missing
    // the variable, the yellow bars are painted with the browser's
    // default color.
    const matches = UI_HTML.match(/--aviso:\s*[^;]+;/g) ?? [];
    expect(matches.length).toBe(4);
  });

  test("the paint functions exist and are called after inspect", () => {
    expect(UI_HTML).toMatch(/function\s+pintaDeteccion\s*\(/);
    expect(UI_HTML).toMatch(/function\s+pintaEvidencia\s*\(/);
    expect(UI_HTML).toMatch(/function\s+pintaSalud\s*\(/);
    // Whoever inspects must end up calling pintaDeteccion(s).
    expect(UI_HTML).toMatch(/pintaDeteccion\(\s*s\s*\)/);
  });

  test("no innerHTML is assigned with summary data (XSS-safe)", () => {
    // We find every `.innerHTML = ...` assignment and classify it
    // as safe if the right-hand side is exactly the empty string
    // (that is what is used to clear containers). Any other value
    // is treated as an XSS regression: file names and signals come
    // from the detector and may carry `<`, `>`, `&` or quotes.
    const asignaciones = UI_HTML.match(/\.innerHTML\s*=[^;\n]*/g) ?? [];
    const problematicas = asignaciones.filter((a) => !/=\s*""\s*$/.test(a));
    expect(
      problematicas,
      `innerHTML with data: ${problematicas.join(" | ")}`,
    ).toEqual([]);
  });

  test("summary data is painted with textContent", () => {
    // Each local variable that receives a summary datum must appear
    // close (≤ 300 chars) to a textContent, in either direction. The
    // heuristic is loose because it covers the contract without
    // parsing JS: it detects the typical regression (swapping
    // textContent for innerHTML to "inject HTML") without tying itself
    // to the exact shape of the code.
    //
    // The LOCAL VARIABLES that receive the data are named, not the
    // raw fields of the summary: the assignment `var w = e.weight`
    // counts, even if `e.weight` is no longer close to the
    // textContent (`w.toFixed(2)` is, on the next line).
    const variables = ["e.signal", "e.artifact", "pct", "emoji"];
    for (const variable of variables) {
      const re = new RegExp(
        `\\.textContent[\\s\\S]{0,300}${variable}|${variable}[\\s\\S]{0,300}\\.textContent`,
      );
      expect(
        UI_HTML.match(re),
        `variable "${variable}" with no nearby textContent`,
      ).not.toBeNull();
    }
  });

  test("the evidence + health emojis are in the constant", () => {
    // The compass precedes each evidence signal (in CSS via
    // `content:`) and the colored circles live in the JS. Since the
    // HTML travels inside `String.raw`, unicode escapes are
    // preserved as-is: the test accepts both forms (escapes or
    // literal emojis) so it does not tie itself to one.
    const escapes = [
      "\\u{1F9ED}", // 🧭 compass
      "\\u{1F7E2}", // 🟢 verde
      "\\u{1F7E1}", // 🟡 amarillo
      "\\u{1F534}", // 🔴 rojo
    ];
    const literales = ["🧭", "🟢", "🟡", "🔴"];
    const todosComoEscape = escapes.every((e) => UI_HTML.includes(e));
    const todosComoLiteral = literales.every((e) => UI_HTML.includes(e));
    expect(todosComoEscape || todosComoLiteral).toBe(true);
  });

  test("the three health bands are chosen by percentage", () => {
    // The thresholds (75 / 50) live in the JS, not in the HTML
    // itself: it is enough that the three branches and the
    // associated emoticons exist. If someone changes the bands,
    // this test forces them to keep all three.
    expect(UI_HTML).toMatch(/pct >= 75 \? "ok"/);
    expect(UI_HTML).toMatch(/pct >= 50 \? "aviso"/);
    expect(UI_HTML).toMatch(/: "error"/);
    // And the CSS classes exist for all three states.
    expect(UI_HTML).toContain(".salud-celda--ok");
    expect(UI_HTML).toContain(".salud-celda--aviso");
    expect(UI_HTML).toContain(".salud-celda--error");
  });

  test("the card hides on errors and shows on successes", () => {
    // f00010 S3: if inspect fails, the card must not stay with the
    // previous project's data. The exact string may change; what is
    // pinned is the structure: inside the !res.ok branch, before
    // the return, hidden = true is done on the container.
    expect(UI_HTML).toMatch(
      /!res\.ok[\s\S]{0,400}\$\("deteccion"\)[\s\S]{0,80}hidden\s*=\s*true/,
    );
    // And if it succeeds, it becomes visible.
    expect(UI_HTML).toMatch(/seccion\.hidden\s*=\s*false/);
  });
});
