/**
 * Rust scanner (Actix-web and Rocket).
 *
 * Both live in the same scanner because they declare routes the
 * same way: an attribute macro above the handler. Splitting them
 * would duplicate the same parser to change two detection lines.
 *
 * What does differ is the path param —Rocket writes `<id>` and Actix
 * `{id}`— and that is normalized in the Rust-aware layer, not
 * further downstream.
 */
import { describe, expect, test } from "vitest";

import {
  RustProjectScanner,
  RustRouteScanner,
  RustValidatorProvider,
  normalizePathParams,
  parseRustStruct,
} from "../../packages/frameworks/scanners/rust.scanner";
import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture, createTempProject } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir } from "../../scripts/helpers/root.helper";

describeScannerContract({
  framework: "rust",
  fixtureRoot: comprehensiveFixture("rust"),
  capabilities: { validation: true, pathParams: true, stripsComments: false },
  minimalProject: {
    "Cargo.toml": '[package]\nname = "demo"\n\n[dependencies]\nactix-web = "4.5"\n',
    "src/main.rs":
      'use actix_web::get;\n\n#[get("/vivo")]\nasync fn vivo() -> &\'static str { "ok" }\n',
  },
});

const FIXTURE = comprehensiveFixtureDir("rust");

async function scanFixture() {
  const match = await new RustProjectScanner().resolve(FIXTURE);
  const scanner = new RustRouteScanner();
  const result = await scanner.scan(match);
  return { match, scanner, result, routes: result.routes };
}

describe("detection", () => {
  test("a Cargo.toml with actix-web scores 1", async () => {
    expect((await new RustProjectScanner().detect(FIXTURE)).score).toBe(1);
  });

  test("a Go project is not Rust", async () => {
    expect((await new RustProjectScanner().detect(comprehensiveFixtureDir("fiber"))).score).toBe(0);
  });
});

describe("routes", () => {
  test("reads the attribute macros", async () => {
    const { routes } = await scanFixture();
    expect(routes.some((r) => r.method === "GET" && r.uri.endsWith("/health"))).toBe(true);
    expect(routes.some((r) => r.method === "DELETE")).toBe(true);
  });

  test("the web::scope prefix is applied", async () => {
    const { routes } = await scanFixture();
    expect(routes.every((r) => r.uri.startsWith("/api/"))).toBe(true);
  });
});

describe("normalizePathParams", () => {
  // Rocket and Actix write the same concept differently. Unifying
  // here prevents each downstream layer from needing to know both
  // dialects.
  test.each([
    ["/users/<id>", "/users/{id}"],
    ["/users/{id}", "/users/{id}"],
    ["/files/<path..>", "/files/{path}"],
    ["/a/<x>/b/<y>", "/a/{x}/b/{y}"],
    ["/sin-params", "/sin-params"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePathParams(input)).toBe(expected);
  });
});

describe("structs con validator y serde", () => {
  const source = `
#[derive(Deserialize, Validate)]
pub struct Ejemplo {
    #[validate(length(min = 1, max = 100))]
    pub nombre: String,
    #[validate(email)]
    pub correo: String,
    pub edad: Option<i32>,
    #[serde(rename = "userRole")]
    pub role: String,
    pub etiquetas: Vec<String>,
}
`;

  // In Rust optionality is marked on the TYPE (`Option<T>`), not on
  // an attribute: that is the key difference from the other
  // ecosystems.
  test("Option<T> means optional", () => {
    const byName = new Map(parseRustStruct(source, "Ejemplo").map((f) => [f.fieldName, f]));
    expect(byName.get("nombre")?.required).toBe(true);
    expect(byName.get("edad")?.required).toBe(false);
  });

  // `#[serde(rename)]` changes the name that travels over the wire:
  // sending `role` instead of `userRole` would be a field the API
  // does not expect.
  test("respects the serde rename", () => {
    const names = parseRustStruct(source, "Ejemplo").map((f) => f.fieldName);
    expect(names).toContain("userRole");
    expect(names).not.toContain("role");
  });

  test("maps the Rust types", () => {
    const byName = new Map(
      parseRustStruct(source, "Ejemplo").map((f) => [f.fieldName, f.type]),
    );
    expect(byName.get("nombre")).toBe("string");
    expect(byName.get("edad")).toBe("integer");
    expect(byName.get("etiquetas")).toBe("array");
  });

  test("reads the format from validate(email)", () => {
    const byName = new Map(parseRustStruct(source, "Ejemplo").map((f) => [f.fieldName, f]));
    expect(byName.get("correo")?.format).toBe("email");
  });

  test("a struct that does not exist returns empty", () => {
    expect(parseRustStruct(source, "NoExiste")).toEqual([]);
  });
});

describe("the provider resolves the handler body", () => {
  test("a POST with web::Json<T> brings its fields", async () => {
    const { match, result, routes } = await scanFixture();
    const provider = new RustValidatorProvider();
    const post = routes.find((r) => r.method === "POST" && r.uri.endsWith("/users"))!;

    const { fields } = await provider.resolve(post, match, result);
    expect(fields.map((f) => f.fieldName)).toContain("email");
  });

  test("a GET without Json<T> does not fake rules", async () => {
    const { match, result, routes } = await scanFixture();
    const provider = new RustValidatorProvider();
    const health = routes.find((r) => r.uri.endsWith("/health"))!;
    expect(await provider.supports(health, match, result)).toBe(false);
  });

  test("two concurrent scans do not mix structs", async () => {
    const projects = await Promise.all([
      createTempProject({
        "Cargo.toml": '[package]\nname = "rust-a"\n\n[dependencies]\nactix-web = "4.5"\n',
        "src/main.rs": 'use actix_web::{post, web::Json};\nstruct CreateA {\n    tag_a: String,\n}\n#[post("/a")]\nasync fn a(body: web::Json<CreateA>) -> String { String::new() }\n',
      }, "rust-concurrent-a-"),
      createTempProject({
        "Cargo.toml": '[package]\nname = "rust-b"\n\n[dependencies]\nactix-web = "4.5"\n',
        "src/main.rs": 'use actix_web::{post, web::Json};\nstruct CreateB {\n    tag_b: String,\n}\n#[post("/b")]\nasync fn b(body: web::Json<CreateB>) -> String { String::new() }\n',
      }, "rust-concurrent-b-"),
    ]);
    try {
      const results = await Promise.all(projects.map(async (project) => {
        const match = await new RustProjectScanner().resolve(project.root);
        return new RustRouteScanner().scan(match);
      }));
      expect(results[0]?.structs?.get("POST /a")?.name).toBe("CreateA");
      expect(results[0]?.structs?.has("POST /b")).toBe(false);
      expect(results[1]?.structs?.get("POST /b")?.name).toBe("CreateB");
      expect(results[1]?.structs?.has("POST /a")).toBe(false);
    } finally {
      await Promise.all(projects.map((project) => project.cleanup()));
    }
  });
});

describe("Rust — Rocket detection", () => {
  test("detect() > 0 with a Cargo.toml that contains rocket", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "Cargo.toml": '[package]\nname = "demo"\n\n[dependencies]\nrocket = "0.5"\n',
      "src/main.rs": '#[macro_use] extern crate rocket;\n\n#[get("/health")]\nfn health() -> &\'static str { "ok" }\n',
    });
    try {
      expect((await new RustProjectScanner().detect(project.root)).score).toBeGreaterThan(0);
    } finally {
      await project.cleanup();
    }
  });

  test("detect() === 0 when Cargo.toml has neither actix-web nor rocket", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "Cargo.toml": '[package]\nname = "demo"\n\n[dependencies]\nserde = "1.0"\n',
    });
    try {
      expect((await new RustProjectScanner().detect(project.root)).score).toBe(0);
    } finally {
      await project.cleanup();
    }
  });

  test("Rocket <param> → {param} in the URI (normalizePathParams)", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "Cargo.toml": '[package]\nname = "demo"\n\n[dependencies]\nrocket = "0.5"\n',
      "src/main.rs": [
        '#[macro_use] extern crate rocket;',
        '#[get("/users/<id>")]',
        'fn show_user(id: u64) -> String { id.to_string() }',
        '#[get("/files/<path..>")]',
        'fn serve_file(path: std::path::PathBuf) -> String { "ok".into() }',
      ].join("\n"),
    });
    try {
      const match = await new RustProjectScanner().resolve(project.root);
      const result = await new RustRouteScanner().scan(match);
      const routes = result.routes;
      const uris = routes.map((r) => r.uri);
      expect(uris.some((u) => u.includes("{id}"))).toBe(true);
      expect(uris.some((u) => u.includes("{path}"))).toBe(true);
    } finally {
      await project.cleanup();
    }
  });
});

describe("Rust — programmatic routes and multi-scope", () => {
  test(".route('/x', web::get()) generates programmatic routes", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "Cargo.toml": '[package]\nname = "demo"\n\n[dependencies]\nactix-web = "4"\n',
      "src/main.rs": [
        "use actix_web::{web, App, HttpServer, HttpResponse};",
        "async fn list_items() -> HttpResponse { HttpResponse::Ok().finish() }",
        "async fn create_item() -> HttpResponse { HttpResponse::Created().finish() }",
        "#[actix_web::main]",
        "async fn main() {",
        "    HttpServer::new(|| {",
        "        App::new()",
        '            .route("/items", web::get().to(list_items))',
        '            .route("/items", web::post().to(create_item))',
        "    });",
        "}",
      ].join("\n"),
    });
    try {
      const match = await new RustProjectScanner().resolve(project.root);
      const result = await new RustRouteScanner().scan(match);
      const pairs = result.routes.map((r) => `${r.method} ${r.uri}`);
      expect(pairs).toContain("GET /items");
      expect(pairs).toContain("POST /items");
    } finally {
      await project.cleanup();
    }
  });

  test("multiple web::scope in the same file → empty prefix (ambiguous)", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "Cargo.toml": '[package]\nname = "demo"\n\n[dependencies]\nactix-web = "4"\n',
      "src/main.rs": [
        "use actix_web::{web, get};",
        '#[get("/ping")]',
        'async fn ping() -> &\'static str { "pong" }',
        "fn config(cfg: &mut web::ServiceConfig) {",
        '    cfg.service(web::scope("/api").service(ping));',
        '    cfg.service(web::scope("/v2").service(ping));',
        "}",
      ].join("\n"),
    });
    try {
      const match = await new RustProjectScanner().resolve(project.root);
      const result = await new RustRouteScanner().scan(match);
      // With multiple scopes the prefix stays empty to avoid assigning
      // it incorrectly
      const uris = result.routes.map((r) => r.uri);
      expect(uris).toContain("/ping");
    } finally {
      await project.cleanup();
    }
  });
});

describe("Rust — parseRustStruct tipos adicionales", () => {
  const source = `
pub struct Metadata {
    #[validate(url)]
    pub website: String,
    #[validate(range(min = 1, max = 100))]
    pub score: i32,
    pub data: serde_json::Value,
}
`;

  test("format url is detected in validate(url)", () => {
    const fields = parseRustStruct(source, "Metadata");
    expect(fields.find((f) => f.fieldName === "website")?.format).toBe("url");
  });

  test("unknown type (serde_json::Value) maps to object", () => {
    const fields = parseRustStruct(source, "Metadata");
    expect(fields.find((f) => f.fieldName === "data")?.type).toBe("object");
  });
});
