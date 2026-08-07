/**
 * Los dos gates de seguridad.
 *
 * Un lint de seguridad que no encuentra nada es indistinguible de uno
 * roto — y los dos dan verde. Por eso lo que se prueba aquí no es que
 * pasen sobre el repo (eso lo hace `bun run lint`), sino que **cazan**
 * lo que dicen cazar y que **no marcan** lo que no lo es.
 *
 * Lo segundo importa tanto como lo primero: los fixtures de este repo
 * son proyectos de API de mentira, llenos de `password` y `token` a
 * propósito. Un lint que los marcara sería ruido, y un lint ruidoso se
 * acaba desactivando.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { findSecrets } from "../../scripts/gates/lint-secrets.script";
import { findSastIssues } from "../../scripts/gates/lint-sast.script";

let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "security-lints-"));
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

/**
 * Las credenciales de prueba se **componen en tiempo de ejecución**.
 *
 * Tienen que llevar la forma real para que el lint las reconozca, pero
 * si el literal completo estuviera escrito en este fichero sería una
 * credencial con forma válida dentro del repositorio. La protección de
 * push de GitHub bloqueó el primer intento por exactamente eso — y tenía
 * razón: un escáner no puede distinguir la tuya de una de verdad.
 *
 * Partiéndolas por la mitad, el fichero no contiene ninguna cadena que
 * case, y el fichero temporal que se escribe abajo sí. Que es donde el
 * lint tiene que cazarla.
 */
const SAMPLES = {
  postman: "PMAK-" + "65a1b2c3d4e5f60718293a4b" + "abc123def456789012345678",
  aws: "AKIA" + "IOSFODNN7EXAMPLE",
  github: "ghp_" + "abcdefghijklmnopqrstuvwxyz0123456789",
  slack: "xox" + "b-123456789012-abcdefghijklmnop",
  privateKey: "-----BEGIN " + "RSA PRIVATE KEY-----",
  urlCreds: "postgres://admin:" + "s3cr3tPass" + "@db.example.com/x",
  realistic: "Xk9$" + "mQ2pLw7#nR4tYb8Zc1Vd",
} as const;

/** Escribe un fichero temporal y devuelve su ruta. */
async function fixture(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

describe("lint:secrets caza credenciales de verdad", () => {
  test.each([
    ["clave de Postman", SAMPLES.postman],
    ["clave de AWS", SAMPLES.aws],
    ["token de GitHub", SAMPLES.github],
    ["token de Slack", SAMPLES.slack],
    ["clave privada", SAMPLES.privateKey],
    ["URL con credenciales", SAMPLES.urlCreds],
  ])("%s", async (name, value) => {
    const path = await fixture(`${name.replace(/\s+/g, "-")}.ts`, `const k = "${value}";`);
    const found = await findSecrets([path]);
    expect(found.length, `no cazó: ${name}`).toBeGreaterThan(0);
  });

  test("una asignación con un valor que parece real", async () => {
    const path = await fixture(
      "asignacion.ts",
      `const config = { apiKey: "${SAMPLES.realistic}" };`,
    );
    expect((await findSecrets([path])).length).toBeGreaterThan(0);
  });

  // El valor no se vuelve a filtrar entero en el mensaje de error, que
  // acabaría en la salida de CI.
  test("el hallazgo sale censurado, no en claro", async () => {
    const path = await fixture("censura.ts", `const secret = "${SAMPLES.realistic}";`);
    const found = await findSecrets([path]);
    expect(found[0]?.what).toContain("*");
    expect(found[0]?.what).not.toContain(SAMPLES.realistic);
  });
});

describe("lint:secrets NO marca lo que no es un secreto", () => {
  test.each([
    ["un marcador de posición", 'const apiKey = "your-api-key-here";'],
    ["una variable de entorno", 'const token = process.env["POSTMAN_API_KEY"];'],
    ["una plantilla de Postman", 'const token = "{{token}}";'],
    ["un valor de fixture", 'password = "fake"'],
    ["una frase", 'const secret = "la contraseña va en el entorno";'],
    ["un campo de ejemplo", '{"password": "changeme"}'],
    ["un valor corto", 'const token = "abc123";'],
    ["el nombre de la variable", 'const password = "password";'],
  ])("%s", async (name, code) => {
    const path = await fixture(`ok-${name.replace(/\s+/g, "-")}.ts`, code);
    expect(await findSecrets([path]), code).toEqual([]);
  });

  test("`lint:secrets ignore` exime la línea", async () => {
    const path = await fixture(
      "eximido.ts",
      `const k = "${SAMPLES.aws}"; // lint:secrets ignore — de la doc de AWS`,
    );
    expect(await findSecrets([path])).toEqual([]);
  });
});

describe("lint:sast caza los patrones peligrosos", () => {
  test.each([
    ["eval", "const r = eval(sourceFromScannedProject);"],
    ["new Function", "const f = new Function(userInput);"],
    ["exec con interpolación", "execSync(`git log ${projectRoot}`);"],
    ["exec con concatenación", 'execSync("ls " + projectRoot);'],
    ["volcado del entorno", "log(JSON.stringify(process.env));"],
    ["clave en el log", "console.log(`key: ${apiKey}`);"],
  ])("%s", async (name, code) => {
    const path = await fixture(`sast-${name.replace(/\s+/g, "-")}.ts`, code);
    const found = await findSastIssues([path]);
    expect(found.length, `no cazó: ${code}`).toBeGreaterThan(0);
  });

  test("cada hallazgo explica el porqué y el arreglo", async () => {
    const path = await fixture("sast-explica.ts", "const r = eval(x);");
    const found = await findSastIssues([path]);
    expect(found[0]?.rule.why.length).toBeGreaterThan(20);
    expect(found[0]?.rule.fix.length).toBeGreaterThan(10);
  });
});

describe("lint:sast NO marca lo que es seguro", () => {
  test.each([
    ["spawnSync con array", 'spawnSync(bunBin, ["run", script], { cwd });'],
    ["exec sin interpolación", 'execSync("command -v bun");'],
    ["una variable de entorno concreta", 'const key = process.env["POSTMAN_API_KEY"];'],
    // Nombrar la variable en un texto de ayuda no es imprimir su valor.
    ["el nombre de la clave en la ayuda", 'console.error("  POSTMAN_API_KEY=<key> expostman push");'],
    ["un comentario que menciona eval", "// nunca uses eval( aquí"],
  ])("%s", async (name, code) => {
    const path = await fixture(`sast-ok-${name.replace(/\s+/g, "-")}.ts`, code);
    expect(await findSastIssues([path]), code).toEqual([]);
  });

  test("`lint:sast ignore` exime la línea", async () => {
    const path = await fixture(
      "sast-eximido.ts",
      "const r = eval(x); // lint:sast ignore — el valor es una constante del propio repo",
    );
    expect(await findSastIssues([path])).toEqual([]);
  });
});
