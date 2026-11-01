/**
 * La auto-aprobación: quién puede, cuándo y con qué método de merge.
 *
 * ## Por qué esto tiene test
 *
 * Porque un workflow de auto-aprobación es un workflow que **da
 * permisos de escritura a un bot**. Si un día alguien le quita la
 * condición del autor, el bot aprueba PRs de cualquiera. Si un día
 * nadie espera a la validación, aprueba PRs en rojo. Y si un día el
 * método de merge es siempre squash, `develop` pierde su historia de
 * merge commits y `main` recibe un merge commit que su propia
 * protección rechaza.
 *
 * Las tres cosas se comprueban **contra el fichero real**, no contra
 * una copia: el fichero es la política.
 */
import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { REPO_ROOT } from "../../scripts/helpers/root.helper.js";

const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "auto-approve.yml");

async function workflow(): Promise<string> {
  return readFile(WORKFLOW, "utf8");
}

/**
 * El workflow sin sus comentarios.
 *
 * Porque el fichero **explica** por qué no hace checkout del código del
 * PR, y esa explicación nombra `actions/checkout`. Buscar la cadena en
 * el texto entero daría un positivo falso: el comentario hablaría de
 * la cosa que el test quiere que no esté.
 */
async function workflowWithoutComments(): Promise<string> {
  const raw = await workflow();
  return raw
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

describe("la auto-aprobación", () => {
  test("el workflow existe", async () => {
    const raw = await workflow();
    expect(raw).toContain("name: auto-approve");
  });

  test("sólo aprueba los PR del dueño", async () => {
    const raw = await workflow();
    // El autor tiene que estar en la condición. Sin esto, el bot
    // aprueba PRs de cualquiera que tenga permiso de escritura.
    expect(raw).toContain("github.event.pull_request.user.login ==");
    // Y el dueño sale de `vars`, no de `env`: el contexto `env` no
    // existe en `jobs.<job_id>.if`, y con `env` la comparación nunca
    // casaba.
    expect(raw).toContain("vars.OWNER");
    expect(raw).not.toMatch(/if:[\s\S]{0,400}env\.OWNER/);
  });

  test("espera a la validación antes de aprobar", async () => {
    const raw = await workflow();
    // El check que resume la validación entera.
    expect(raw).toContain("SUMMARY_CHECK: ci-summary");
    // Y la aprobación está condicionada a que ese check esté en verde.
    expect(raw).toContain("steps.wait.outputs.conclusion == 'success'");
    // Un check en rojo o en fallo NO aprueba.
    expect(raw).toContain('"failure"');
    expect(raw).toContain('"cancelled"');
  });

  test("no hace checkout del código del PR", async () => {
    const raw = await workflowWithoutComments();
    // `pull_request_target` da un token con escritura: si hiciese
    // checkout del PR, ejecutaría código de cualquiera con permisos
    // de escritura en el repositorio.
    expect(raw).toContain("pull_request_target");
    expect(raw).not.toContain("actions/checkout");
  });

  test("el método de merge depende de la rama", async () => {
    const raw = await workflow();
    // `main` exige historia lineal (squash); `develop` no, y su
    // historia son merge commits.
    expect(raw).toContain('base === "main" ? "squash" : "merge"');
  });

  test("usa pull-requests: write y nada más", async () => {
    const raw = await workflow();
    expect(raw).toContain("pull-requests: write");
    expect(raw).toContain("contents: read");
    // `contents: write` sería puerta abierta para modificar el repo.
    expect(raw).not.toContain("contents: write");
  });

  test("no se salta los borradores", async () => {
    const raw = await workflow();
    expect(raw).toContain("github.event.pull_request.draft == false");
  });
});
