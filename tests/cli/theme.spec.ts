/**
 * El aspecto de la interfaz, en variables.
 *
 * Lo que se comprueba aquí no es que los colores sean bonitos —eso no
 * se puede probar— sino las dos propiedades que hacen que un tema
 * funcione:
 *
 *   1. **Ninguna regla escribe un color a pelo.** Si una lo hiciera, ese
 *      elemento se vería igual en los dos temas: bien en el que se
 *      escribió y roto en el otro. Es el fallo que más tarda en salir,
 *      porque hay que abrir el otro tema para verlo.
 *   2. **Los dos temas definen las mismas variables.** A un tema al que
 *      le falte una no le pasa nada visible: hereda la del otro y se ve
 *      mal en un sitio concreto.
 */
import { describe, expect, test } from "vitest";

import {
  DEFAULT_THEME,
  THEME_MODES,
  THEME_VARIABLES,
} from "../../packages/contracts/constants/cli/theme.constant";
import { UI_STYLES } from "../../packages/ui/web/theme.constant";

/** Los bloques que declaran variables: `:root`, el del sistema y el elegido. */
function bloquesDeVariables(css: string): string[] {
  return [...css.matchAll(/\{([^{}]*--[^{}]*)\}/g)].map((m) => m[1] ?? "");
}

describe("los modos", () => {
  test("son tres: sistema, claro y oscuro", () => {
    expect([...THEME_MODES]).toEqual(["system", "light", "dark"]);
  });

  /**
   * Quien tiene el sistema en oscuro lo tiene por un motivo, y abrir
   * una aplicación en blanco brillante es exactamente lo que configuró
   * para que no pasara.
   */
  test("el de por defecto sigue al sistema, no impone uno", () => {
    expect(DEFAULT_THEME).toBe("system");
  });
});

describe("los dos temas dicen lo mismo", () => {
  test("el claro define todas las variables declaradas", () => {
    const raiz = bloquesDeVariables(UI_STYLES)[0] ?? "";
    for (const variable of THEME_VARIABLES) {
      expect(raiz, `falta ${variable} en el tema claro`).toContain(`${variable}:`);
    }
  });

  /** EL test: un tema incompleto hereda del otro y se ve mal en un sitio. */
  test("el oscuro define exactamente las mismas", () => {
    const oscuro = /:root\[data-tema="dark"\]\s*\{([^}]*)\}/.exec(UI_STYLES)?.[1] ?? "";
    expect(oscuro.length, "no hay bloque de tema oscuro").toBeGreaterThan(0);
    for (const variable of THEME_VARIABLES) {
      expect(oscuro, `falta ${variable} en el tema oscuro`).toContain(`${variable}:`);
    }
  });

  test("el del sistema también, para que no herede a medias", () => {
    const sistema =
      /:root:not\(\[data-tema="light"\]\)\s*\{([^}]*)\}/.exec(UI_STYLES)?.[1] ?? "";
    expect(sistema.length).toBeGreaterThan(0);
    for (const variable of THEME_VARIABLES) {
      expect(sistema, `falta ${variable} en el tema del sistema`).toContain(
        `${variable}:`,
      );
    }
  });
});

describe("ni un color fuera de las variables", () => {
  /**
   * EL otro test. Se miran las reglas —lo que no es un bloque de
   * variables— y ahí no puede aparecer un color literal: todo tiene que
   * ser `var(--algo)`.
   */
  test("las reglas usan `var()`, no valores literales", () => {
    // Se quitan los bloques que declaran variables: ahí los literales
    // son justamente lo que se quiere.
    const soloReglas = UI_STYLES.replace(/\{[^{}]*--[^{}]*\}/g, "{}")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    const literales = [
      ...soloReglas.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
      ...soloReglas.matchAll(/\brgba?\([^)]*\)/g),
    ].map((m) => m[0]);

    expect(literales, "hay colores escritos a pelo en una regla").toEqual([]);
  });

  test("y ningún nombre de color suelto tampoco", () => {
    const soloReglas = UI_STYLES.replace(/\{[^{}]*--[^{}]*\}/g, "{}")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    // `transparent` y `inherit` no son colores del tema: son ausencia de
    // color y herencia, y ninguno de los dos cambia entre temas.
    const sospechosos = [
      ...soloReglas.matchAll(
        /:\s*(white|black|red|green|blue|gray|grey|yellow|orange)\b/g,
      ),
    ].map((m) => m[1]);
    expect(sospechosos).toEqual([]);
  });
});

describe("lo accesible no es opcional", () => {
  /**
   * El foco visible es lo único que le dice a quien navega con teclado
   * dónde está. Quitarlo deja la interfaz inusable sin ratón, y es de
   * las cosas que se borran «porque se ve raro».
   */
  test("el foco de teclado se ve", () => {
    expect(UI_STYLES).toContain(":focus-visible");
    expect(UI_STYLES).toMatch(/:focus-visible\s*\{[^}]*outline:/);
  });

  test("el foco usa la variable, para que se vea en los dos temas", () => {
    const regla = /:focus-visible\s*\{([^}]*)\}/.exec(UI_STYLES)?.[1] ?? "";
    expect(regla).toContain("var(--foco)");
  });
});
