/**
 * La rehidratación: `main` vuelve a `develop` cada vez que `main` cambia.
 *
 * ## Por qué esto tiene test
 *
 * Porque el invariante `develop -> main -> develop` se rompía en
 * silencio. La promoción iba de `develop` a `main`, y lo que no iba al
 * revés era `main` a `develop`: `main` se quedaba con commits que
 * `develop` no tenía, y la promoción siguiente chocaba con un
 * `dirty` que nadie sabía explicar. El ciclo era una cosa que alguien
 * tenía que acordarse de hacer.
 *
 * Un workflow que hace el ciclo solo puede romperse de tres maneras, y
 * las tres son silenciosas: que deje de dispararse, que empuje a donde
 * no debe, o que se dé por bueno sin haber rehidratado nada.
 */
import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { REPO_ROOT } from "../../scripts/helpers/root.helper.js";

const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "rehydrate-develop.yml");

async function workflow(): Promise<string> {
  return readFile(WORKFLOW, "utf8");
}

/**
 * El workflow sin sus comentarios.
 *
 * Porque el fichero **explica** por qué la fusión no cambia el árbol y
 * por qué el PR es necesario, y esas explicaciones nombran las cadenas
 * que el test quiere que no estén. Buscar la cadena en el texto entero
 * daría un positivo falso: el comentario hablaría de la cosa que el
 * test quiere que no pase.
 */
async function workflowWithoutComments(): Promise<string> {
  const raw = await workflow();
  return raw
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

describe("la rehidratación", () => {
  test("el workflow existe y se dispara al cambiar main", async () => {
    const raw = await workflow();
    expect(raw).toContain("name: rehydrate-develop");
    // El disparador es el push a `main`: eso es lo que tiene que
    // cerrar el ciclo.
    expect(raw).toContain("push:");
    expect(raw).toMatch(/branches:\s*\n\s*- main/);
  });

  test("nunca empuja a main", async () => {
    const raw = await workflowWithoutComments();
    // `main` se corta con un PR y con revisión. Un push desde aquí
    // saltaría la puerta que separa una release de un descuido.
    expect(raw).not.toMatch(/push[^\n]*origin\s+main/);
    expect(raw).not.toMatch(/git push[^\n]*\bmain\b/);
    // Y lo que sí hace es empujar la rama de rehidratación, que lleva
    // su propio nombre.
    expect(raw).toMatch(/git push --force origin "\$BRANCH"/);
  });

  test("la rehidratación va por pull request, no por push directo", async () => {
    const raw = await workflowWithoutComments();
    // `develop` es una rama protegida: un push directo lo rechaza con
    // "Changes must be made through a pull request".
    expect(raw).toContain('gh api --method POST "repos/${GITHUB_REPOSITORY}/pulls"');
    expect(raw).toContain('-f base="$INTEGRATION_BRANCH"');
    // Y el auto-merge es lo que integra, no un push.
    expect(raw).toContain("/auto-merge");
    expect(raw).toContain("merge_method=merge");
  });

  test("comprueba el invariante en vez de suponerlo", async () => {
    const raw = await workflow();
    // Antes de fusionar, comprueba que el contenido de `main` está en
    // la historia de `develop`. Si no está, rehidratar sería traer
    // contenido que faltaba —que exige revisión humana—, y el
    // workflow para con el motivo.
    expect(raw).toContain("merge-base --is-ancestor");
    expect(raw).toContain("origin/main^{tree}");
    // Y al terminar, vuelve a comprobarlo.
    expect(raw).toContain("el ciclo está cerrado");
  });

  test("falla con un motivo en vez de terminar en verde sin rehidratar", async () => {
    const raw = await workflow();
    // El PR tiene que integrarse: un verde que sólo significa "abrí
    // un PR" mentiría sobre lo que el workflow promete.
    expect(raw).toContain("MERGE_TIMEOUT_SECONDS");
    expect(raw).toContain("exit 1");
    // Y el error dice qué se rompe si no se cierra.
    expect(raw).toContain("no se integró en el plazo");
  });

  test("espera a que el PR se integre antes de terminar", async () => {
    const raw = await workflow();
    // Sin esta espera, el workflow terminaría en verde con el PR
    // todavía abierto, y el ciclo seguiría sin cerrarse.
    expect(raw).toContain("Esperar a que la rehidratación se integre");
    expect(raw).toContain('state" = "MERGED"');
  });

  test("borra la rama cuando ya está integrada", async () => {
    const raw = await workflow();
    // La rama es de un solo uso: si se queda, origin acumula ramas
    // que nadie sabe qué son.
    expect(raw).toContain("Borrar la rama y comprobar el invariante");
    expect(raw).toContain("git/refs/heads/$BRANCH");
  });

  test("ningún paso cierra el pipe antes de tiempo", async () => {
    // Sin comentarios: el workflow **explica** por qué no usa `head`
    // ni `awk ... exit`, y esa explicación nombra las dos cosas.
    // Buscarlas en el texto entero daría un positivo falso.
    const raw = await workflowWithoutComments();
    // `head` y `awk ... exit` cierran el pipe en cuanto tienen lo
    // suyo: lo que lee recibe un SIGPIPE y, con `pipefail`, eso es un
    // error del paso. El primero que lo hizo fue este workflow: el
    // `awk` que buscaba el árbol cerraba el pipe, y el paso moría
    // con 141 **sin llegar a comprobar nada**.
    //
    // Con menos de veinte líneas de salida no pasa —y por eso
    // parece que funciona—, así que el fallo depende de los datos.
    expect(raw).not.toMatch(/\|\s*head\s/);
    expect(raw).not.toMatch(/awk[^\n]*\bexit\b/);
  });

  test("la rama es la misma para todas las rehidrataciones", async () => {
    const raw = await workflow();
    // Con el id de la ejecución en el nombre, cada promoción dejaba
    // una rama y un PR nuevos: se acumulaban, y ninguno se podía
    // integrar.
    expect(raw).toContain('BRANCH="rehydrate/main-into-develop"');
    expect(raw).not.toContain("GITHUB_RUN_ID");
  });

  test("abre el PR por la API REST, que trae el número", async () => {
    // Sin comentarios: el workflow **explica** por qué no usa
    // `gh pr create`, y esa explicación lo nombra.
    const raw = await workflowWithoutComments();
    // `gh pr create` puede terminar con error **después** de haber
    // creado el PR: la release quedaba creada y el workflow moría
    // sin el número, y el PR se quedaba abierto para siempre.
    expect(raw).toContain('gh api --method POST "repos/${GITHUB_REPOSITORY}/pulls"');
    expect(raw).not.toContain("gh pr create");
  });

  test("el check lo reporta el workflow, después de comprobar el contenido", async () => {
    const raw = await workflow();
    // El PR lo abre este workflow con `GITHUB_TOKEN`, y los eventos
    // que dispara el `GITHUB_TOKEN` no crean ejecuciones: la CI del
    // PR no corre y el check que `develop` exige no llega. El PR
    // reportaría el check él mismo —pero sólo después de comprobar
    // que el PR **no cambia el contenido** y que la base está verde.
    expect(raw).toContain("checks: write");
    expect(raw).toContain('gh api --method POST "repos/${GITHUB_REPOSITORY}/check-runs"');
    expect(raw).toContain('name=ci-summary');
    expect(raw).toContain("HEAD_TREE");
    expect(raw).toContain("BASE_TREE");
    // Y si el árbol **no** es el mismo, no se reporta nada: la
    // validación tiene que correr de verdad.
    expect(raw).toContain("el PR cambia el contenido");
    expect(raw).toContain("la base no está en verde");
  });
});
