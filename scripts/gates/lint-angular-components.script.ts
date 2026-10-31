#!/usr/bin/env bun
/**
 * `bun run lint:angular-components` — cada componente Angular vive en
 * tres ficheros: `.ts`, `.html` y `.scss`.
 *
 * Por qué existe
 * ──────────────
 * La app tenía las treinta plantillas y las veintiséis hojas de estilo
 * **escritas dentro del `.ts`**. El efecto no era estético:
 *
 *   - El `.ts` de un componente llegó a tener 400 líneas, de las que
 *     doscientas eran HTML y CSS. El fichero que se abre para leer
 *     lógica se lee entero para nada.
 *   - **El CSS no se podía revisar.** Una regla de estilo escrita en
 *     un literal de TypeScript no la encuentra ni el resaltador de
 *     sintaxis, ni el formateador, ni `grep -n "\.sidebar"`.
 *   - **El HTML tampoco.** Lo mismo: una etiqueta rota dentro de un
 *     literal no la ve nadie hasta que Angular la compila.
 *   - Los estilos de un componente son HTML y CSS: tienen su propio
 *     lenguaje, y su propio fichero es lo que las herramientas de
 *     esos lenguajes esperan.
 *
 * El gate comprueba las cuatro cosas que importan:
 *
 *   1. Que ningún componente tenga `template:` o `styles:` en línea.
 *   2. Que cada `templateUrl` apunte a un `.html` que existe.
 *   3. Que cada `styleUrls` apunte a un `.scss` que existe.
 *   4. Que no queden `.html` o `.scss` huérfanos: una plantilla sin
 *      componente al que pertenecer es trabajo perdido, y casi siempre
 *      es el rastro de un componente que se renombró.
 *
 * Uso:
 *   bun run lint:angular-components
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { REPO_ROOT, fromRoot } from "../helpers/root.helper.js";
import { collectFiles } from "../helpers/walk.helper.js";

/** La app Angular. Los `.component.ts` de aquí son los que se miran. */
const APP_SRC = fromRoot("packages/app/src");

/** Un problema encontrado, con dónde está. */
interface IProblem {
  readonly file: string;
  readonly message: string;
}

/** Nombres de fichero que el decorador puede declarar. */
const TEMPLATE_URL = /templateUrl:\s*"([^"]+)"/g;
const STYLE_URLS = /styleUrls:\s*\[([^\]]*)\]/g;

/** Las rutas de un array de strings: `["a", "b"]`. */
function urlsOf(arraySource: string): readonly string[] {
  return [...arraySource.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
}

/** Una línea del fichero donde aparece algo, para poder señalar. */
function lineOf(source: string, needle: string): number {
  const index = source.indexOf(needle);
  if (index < 0) return 1;
  return source.slice(0, index).split("\n").length;
}

async function main(): Promise<number> {
  const problems: IProblem[] = [];

  const components = await collectFiles(APP_SRC, [".component.ts"]);
  const templates = new Set(await collectFiles(APP_SRC, [".component.html"]));
  const styles = new Set(await collectFiles(APP_SRC, [".component.scss"]));

  /** Los ficheros que un componente declara, ya resueltos en disco. */
  const claimedTemplates = new Set<string>();
  const claimedStyles = new Set<string>();

  for (const component of components) {
    const relativeComponent = relative(REPO_ROOT, component);
    const source = await readFile(component, "utf8");

    // 1. Sin plantillas ni estilos en línea.
    for (const inline of ["template:", "styles:"]) {
      const match = new RegExp(`^\\s*${inline}`, "m").exec(source);
      if (match) {
        problems.push({
          file: relativeComponent,
          message: `plantilla o estilos en línea (\`${inline}\`) — van en su propio fichero`,
        });
      }
    }

    // 2. La plantilla vive en un `.html` que existe.
    const templateMatches = [...source.matchAll(TEMPLATE_URL)];
    if (templateMatches.length === 0) {
      problems.push({
        file: relativeComponent,
        message: "sin `templateUrl` — la plantilla va en su propio `.html`",
      });
    }
    for (const match of templateMatches) {
      const target = join(dirname(component), match[1] ?? "");
      if (!existsSync(target)) {
        problems.push({
          file: relativeComponent,
          message: `\`templateUrl\` apunta a un fichero que no existe: ${match[1]}`,
        });
        continue;
      }
      claimedTemplates.add(target);
    }

    // 3. Los estilos viven en un `.scss` que existe.
    const styleMatches = [...source.matchAll(STYLE_URLS)];
    for (const match of styleMatches) {
      for (const url of urlsOf(match[1] ?? "")) {
        const target = join(dirname(component), url);
        if (!existsSync(target)) {
          problems.push({
            file: relativeComponent,
            message: `\`styleUrls\` apunta a un fichero que no existe: ${url}`,
          });
          continue;
        }
        claimedStyles.add(target);
      }
    }
  }

  // 4. Ni plantillas ni estilos huérfanos.
  for (const template of templates) {
    if (!claimedTemplates.has(template)) {
      problems.push({
        file: relative(REPO_ROOT, template),
        message: "plantilla huérfana — ningún componente la declara",
      });
    }
  }
  for (const style of styles) {
    if (!claimedStyles.has(style)) {
      problems.push({
        file: relative(REPO_ROOT, style),
        message: "hoja de estilos huérfana — ningún componente la declara",
      });
    }
  }

  if (problems.length > 0) {
    console.error(
      `lint:angular-components — ${problems.length} problema(s) en la app Angular:\n`,
    );
    for (const problem of problems) {
      console.error(`  ✗ ${problem.file}`);
      console.error(`      ${problem.message}`);
    }
    console.error(
      "\n  Cada componente Angular va en tres ficheros: `<nombre>.component.ts`,\n" +
        "  `<nombre>.component.html` y `<nombre>.component.scss`. El `.ts` no\n" +
        "  lleva `template:` ni `styles:` en línea: el HTML no lo revisa\n" +
        "  nadie dentro de un literal de TypeScript, y el CSS tampoco.",
    );
    return 1;
  }

  console.log(
    `lint:angular-components — ${components.length} componente(s), ` +
      `${templates.size} plantilla(s) y ${styles.size} hoja(s) de estilo propias, ` +
      "todo en su fichero",
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
