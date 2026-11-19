/**
 * x00038 / a00016 S6 — End-to-end: los 6 estilos multi-línea que el
 * LanguageIR reconoce deben convertirse en rutas reales, no perderse en
 * el scanner.
 *
 * El collector ya emitía `this.router.get`, `api.router.get`,
 * `getRouter().get`, `server["get"]`, `router?.get` como
 * `IRouteCallExpression` correctos (cubre `tests/frameworks/
 * collect-method-calls.spec.ts`). Pero el puente aplnaba a string
 * `callee` y Express reconstruía el verbo con `callee.split(".")`:
 * `this.router.get` → verbo "router" (descartado), `server["get"]` →
 * sin punto (descartado). Resultado: la feature se detectaba en el IR y
 * desaparecía E2E. Era `primitive ✅ / unit ✅ / integration ❌`.
 *
 * Estos tests comprobarn el endpoint FINAL (fuente → ParsedRoute), no el
 * IR. Ese era el nivel de prueba que faltaba: habría del estado el bug
 * que tres auditorías señalan pero los unit-tests del collector no ven.
 */
import { describe, expect, test } from "vitest";

import { createTempProject, scanProject } from "../helpers/scanner-fixture";

/**
 * Cada caso: snippet de código Express escrito con un estilo distinto,
 * y la (method, uri) que DEBE aparecer en las rutas. `router` es una
 * variable declarada antes para que exista algo a lo que colgar la ruta
 * (los prefijos se prueban en su propio spec).
 */
const STYLES: ReadonlyArray<[string, string, string]> = [
  ["app.get", 'app.get("/plain", h)', "GET /plain"],
  ["this.router.get", 'class C { constructor(){ this.router.get("/mine", h) } }', "GET /mine"],
  ["api.router.get", 'api.router.get("/nested", h)', "GET /nested"],
  ["factory().get", 'getRouter().get("/factory", h)', "GET /factory"],
  ['server["get"]', 'server["get"]("/computed", h)', "GET /computed"],
  ["router?.get (optional)", 'router?.get("/opt", h)', "GET /opt"],
];

describe("Express multi-estilo E2E (x00038 / a00016 S6)", () => {
  for (const [name, snippet, expected] of STYLES) {
    test(`${name} produce una ruta real, no se pierde`, async () => {
      const project = await createTempProject({
        "package.json": JSON.stringify({
          name: "multi-style",
          dependencies: { express: "^4.19.2" },
        }),
        "app.js": [
          'const express = require("express");',
          "const app = express();",
          "const router = express.Router();",
          "const api = { router };",
          "class C { constructor(){ this.router = express.Router(); } }",
          "function getRouter(){ return express.Router(); }",
          "function h(){}",
          snippet,
          "app.listen(3000);",
        ].join("\n"),
      });
      try {
        const routes = (await scanProject("express", project.root)).routes;
        const found = routes.some(
          (r) => `${r.method} ${r.uri}` === expected,
        );
        expect(found, `esperado ${expected} en:\n${routes.map((r) => `${r.method} ${r.uri}`).join("\n")}`).toBe(
          true,
        );
      } finally {
        await project.cleanup();
      }
    });
  }
});

/**
 * El caso más fuerte de la auditoría: un router DECLARADO y MONTADO,
 * escrito con estilo `this`/computado, debe recibir su prefijo igual
 * que uno plano. Aquí no basta con que la ruta aparezca: debe aparecer
 * con el prefijo del router aplicado, demostrando que `receiver` viaja
 * estructural hasta la resolución de prefijos.
 */
describe("Express multi-estilo con prefijo de router (x00038 S3)", () => {
  test('router declarado con const y llamado con ["get"] hereda el prefijo de app.use', async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({
        name: "prefixed",
        dependencies: { express: "^4.19.2" },
      }),
      "app.js": [
        'const express = require("express");',
        "const app = express();",
        "const users = express.Router();",
        'users["get"]("/list", h);',
        "app.use('/api/users', users);",
        "app.listen(3000);",
      ].join("\n"),
    });
    try {
      const routes = (await scanProject("express", project.root)).routes;
      const uris = routes.map((r) => r.uri);
      expect(uris).toContain("/api/users/list");
    } finally {
      await project.cleanup();
    }
  });
});

/**
 * x00048 S2 — `const M = "get"; app[M](...)` debe producir una ruta real,
 * no perderse. Es el último multi-estilo de la matriz de a00016: el
 * IR reconoce el shape `app[M]` como `receiverKind: "computed"`,
 * `method: ""`, y `propagateConstants` resuelve `M` a la literal. Si el
 * wiring de collect-constants en express.scanner.ts pasa `[]` o no se
 * llama, este test falla — que es exactamente lo que x00048 S2 cierra.
 */
describe("Express constant propagation E2E (x00048 S2)", () => {
  test('`const M = "get"; app[M]("/h", h)` produce GET /h', async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({
        name: "constant-method",
        dependencies: { express: "^4.19.2" },
      }),
      "app.js": [
        'const express = require("express");',
        "const app = express();",
        'const M = "get";',
        'app[M]("/h", h);',
        "app.listen(3000);",
      ].join("\n"),
    });
    try {
      const routes = (await scanProject("express", project.root)).routes;
      const found = routes.some((r) => r.method === "GET" && r.uri === "/h");
      expect(
        found,
        `esperado GET /h, obtuve:\n${routes.map((r) => `${r.method} ${r.uri}`).join("\n")}`,
      ).toBe(true);
    } finally {
      await project.cleanup();
    }
  });

  test('`const M = "post"; app[M]("/items", h)` produce POST /items', async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({
        name: "constant-method-post",
        dependencies: { express: "^4.19.2" },
      }),
      "app.js": [
        'const express = require("express");',
        "const app = express();",
        'const M = "post";',
        'app[M]("/items", h);',
        "app.listen(3000);",
      ].join("\n"),
    });
    try {
      const routes = (await scanProject("express", project.root)).routes;
      const found = routes.some((r) => r.method === "POST" && r.uri === "/items");
      expect(
        found,
        `esperado POST /items, obtuve:\n${routes.map((r) => `${r.method} ${r.uri}`).join("\n")}`,
      ).toBe(true);
    } finally {
      await project.cleanup();
    }
  });
});
