/**
 * The three "declarative" scanners: Rails, Phoenix and Ktor.
 *
 * They share what makes them easy to read —routes live in a file,
 * not scattered across the code— and they also share the trap: a
 * `resources` is ONE line and FIVE endpoints. Counting it as a single
 * route would leave you with 20% of the API.
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

  // Rails generates SEVEN actions, but `new` and `edit` return
  // HTML forms: in a JSON API they do not exist, and adding them
  // would fill the collection with 404-returning endpoints. `update`
  // appears twice (PUT and PATCH) since a00010 / B-04 — Rails 5+
  // accepts both.
  test("omits the form actions (new, edit)", () => {
    const found = routes("Rails.application.routes.draw do\n  resources :users\nend");
    expect(found).toHaveLength(6);
    expect(found.some((r) => r.uri.includes("/new"))).toBe(false);
    expect(found.some((r) => r.uri.includes("/edit"))).toBe(false);
  });

  test("respects `only:`", () => {
    const found = routes(
      "Rails.application.routes.draw do\n  resources :users, only: [:index, :show]\nend",
    );
    expect(found.map((r) => r.method).sort()).toEqual(["GET", "GET"]);
  });

  test("respects `except:`", () => {
    const found = routes(
      "Rails.application.routes.draw do\n  resources :users, except: [:destroy]\nend",
    );
    expect(found.some((r) => r.method === "DELETE")).toBe(false);
  });

  // A singular resource always operates on "mine": there is no list
  // and no `:id` to pass.
  test("singular `resource` has no index and no :id", () => {
    const found = routes("Rails.application.routes.draw do\n  resource :profile\nend");
    expect(found.every((r) => !r.uri.includes("{id}"))).toBe(true);
    expect(found.filter((r) => r.method === "GET")).toHaveLength(1);
  });

  test("nested namespaces accumulate", () => {
    const found = routes(
      'Rails.application.routes.draw do\n  namespace :api do\n    namespace :v1 do\n      get "/x", to: "a#b"\n    end\n  end\nend',
    );
    expect(found[0]?.uri).toBe("/api/v1/x");
  });

  // a00011 C-1: the default path param is `{id}` (Rails official),
  // NOT the singular of the resource. The naive singularizer
  // (`users → user`) misbehaved with `categories → categorie`,
  // `people → people`, etc. — producing incorrect URLs with no warning.
  test("default path param is `{id}` (Rails 5+ default)", () => {
    const found = routes(
      "Rails.application.routes.draw do\n  resources :users\nend",
    );
    const withId = found.filter(
      (r) => r.uri.includes("{id}") && r.actionName !== undefined,
    );
    expect(withId.length).toBeGreaterThanOrEqual(3);
    // No REST endpoint carries `{user}` (the singularizer is
    // disabled by default).
    const withUser = found.filter(
      (r) => r.uri.includes("{user}") && r.actionName !== undefined,
    );
    expect(withUser).toHaveLength(0);
  });

  // a00011 C-1: `resources :users, param: :slug` is respected.
  test("`param: :other` overrides the path param", () => {
    const found = routes(
      "Rails.application.routes.draw do\n  resources :users, param: :slug\nend",
    );
    const withSlug = found.filter(
      (r) => r.uri.includes("{slug}") && r.actionName !== undefined,
    );
    expect(withSlug.length).toBeGreaterThanOrEqual(3);
    const withId = found.filter(
      (r) => r.uri.includes("{id}") && r.actionName !== undefined,
    );
    expect(withId).toHaveLength(0);
  });

  // a00010 / B-04: `update` produces two routes — PUT and PATCH.
  test("update produces PUT + PATCH (B-04 a00010)", () => {
    const found = routes(
      "Rails.application.routes.draw do\n  resources :users\nend",
    );
    const updates = found.filter((r) => r.actionName === "update");
    expect(updates.map((r) => r.method).sort()).toEqual(["PATCH", "PUT"]);
  });

  test.each([
    ["/users/:id", "/users/{id}"],
    ["/a/:x/b/:y", "/a/{x}/b/{y}"],
    ["/sin-params", "/sin-params"],
  ])("normalizeRailsParams %s → %s", (input, expected) => {
    expect(normalizeRailsParams(input)).toBe(expected);
  });

  test("detects via config/routes.rb + Gemfile", async () => {
    expect((await new RailsProjectScanner().detect(comprehensiveFixtureDir("rails"))).score).toBe(1);
  });

  test("the full scanner reads the fixture", async () => {
    const scanner = new RailsRouteScanner();
    const match = await new RailsProjectScanner().resolve(comprehensiveFixtureDir("rails"));
    expect((await scanner.scan(match)).routes.length).toBeGreaterThan(10);
  });
});

describe("Phoenix: nested scopes and resources", () => {
  const routes = (source: string) => parseRouter(source, "router.ex");

  test("scopes concatenate", () => {
    const found = routes(
      'defmodule R do\n  scope "/api" do\n    scope "/v1" do\n      get "/x", C, :y\n    end\n  end\nend',
    );
    expect(found[0]?.uri).toBe("/api/v1/x");
  });

  // `pipe_through :api` declares the plugs pipeline, not an endpoint.
  test("`pipe_through` is not a route", () => {
    const found = routes(
      'defmodule R do\n  scope "/api" do\n    pipe_through :api\n    get "/x", C, :y\n  end\nend',
    );
    expect(found).toHaveLength(1);
  });

  test("`resources` expands to five", () => {
    const found = routes('defmodule R do\n  resources "/users", UserController\nend');
    expect(found).toHaveLength(5);
  });

test("detects via mix.exs containing :phoenix", async () => {
    expect((await new PhoenixProjectScanner().detect(comprehensiveFixtureDir("phoenix"))).score).toBe(
      1,
    );
  });

  test("a project without phoenix scores 0", async () => {
    expect((await new PhoenixProjectScanner().detect(comprehensiveFixtureDir("rails"))).score).toBe(0);
  });

  test("the full scanner reads the fixture", async () => {
    const scanner = new PhoenixRouteScanner();
    const match = await new PhoenixProjectScanner().resolve(
      comprehensiveFixtureDir("phoenix"),
    );
    expect((await scanner.scan(match)).routes.length).toBeGreaterThan(10);
  });
});

describe("Ktor: the brace-nested DSL", () => {
  const routes = (source: string) => parseKotlinRouting(source, "App.kt");

  test("nested `route()` calls compose the path", () => {
    const found = routes(
      'routing {\n  route("/api") {\n    route("/users") {\n      get("/activos") { }\n    }\n  }\n}',
    );
    expect(found[0]?.uri).toBe("/api/users/activos");
  });

  // A `get { }` WITHOUT a path is valid in Ktor and inherits the
  // one from the wrapping `route`. Ignoring them would leave real
  // endpoints out.
  test("a `get { }` without path inherits the prefix", () => {
    const found = routes('routing {\n  route("/users") {\n    get { }\n    post { }\n  }\n}');
    expect(found.map((r) => `${r.method} ${r.uri}`).sort()).toEqual([
      "GET /users",
      "POST /users",
    ]);
  });

  test("the block closes on its brace", () => {
    const found = routes(
      'routing {\n  route("/a") {\n    get("/x") { }\n  }\n  get("/fuera") { }\n}',
    );
    expect(found.find((r) => r.uri === "/fuera")).toBeDefined();
  });

  test("a brace inside a string does not unbalance the stack", () => {
    const found = routes(
      'routing {\n  route("/a") {\n    get("/x") { call.respond("{no cuenta}") }\n  }\n  get("/fuera") { }\n}',
    );
    expect(found.find((r) => r.uri === "/fuera")).toBeDefined();
  });

  test("detects via the ktor dependency", async () => {
    expect((await new KtorProjectScanner().detect(comprehensiveFixtureDir("ktor"))).score).toBe(1);
  });

  test("the full scanner reads the fixture", async () => {
    const scanner = new KtorRouteScanner();
    const match = await new KtorProjectScanner().resolve(comprehensiveFixtureDir("ktor"));
    expect((await scanner.scan(match)).routes.length).toBeGreaterThan(5);
  });
});
