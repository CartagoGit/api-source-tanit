/**
 * Los tres scanners "declarativos": Rails, Phoenix y Ktor.
 *
 * Comparten lo que los hace fáciles de leer —las rutas viven en un
 * fichero, no repartidas por el código— y comparten también la trampa:
 * un `resources` es UNA línea y CINCO endpoints. Contarla como una ruta
 * sería quedarse con el 20% de la API.
 */
import { describe, expect, test } from "vitest";

import {
  RailsProjectScanner,
  RailsRouteScanner,
  normalizeRailsParams,
  parseRoutesFile,
} from "../../packages/frameworks/scanners/rails.scanner";
import {
  PhoenixProjectScanner,
  PhoenixRouteScanner,
  parseRouter,
} from "../../packages/frameworks/scanners/phoenix.scanner";
import {
  KtorProjectScanner,
  KtorRouteScanner,
  parseKotlinRouting,
} from "../../packages/frameworks/scanners/ktor.scanner";
import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir } from "../../scripts/helpers/root.helper";

describeScannerContract({
  framework: "rails",
  fixtureRoot: comprehensiveFixture("rails"),
  capabilities: { validation: false, pathParams: true, stripsComments: true },
  minimalProject: {
    Gemfile: 'source "https://rubygems.org"\ngem "rails"\n',
    "config/routes.rb":
      'Rails.application.routes.draw do\n  get "/vivo", to: "x#y"\nend\n',
  },
  commentedEndpoint: {
    file: "config/routes.rb",
    source: '  # get "/endpoint-comentado", to: "x#y"',
  },
});

describeScannerContract({
  framework: "phoenix",
  fixtureRoot: comprehensiveFixture("phoenix"),
  capabilities: { validation: false, pathParams: true, stripsComments: true },
  minimalProject: {
    "mix.exs": "defmodule M do\n  defp deps, do: [{:phoenix, \"~> 1.7\"}]\nend\n",
    "lib/m_web/router.ex":
      'defmodule MWeb.Router do\n  scope "/" do\n    get "/vivo", XController, :y\n  end\nend\n',
  },
  commentedEndpoint: {
    file: "lib/m_web/router.ex",
    source: '  # get "/endpoint-comentado", XController, :y',
  },
});

describeScannerContract({
  framework: "ktor",
  fixtureRoot: comprehensiveFixture("ktor"),
  capabilities: { validation: false, pathParams: true, stripsComments: true },
  minimalProject: {
    "build.gradle.kts": 'dependencies { implementation("io.ktor:ktor-server-core:2.3.8") }',
    "src/main/kotlin/App.kt":
      "fun Application.module() {\n  routing {\n    get(\"/vivo\") { }\n  }\n}\n",
  },
  commentedEndpoint: {
    file: "src/main/kotlin/App.kt",
    source: '    // get("/endpoint-comentado") { }',
  },
});

describe("Rails: `resources` expande a los endpoints REST", () => {
  const routes = (source: string) => parseRoutesFile(source, "config/routes.rb");

  // Rails genera SIETE acciones, pero `new` y `edit` devuelven
  // formularios HTML: en una API JSON no existen, y meterlas llenaría la
  // colección de endpoints que dan 404.
  test("omite las acciones de formulario (new, edit)", () => {
    const found = routes("Rails.application.routes.draw do\n  resources :users\nend");
    expect(found).toHaveLength(5);
    expect(found.some((r) => r.uri.includes("/new"))).toBe(false);
    expect(found.some((r) => r.uri.includes("/edit"))).toBe(false);
  });

  test("respeta `only:`", () => {
    const found = routes(
      "Rails.application.routes.draw do\n  resources :users, only: [:index, :show]\nend",
    );
    expect(found.map((r) => r.method).sort()).toEqual(["GET", "GET"]);
  });

  test("respeta `except:`", () => {
    const found = routes(
      "Rails.application.routes.draw do\n  resources :users, except: [:destroy]\nend",
    );
    expect(found.some((r) => r.method === "DELETE")).toBe(false);
  });

  // Un recurso singular opera siempre sobre "el mío": no hay listado ni
  // `:id` que pasar.
  test("`resource` singular no tiene index ni :id", () => {
    const found = routes("Rails.application.routes.draw do\n  resource :profile\nend");
    expect(found.every((r) => !r.uri.includes("{id}"))).toBe(true);
    expect(found.filter((r) => r.method === "GET")).toHaveLength(1);
  });

  test("los namespaces anidados se acumulan", () => {
    const found = routes(
      'Rails.application.routes.draw do\n  namespace :api do\n    namespace :v1 do\n      get "/x", to: "a#b"\n    end\n  end\nend',
    );
    expect(found[0]?.uri).toBe("/api/v1/x");
  });

  test.each([
    ["/users/:id", "/users/{id}"],
    ["/a/:x/b/:y", "/a/{x}/b/{y}"],
    ["/sin-params", "/sin-params"],
  ])("normalizeRailsParams %s → %s", (input, expected) => {
    expect(normalizeRailsParams(input)).toBe(expected);
  });

  test("detecta por config/routes.rb + Gemfile", async () => {
    expect((await new RailsProjectScanner().detect(comprehensiveFixtureDir("rails"))).score).toBe(1);
  });

  test("el scanner completo lee el fixture", async () => {
    const scanner = new RailsRouteScanner();
    const match = await new RailsProjectScanner().resolve(comprehensiveFixtureDir("rails"));
    expect((await scanner.scan(match)).routes.length).toBeGreaterThan(10);
  });
});

describe("Phoenix: scopes anidados y resources", () => {
  const routes = (source: string) => parseRouter(source, "router.ex");

  test("los scopes se concatenan", () => {
    const found = routes(
      'defmodule R do\n  scope "/api" do\n    scope "/v1" do\n      get "/x", C, :y\n    end\n  end\nend',
    );
    expect(found[0]?.uri).toBe("/api/v1/x");
  });

  // `pipe_through :api` declara el pipeline de plugs, no un endpoint.
  test("`pipe_through` no es una ruta", () => {
    const found = routes(
      'defmodule R do\n  scope "/api" do\n    pipe_through :api\n    get "/x", C, :y\n  end\nend',
    );
    expect(found).toHaveLength(1);
  });

  test("`resources` expande a cinco", () => {
    const found = routes('defmodule R do\n  resources "/users", UserController\nend');
    expect(found).toHaveLength(5);
  });

  test("detecta por mix.exs con :phoenix", async () => {
    expect((await new PhoenixProjectScanner().detect(comprehensiveFixtureDir("phoenix"))).score).toBe(
      1,
    );
  });

  test("un proyecto sin phoenix no puntúa", async () => {
    expect((await new PhoenixProjectScanner().detect(comprehensiveFixtureDir("rails"))).score).toBe(0);
  });

  test("el scanner completo lee el fixture", async () => {
    const scanner = new PhoenixRouteScanner();
    const match = await new PhoenixProjectScanner().resolve(
      comprehensiveFixtureDir("phoenix"),
    );
    expect((await scanner.scan(match)).routes.length).toBeGreaterThan(10);
  });
});

describe("Ktor: el DSL anidado por llaves", () => {
  const routes = (source: string) => parseKotlinRouting(source, "App.kt");

  test("los `route()` anidados componen el path", () => {
    const found = routes(
      'routing {\n  route("/api") {\n    route("/users") {\n      get("/activos") { }\n    }\n  }\n}',
    );
    expect(found[0]?.uri).toBe("/api/users/activos");
  });

  // Un `get { }` SIN path es válido en Ktor y hereda el del `route` que
  // lo envuelve. Ignorarlos dejaría fuera endpoints reales.
  test("un `get { }` sin path hereda el prefijo", () => {
    const found = routes('routing {\n  route("/users") {\n    get { }\n    post { }\n  }\n}');
    expect(found.map((r) => `${r.method} ${r.uri}`).sort()).toEqual([
      "GET /users",
      "POST /users",
    ]);
  });

  test("el bloque se cierra en su llave", () => {
    const found = routes(
      'routing {\n  route("/a") {\n    get("/x") { }\n  }\n  get("/fuera") { }\n}',
    );
    expect(found.find((r) => r.uri === "/fuera")).toBeDefined();
  });

  test("una llave dentro de una cadena no descuadra la pila", () => {
    const found = routes(
      'routing {\n  route("/a") {\n    get("/x") { call.respond("{no cuenta}") }\n  }\n  get("/fuera") { }\n}',
    );
    expect(found.find((r) => r.uri === "/fuera")).toBeDefined();
  });

  test("detecta por la dependencia de ktor", async () => {
    expect((await new KtorProjectScanner().detect(comprehensiveFixtureDir("ktor"))).score).toBe(1);
  });

  test("el scanner completo lee el fixture", async () => {
    const scanner = new KtorRouteScanner();
    const match = await new KtorProjectScanner().resolve(comprehensiveFixtureDir("ktor"));
    expect((await scanner.scan(match)).routes.length).toBeGreaterThan(5);
  });
});
