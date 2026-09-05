/**
 * The interface's stylesheet.
 *
 * It lives as a constant and not as a `.css` file because the page
 * is served **from memory** — the compiled binary has no filesystem
 * — and because the page's own security policy forbids loading
 * anything from outside.
 *
 * It is an **asset**, not a contract, and that is why it lives here
 * and not in `packages/contracts/`: what is a contract are the modes
 * and the variable names, which are shared by the settings, the
 * server and this stylesheet. They live in
 * `contracts/constants/cli/theme.constant.ts`.
 *
 * Not a single colour written hard-coded in the rules: **everything**
 * points to a variable, and switching theme is changing those
 * variables' values. With classes (`.dark .button { … }`) each
 * element would need its rule repeated per theme, so a new one
 * would look fine in the theme it was written for and broken in
 * the others.
 */

export const UI_STYLES = String.raw`
  /* El tema claro es la base: lo que no redefina el oscuro, sale de aquí. */
  :root {
    --fondo: #ffffff;
    --fondo-elevado: #f6f7f9;
    --borde: #d7dce3;
    --texto: #1a1d21;
    --texto-suave: #5a6472;
    --acento: #2f6feb;
    --acento-texto: #ffffff;
    --exito: #1a7f4b;
    --aviso: #9a6700;
    --error: #b42318;
    --sombra: rgba(16, 24, 40, 0.08);
    --foco: #2f6feb;

    /* Lo que no es color tampoco se escribe a pelo. */
    --radio: 8px;
    --espacio: 12px;
    --fuente: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --fuente-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  }

  /*
   * El oscuro cuando lo pide el sistema **y** no se ha elegido otra
   * cosa. El selector con ':not([data-tema])' es lo que permite que
   * elegir "claro" en ajustes gane sobre el sistema: sin él, quien
   * quisiera claro en un sistema oscuro no podría.
   */
  @media (prefers-color-scheme: dark) {
    :root:not([data-tema="light"]) {
      --fondo: #14171a;
      --fondo-elevado: #1c2126;
      --borde: #2c343c;
      --texto: #e8ebee;
      --texto-suave: #9aa5b1;
      --acento: #5b9cf8;
      --acento-texto: #0d1117;
      --exito: #3fb950;
      --aviso: #d29922;
      --error: #f85149;
      --sombra: rgba(0, 0, 0, 0.4);
      --foco: #5b9cf8;
    }
  }

  /* Y el oscuro elegido a mano, que gana en los dos sentidos. */
  :root[data-tema="dark"] {
    --fondo: #14171a;
    --fondo-elevado: #1c2126;
    --borde: #2c343c;
    --texto: #e8ebee;
    --texto-suave: #9aa5b1;
    --acento: #5b9cf8;
    --acento-texto: #0d1117;
    --exito: #3fb950;
    --aviso: #d29922;
    --error: #f85149;
    --sombra: rgba(0, 0, 0, 0.4);
    --foco: #5b9cf8;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: calc(var(--espacio) * 2);
    background: var(--fondo);
    color: var(--texto);
    font-family: var(--fuente);
    line-height: 1.5;
  }

  h1 { font-size: 1.4rem; margin: 0; }
  h2 { font-size: 1.1rem; margin: calc(var(--espacio) * 2) 0 var(--espacio); }

  .cabecera {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--espacio);
    margin-bottom: calc(var(--espacio) * 2);
  }

  .tarjeta {
    background: var(--fondo-elevado);
    border: 1px solid var(--borde);
    border-radius: var(--radio);
    padding: calc(var(--espacio) * 1.5);
    box-shadow: 0 1px 2px var(--sombra);
  }

  label { display: block; margin-bottom: 4px; color: var(--texto-suave); font-size: 0.9rem; }

  input, select, button {
    font: inherit;
    border-radius: var(--radio);
    border: 1px solid var(--borde);
    padding: 8px 10px;
    background: var(--fondo);
    color: var(--texto);
  }

  input, select { width: 100%; }

  button {
    background: var(--acento);
    color: var(--acento-texto);
    border-color: transparent;
    cursor: pointer;
  }
  button.secundario { background: var(--fondo); color: var(--texto); border-color: var(--borde); }
  button[disabled] { opacity: 0.5; cursor: not-allowed; }

  /*
   * El foco visible no es decoración: es lo único que le dice a quien
   * navega con teclado dónde está. Quitarlo deja la interfaz inusable
   * sin ratón.
   */
  :focus-visible { outline: 2px solid var(--foco); outline-offset: 2px; }

  .fila { display: flex; gap: var(--espacio); align-items: flex-end; }
  .fila > * { flex: 1; }
  .fila > button { flex: 0 0 auto; }

  .ok { color: var(--exito); }
  .aviso { color: var(--aviso); }
  .error { color: var(--error); }
  .suave { color: var(--texto-suave); font-size: 0.9rem; }

  pre {
    background: var(--fondo);
    border: 1px solid var(--borde);
    border-radius: var(--radio);
    padding: var(--espacio);
    overflow-x: auto;
    font-family: var(--fuente-mono);
    font-size: 0.85rem;
  }

  .oculto { display: none; }

  .tuerca {
    background: transparent;
    border: 1px solid var(--borde);
    color: var(--texto);
    padding: 6px 10px;
  }
`;
