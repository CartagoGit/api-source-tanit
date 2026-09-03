/**
 * Scanner de Rust (Actix-web y Rocket).
 *
 * Los dos van en el mismo scanner porque declaran las rutas igual: un
 * macro de atributo encima del handler. Separarlos sería duplicar el
 * mismo parser para cambiar dos líneas de detección.
 *
 * Lo que sí difiere es el path param —Rocket escribe `<id>` y Actix
 * `{id}`— y eso se normaliza en la capa que sabe de Rust, no aguas
 * abajo.
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
import { comprehensiveFixture } from "../helpers/scanner-fixture";
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

describe("detección", () => {
  test("un Cargo.toml con actix-web puntúa 1", async () => {
    expect((await new RustProjectScanner().detect(FIXTURE)).score).toBe(1);
  });

  test("un proyecto de Go no es Rust", async () => {
    expect((await new RustProjectScanner().detect(comprehensiveFixtureDir("fiber"))).score).toBe(0);
  });
});

describe("rutas", () => {
  test("lee los macros de atributo", async () => {
    const { routes } = await scanFixture();
    expect(routes.some((r) => r.method === "GET" && r.uri.endsWith("/health"))).toBe(true);
    expect(routes.some((r) => r.method === "DELETE")).toBe(true);
  });

  test("el prefijo del web::scope se aplica", async () => {
    const { routes } = await scanFixture();
    expect(routes.every((r) => r.uri.startsWith("/api/"))).toBe(true);
  });
});

describe("normalizePathParams", () => {
  // Rocket y Actix escriben el mismo concepto distinto. Unificar aquí
  // evita que cada capa de abajo tenga que conocer los dos dialectos.
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

  // En Rust lo opcional se marca en el TIPO (`Option<T>`), no en un
  // atributo: es la diferencia clave con los otros ecosistemas.
  test("Option<T> significa opcional", () => {
    const byName = new Map(parseRustStruct(source, "Ejemplo").map((f) => [f.fieldName, f]));
    expect(byName.get("nombre")?.required).toBe(true);
    expect(byName.get("edad")?.required).toBe(false);
  });

  // `#[serde(rename)]` cambia el nombre que viaja por la red: mandar
  // `role` en vez de `userRole` sería un campo que la API no espera.
  test("respeta el rename de serde", () => {
    const names = parseRustStruct(source, "Ejemplo").map((f) => f.fieldName);
    expect(names).toContain("userRole");
    expect(names).not.toContain("role");
  });

  test("mapea los tipos de Rust", () => {
    const byName = new Map(
      parseRustStruct(source, "Ejemplo").map((f) => [f.fieldName, f.type]),
    );
    expect(byName.get("nombre")).toBe("string");
    expect(byName.get("edad")).toBe("integer");
    expect(byName.get("etiquetas")).toBe("array");
  });

  test("lee el format de validate(email)", () => {
    const byName = new Map(parseRustStruct(source, "Ejemplo").map((f) => [f.fieldName, f]));
    expect(byName.get("correo")?.format).toBe("email");
  });

  test("un struct que no existe devuelve vacío", () => {
    expect(parseRustStruct(source, "NoExiste")).toEqual([]);
  });
});

describe("el provider resuelve el body del handler", () => {
  test("un POST con web::Json<T> trae sus campos", async () => {
    const { match, result, routes } = await scanFixture();
    const provider = new RustValidatorProvider();
    const post = routes.find((r) => r.method === "POST" && r.uri.endsWith("/users"))!;

    const { fields } = await provider.resolve(post, match, result);
    expect(fields.map((f) => f.fieldName)).toContain("email");
  });

  test("un GET sin Json<T> no finge reglas", async () => {
    const { match, result, routes } = await scanFixture();
    const provider = new RustValidatorProvider();
    const health = routes.find((r) => r.uri.endsWith("/health"))!;
    expect(await provider.supports(health, match, result)).toBe(false);
  });
});

describe("Rust — detección Rocket", () => {
  test("detect() > 0 con Cargo.toml que tiene rocket", async () => {
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

  test("detect() === 0 cuando Cargo.toml no tiene actix-web ni rocket", async () => {
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

  test("Rocket <param> → {param} en la URI (normalizePathParams)", async () => {
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

describe("Rust — rutas programáticas y scope múltiple", () => {
  test(".route('/x', web::get()) genera rutas programáticas", async () => {
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

  test("múltiples web::scope en el mismo archivo → prefijo vacío (ambiguo)", async () => {
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
      // Con múltiples scopes el prefijo queda vacío para evitar asignarlo mal
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

  test("format url se detecta en validate(url)", () => {
    const fields = parseRustStruct(source, "Metadata");
    expect(fields.find((f) => f.fieldName === "website")?.format).toBe("url");
  });

  test("tipo desconocido (serde_json::Value) mapea a object", () => {
    const fields = parseRustStruct(source, "Metadata");
    expect(fields.find((f) => f.fieldName === "data")?.type).toBe("object");
  });
});
