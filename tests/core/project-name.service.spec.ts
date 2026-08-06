/**
 * `detectProjectNameIn` — de dónde sale el nombre del proyecto.
 *
 * Importa más de lo que parece: el nombre entra en el `_postman_id`
 * determinista, que es lo que hace que reimportar el mismo proyecto
 * actualice su colección en Postman en vez de dejar una copia al lado.
 *
 * Antes esto solo leía `composer.json`, así que un proyecto Laravel se
 * identificaba por su paquete y los otros once por su carpeta.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { detectProjectNameIn } from "../../services/project-name.service";

let root = "";

/** Crea un proyecto temporal con los ficheros indicados. */
async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(root, "proj-"));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
  return dir;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "project-name-"));
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("un manifiesto por ecosistema", () => {
  test("package.json — JS/TS", async () => {
    const dir = await project({ "package.json": `{"name": "mi-api"}` });
    expect(await detectProjectNameIn(dir)).toBe("mi-api");
  });

  test("package.json con scope se queda con el paquete", async () => {
    const dir = await project({ "package.json": `{"name": "@acme/mi-api"}` });
    expect(await detectProjectNameIn(dir)).toBe("mi-api");
  });

  test("composer.json — PHP, quita el vendor", async () => {
    const dir = await project({ "composer.json": `{"name": "acme/tienda-api"}` });
    expect(await detectProjectNameIn(dir)).toBe("tienda-api");
  });

  test("pyproject.toml — Python", async () => {
    const dir = await project({
      "pyproject.toml": `[project]\nname = "pedidos-api"\nversion = "0.1.0"\n`,
    });
    expect(await detectProjectNameIn(dir)).toBe("pedidos-api");
  });

  test("go.mod — Go, último segmento del module path", async () => {
    const dir = await project({
      "go.mod": `module github.com/acme/facturacion\n\ngo 1.22\n`,
    });
    expect(await detectProjectNameIn(dir)).toBe("facturacion");
  });

  test("Cargo.toml — Rust", async () => {
    const dir = await project({
      "Cargo.toml": `[package]\nname = "envios-api"\nedition = "2021"\n`,
    });
    expect(await detectProjectNameIn(dir)).toBe("envios-api");
  });

  test("settings.gradle — Gradle", async () => {
    const dir = await project({
      "settings.gradle": `rootProject.name = 'catalogo-api'\n`,
    });
    expect(await detectProjectNameIn(dir)).toBe("catalogo-api");
  });

  test(".csproj — .NET usa el nombre del propio fichero", async () => {
    const dir = await project({ "Facturas.Api.csproj": `<Project Sdk="Microsoft.NET.Sdk" />` });
    expect(await detectProjectNameIn(dir)).toBe("Facturas.Api");
  });
});

describe("pom.xml — Maven", () => {
  test("lee el artifactId del proyecto", async () => {
    const dir = await project({
      "pom.xml": `<project><artifactId>almacen-api</artifactId></project>`,
    });
    expect(await detectProjectNameIn(dir)).toBe("almacen-api");
  });

  // El primer `<artifactId>` de un pom de Spring Boot está dentro de
  // `<parent>` y es el del BOM heredado. Sin saltárselo, TODOS los
  // proyectos Spring Boot del mundo se llamarían igual — y compartirían
  // `_postman_id`, que es lo grave.
  test("NO se queda con el artifactId del <parent>", async () => {
    const dir = await project({
      "pom.xml": `<project>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.0</version>
  </parent>
  <groupId>com.acme</groupId>
  <artifactId>almacen-api</artifactId>
</project>`,
    });
    expect(await detectProjectNameIn(dir)).toBe("almacen-api");
  });
});

describe("prioridad y fallbacks", () => {
  test("sin ningún manifiesto, el nombre de la carpeta", async () => {
    const dir = await project({ "README.md": "# hola" });
    expect(await detectProjectNameIn(dir)).toBe(dir.split("/").pop());
  });

  test("un manifiesto sin `name` no bloquea al siguiente", async () => {
    const dir = await project({
      "composer.json": `{"require": {"php": "^8.2"}}`,
      "package.json": `{"name": "el-que-vale"}`,
    });
    expect(await detectProjectNameIn(dir)).toBe("el-que-vale");
  });

  test("un manifiesto ilegible no rompe la detección", async () => {
    const dir = await project({
      "package.json": "{{{ esto no es json",
      "go.mod": "module acme/valido\n",
    });
    expect(await detectProjectNameIn(dir)).toBe("valido");
  });

  // Un backend Java con un front al lado: el pom manda, porque la lista
  // va de más específico a menos y `package.json` es el último.
  test("con backend y front en la misma raíz, gana el backend", async () => {
    const dir = await project({
      "pom.xml": `<project><artifactId>backend-api</artifactId></project>`,
      "package.json": `{"name": "frontend"}`,
    });
    expect(await detectProjectNameIn(dir)).toBe("backend-api");
  });

  test("una carpeta que no existe no lanza", async () => {
    const missing = join(root, "no-existe-zzz");
    await expect(detectProjectNameIn(missing)).resolves.toBe("no-existe-zzz");
  });

  test("es determinista: dos llamadas dan lo mismo", async () => {
    const dir = await project({ "package.json": `{"name": "estable"}` });
    expect(await detectProjectNameIn(dir)).toBe(await detectProjectNameIn(dir));
  });

  test("dos proyectos distintos dan nombres distintos", async () => {
    await mkdir(join(root, "uno"), { recursive: true });
    await mkdir(join(root, "dos"), { recursive: true });
    const a = await detectProjectNameIn(join(root, "uno"));
    const b = await detectProjectNameIn(join(root, "dos"));
    expect(a).not.toBe(b);
  });
});
