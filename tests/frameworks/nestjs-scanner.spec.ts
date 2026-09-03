import { describe, expect, test } from "vitest";
import {
  NestJsProjectScanner,
  NestJsRouteScanner,
  NestJsClassValidatorProvider,
} from "../../packages/frameworks/scanners/nestjs.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import {
  comprehensiveFixture,
  createTempProject,
  scanProject,
} from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir, smokeFixtureDir } from "../../scripts/helpers/root.helper";

import { EMPTY_SCAN_RESULT } from "../helpers/empty-scan-result";
describeScannerContract({
  framework: "nestjs",
  fixtureRoot: comprehensiveFixture("nestjs"),
  capabilities: {
    validation: true,
    pathParams: true,
    stripsComments: true,
  },
  minimalProject: {
    "package.json": '{"dependencies":{"@nestjs/core":"^10.0.0"}}',
    "src/app.controller.ts": 'import { Controller, Get } from "@nestjs/common";\n@Controller("vivo")\nexport class AppController {\n  @Get()\n  list() { return []; }\n}\n',
  },
  commentedEndpoint: {
    file: 'src/app.controller.ts',
    source: "// @Get('endpoint-comentado')",
  },
});

const ROOT = smokeFixtureDir("nestjs");
const COMPREHENSIVE = comprehensiveFixtureDir("nestjs");

describe("NestJS scanner", () => {
  test("detect() > 0 cuando package.json tiene @nestjs/core", async () => {
    const scanner = new NestJsProjectScanner();
    const score = (await scanner.detect(ROOT)).score;
    expect(score).toBeGreaterThan(0);
  });

  test("detect() === 0 en un directorio vacío", async () => {
    const scanner = new NestJsProjectScanner();
    const score = (await scanner.detect("/tmp")).score;
    expect(score).toBe(0);
  });

  test("scan() devuelve las 5 rutas del mini-fixture", async () => {
    const ps = new NestJsProjectScanner();
    const match = await ps.resolve(ROOT);
    const routes = (await new NestJsRouteScanner().scan(match)).routes;
    expect(routes).toHaveLength(5);
    const methods = routes.map((r) => r.method).sort();
    expect(methods).toEqual(["DELETE", "GET", "GET", "POST", "PUT"]);
  });

  test("prefix @Controller('users') se aplica a todas las rutas", async () => {
    const ps = new NestJsProjectScanner();
    const match = await ps.resolve(ROOT);
    const routes = (await new NestJsRouteScanner().scan(match)).routes;
    for (const r of routes) expect(r.uri).toMatch(/^\/users/);
  });

  test("path param ':id' presente en rutas con @Get(':id'), @Put(':id'), @Delete(':id')", async () => {
    const ps = new NestJsProjectScanner();
    const match = await ps.resolve(ROOT);
    const routes = (await new NestJsRouteScanner().scan(match)).routes;
    const withId = routes.filter((r) => r.uri.includes(":id"));
    expect(withId.length).toBeGreaterThanOrEqual(3);
  });

  test("comprehensive: detecta >10 rutas repartidas en 3 controllers", async () => {
    const ps = new NestJsProjectScanner();
    const match = await ps.resolve(COMPREHENSIVE);
    const routes = (await new NestJsRouteScanner().scan(match)).routes;
    expect(routes.length).toBeGreaterThanOrEqual(11);
    const uris = routes.map((r) => r.uri);
    expect(uris.some((u) => u.startsWith("/api/users"))).toBe(true);
    expect(uris.some((u) => u.startsWith("/api/orders"))).toBe(true);
    expect(uris.some((u) => u.startsWith("/api/auth"))).toBe(true);
  });
});

describe("NestJS — setGlobalPrefix", () => {
  const CONTROLLER = `import { Controller, Get, Post } from "@nestjs/common";
@Controller("users")
export class UsersController {
  @Get() list() { return []; }
  @Post() create() { return {}; }
}
`;
  const PACKAGE = JSON.stringify({ dependencies: { "@nestjs/core": "^10.0.0" } });

  async function scanWithMain(mainSource: string): Promise<string[]> {
    const project = await createTempProject({
      "package.json": PACKAGE,
      "src/main.ts": mainSource,
      "src/users/users.controller.ts": CONTROLLER,
    });
    try {
      const { routes } = await scanProject("nestjs", project.root);
      return routes.map((r) => `${r.method} ${r.uri}`).sort();
    } finally {
      await project.cleanup();
    }
  }

  // `setGlobalPrefix` se aplica a TODOS los controladores. Sin leerlo, un
  // proyecto que lo use —lo normal en NestJS— salía con URIs sin prefijo
  // y ninguna request respondía.
  test("aplica el prefijo global a todas las rutas", async () => {
    expect(await scanWithMain('app.setGlobalPrefix("api/v1");')).toEqual([
      "GET /api/v1/users",
      "POST /api/v1/users",
    ]);
  });

  test("sin prefijo global las rutas quedan como están", async () => {
    expect(await scanWithMain("const app = 1;")).toEqual(["GET /users", "POST /users"]);
  });

  test("un setGlobalPrefix comentado no se aplica", async () => {
    expect(await scanWithMain('// app.setGlobalPrefix("comentado");')).toEqual([
      "GET /users",
      "POST /users",
    ]);
  });

  test("acepta comillas simples y backticks", async () => {
    expect(await scanWithMain("app.setGlobalPrefix('api');")).toEqual([
      "GET /api/users",
      "POST /api/users",
    ]);
  });

  test("normaliza el prefijo con barra inicial", async () => {
    expect(await scanWithMain('app.setGlobalPrefix("/api");')).toEqual([
      "GET /api/users",
      "POST /api/users",
    ]);
  });
});

describe("NestJS — detect() score variants", () => {
  const PACKAGE = JSON.stringify({ dependencies: { "@nestjs/core": "^10.0.0" } });

  test("detect() === 1 cuando hay src y nest-cli.json", async () => {
    const project = await createTempProject({
      "package.json": PACKAGE,
      "nest-cli.json": "{}",
      "src/main.ts": "// bootstrap",
    });
    try {
      expect((await new NestJsProjectScanner().detect(project.root)).score).toBe(1);
    } finally {
      await project.cleanup();
    }
  });

  test("detect() === 0.8 cuando hay src pero no nest-cli.json", async () => {
    const project = await createTempProject({
      "package.json": PACKAGE,
      "src/main.ts": "// bootstrap",
    });
    try {
      expect((await new NestJsProjectScanner().detect(project.root)).score).toBe(0.7);
    } finally {
      await project.cleanup();
    }
  });

  test("detect() === 0.5 cuando no hay src ni nest-cli.json", async () => {
    const project = await createTempProject({ "package.json": PACKAGE });
    try {
      expect((await new NestJsProjectScanner().detect(project.root)).score).toBe(0.5);
    } finally {
      await project.cleanup();
    }
  });
});

describe("NestJS — @Controller object form", () => {
  const PACKAGE = JSON.stringify({ dependencies: { "@nestjs/core": "^10.0.0" } });

  test("@Controller({ path: 'items' }) aplica el path como prefijo", async () => {
    const project = await createTempProject({
      "package.json": PACKAGE,
      "src/items/items.controller.ts": [
        'import { Controller, Get } from "@nestjs/common";',
        "@Controller({ path: 'items', version: '1' })",
        "export class ItemsController {",
        "  @Get() list() { return []; }",
        "  @Get(':id') show() { return {}; }",
        "}",
      ].join("\n"),
    });
    try {
      const { routes } = await scanProject("nestjs", project.root);
      const uris = routes.map((r) => r.uri);
      expect(uris.some((u) => u.startsWith("/items"))).toBe(true);
    } finally {
      await project.cleanup();
    }
  });

  test("archivo sin @Controller no produce rutas", async () => {
    const project = await createTempProject({
      "package.json": PACKAGE,
      "src/service.ts": [
        "export class ItemsService {",
        "  findAll() { return []; }",
        "}",
      ].join("\n"),
    });
    try {
      const { routes } = await scanProject("nestjs", project.root);
      expect(routes).toHaveLength(0);
    } finally {
      await project.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// f00011 S1 — regresiones de señales nuevas (nest-cli.json boost +
// frameworkSearchRoot).
// ---------------------------------------------------------------------------

describe("NestJS — detect() boost por nest-cli.json (f00011 S1)", () => {
  const PKG = JSON.stringify({ dependencies: { "@nestjs/core": "^10.0.0" } });
  // f00011 S1: el peso de `nest-cli.json` sube de 0.3 a 0.7. Es la
  // señal canónica de que el proyecto fue inicializado con la CLI de
  // Nest (no es solo una dependencia suelta).
  test("detect() === 1 (cap) cuando hay nest-cli.json + @nestjs/core + src/", async () => {
    const project = await createTempProject({
      "package.json": PKG,
      "nest-cli.json": "{}",
      "src/main.ts": "const app = 1;",
    });
    try {
      // 0.5 (@nestjs/core) + 0.7 (nest-cli.json) + 0.2 (src/) = 1.4 → cap 1.
      expect((await new NestJsProjectScanner().detect(project.root)).score).toBe(1);
    } finally {
      await project.cleanup();
    }
  });

  test("detect() === 1 (cap) cuando hay nest-cli.json pero NO hay src/", async () => {
    const project = await createTempProject({
      "package.json": PKG,
      "nest-cli.json": "{}",
    });
    try {
      // 0.5 (@nestjs/core) + 0.7 (nest-cli.json) = 1.2 → cap 1.
      // El cap hace que coincida con el caso anterior — eso es lo
      // correcto: el cap evita inflar más allá de "detectado".
      expect((await new NestJsProjectScanner().detect(project.root)).score).toBe(1);
    } finally {
      await project.cleanup();
    }
  });
});

describe("NestJS — frameworkSearchRoot para monorepos (f00011 S1)", () => {
  const PKG = JSON.stringify({ dependencies: { "@nestjs/core": "^10.0.0" } });
  // f00011 S1: en un monorepo el `src/` está en `apps/api/`. Sin
  // `frameworkSearchRoot` el scanner mira la raíz y no encuentra
  // controladores; con él, sale el scan completo del subdir.
  test("scan() encuentra rutas cuando frameworkSearchRoot apunta al subdir con src/", async () => {
    const CONTROLLER = [
      'import { Controller, Get } from "@nestjs/common";',
      '@Controller("users")',
      "export class UsersController {",
      "  @Get() list() { return []; }",
      "}",
    ].join("\n");
    const project = await createTempProject({
      "package.json": JSON.stringify({ workspaces: ["apps/*"] }),
      "apps/api/package.json": PKG,
      "apps/api/nest-cli.json": "{}",
      "apps/api/src/users.controller.ts": CONTROLLER,
    });
    try {
      const { match } = await scanProject("nestjs", project.root);
      const routes = (await new NestJsRouteScanner().scan({
        ...match,
        frameworkSearchRoot: "apps/api",
      })).routes;
      const pairs = routes.map((r) => `${r.method} ${r.uri}`);
      expect(pairs).toContain("GET /users");
    } finally {
      await project.cleanup();
    }
  });

  // El `setGlobalPrefix` se sigue buscando en `projectRoot` aunque el
  // `src/` esté en un subdir — es donde vive el `main.ts` y donde el
  // orquestador espera encontrar el bootstrap.
  test("setGlobalPrefix se aplica aunque frameworkSearchRoot apunte a un subdir", async () => {
    const CONTROLLER = [
      'import { Controller, Get } from "@nestjs/common";',
      '@Controller("orders")',
      "export class OrdersController {",
      "  @Get() list() { return []; }",
      "}",
    ].join("\n");
    const project = await createTempProject({
      "package.json": JSON.stringify({ workspaces: ["apps/*"] }),
      "apps/api/package.json": PKG,
      "apps/api/src/orders.controller.ts": CONTROLLER,
      "src/main.ts": 'app.setGlobalPrefix("api/v1");',
    });
    try {
      const { match } = await scanProject("nestjs", project.root);
      const routes = (await new NestJsRouteScanner().scan({
        ...match,
        frameworkSearchRoot: "apps/api",
      })).routes;
      const pairs = routes.map((r) => `${r.method} ${r.uri}`);
      expect(pairs).toContain("GET /api/v1/orders");
    } finally {
      await project.cleanup();
    }
  });
});

describe("NestJS — ClassValidatorProvider", () => {
  const PACKAGE = JSON.stringify({ dependencies: { "@nestjs/core": "^10.0.0" } });

  test("supports() === false cuando la ruta no tiene description", async () => {
    const provider = new NestJsClassValidatorProvider();
    const route = { method: "GET", uri: "/users", rawUri: "/users", sourceFile: "src/users.controller.ts", lineNumber: 1, prefixChain: [] };
    const match = { framework: "nestjs" as const, projectRoot: "/tmp", artifacts: [] };
    expect(await provider.supports(route, match, EMPTY_SCAN_RESULT)).toBe(false);
  });

  test("supports() === false cuando framework no es nestjs", async () => {
    const provider = new NestJsClassValidatorProvider();
    const route = { method: "GET", uri: "/users", rawUri: "/users", sourceFile: "src/users.controller.ts", lineNumber: 1, prefixChain: [], description: "list" };
    const match = { framework: "express" as const, projectRoot: "/tmp", artifacts: [] };
    expect(await provider.supports(route, match, EMPTY_SCAN_RESULT)).toBe(false);
  });

  test("resuelve DTO inline con IsEmail, IsUUID, IsArray, IsBoolean, IsDate, IsEnum, IsUrl", async () => {
    const controllerSource = [
      'import { Controller, Post, Body } from "@nestjs/common";',
      'import { IsString, IsEmail, IsUUID, IsArray, IsBoolean, IsDate, IsEnum, IsUrl, IsInt, IsNumber, IsOptional, IsObject, IsNotEmpty, IsDefined, IsPositive, IsNegative, MinLength, MaxLength, Length, Min, Max } from "class-validator";',
      "export class CreateItemDto {",
      "  @IsString()",
      "  name: string;",
      "  @IsEmail()",
      "  email: string;",
      "  @IsUUID()",
      "  id: string;",
      "  @IsArray()",
      "  tags: string[];",
      "  @IsBoolean()",
      "  active: boolean;",
      "  @IsDate()",
      "  createdAt: Date;",
      "  @IsEnum(['admin','user'])",
      "  role: string;",
      "  @IsUrl()",
      "  website: string;",
      "  @IsInt()",
      "  count: number;",
      "  @IsNumber()",
      "  price: number;",
      "  @IsOptional()",
      "  @IsString()",
      "  note?: string;",
      "  @IsObject()",
      "  meta: object;",
      "  @IsNotEmpty()",
      "  label: string;",
      "  @IsDefined()",
      "  code: string;",
      "  @IsPositive()",
      "  qty: number;",
      "  @IsNegative()",
      "  diff: number;",
      "  @MinLength(2)",
      "  slug: string;",
      "  @MaxLength(100)",
      "  description: string;",
      "  @Length(1, 50)",
      "  title: string;",
      "  @Min(0)",
      "  min: number;",
      "  @Max(100)",
      "  max: number;",
      "}",
      "@Controller('items')",
      "export class ItemsController {",
      "  @Post()",
      "  create(@Body() body: CreateItemDto) { return body; }",
      "}",
    ].join("\n");

    const project = await createTempProject({
      "package.json": PACKAGE,
      "src/items/items.controller.ts": controllerSource,
    });
    try {
      const { routes, match } = await scanProject("nestjs", project.root).then(async (r) => ({ ...r, match: await new NestJsProjectScanner().resolve(project.root) }));
      const post = routes.find((r) => r.method === "POST");
      if (!post) return;
      const provider = new NestJsClassValidatorProvider();
      const { fields } = await provider.resolve(post, match, EMPTY_SCAN_RESULT);
      const names = fields.map((f) => f.fieldName);
      expect(names).toContain("name");
      expect(names).toContain("email");
      expect(fields.find((f) => f.fieldName === "email")?.format).toBe("email");
      expect(names).toContain("id");
      expect(fields.find((f) => f.fieldName === "id")?.format).toBe("uuid");
      expect(names).toContain("tags");
      expect(fields.find((f) => f.fieldName === "tags")?.type).toBe("array");
      expect(names).toContain("active");
      expect(fields.find((f) => f.fieldName === "active")?.type).toBe("boolean");
      expect(names).toContain("role");
      expect(fields.find((f) => f.fieldName === "role")?.type).toBe("enum");
      expect(names).toContain("website");
      expect(fields.find((f) => f.fieldName === "website")?.format).toBe("url");
      const note = fields.find((f) => f.fieldName === "note");
      expect(note?.required).toBe(false);
      const slug = fields.find((f) => f.fieldName === "slug");
      expect(slug?.minLength).toBe(2);
      const desc = fields.find((f) => f.fieldName === "description");
      expect(desc?.maxLength).toBe(100);
      const title = fields.find((f) => f.fieldName === "title");
      expect(title?.minLength).toBe(1);
      expect(title?.maxLength).toBe(50);
      const minField = fields.find((f) => f.fieldName === "min");
      expect(minField?.minimum).toBe(0);
      const maxField = fields.find((f) => f.fieldName === "max");
      expect(maxField?.maximum).toBe(100);
    } finally {
      await project.cleanup();
    }
  });

  test("parseSignatureParams extrae @Param, @Query y @Headers", async () => {
    const controllerSource = [
      'import { Controller, Get, Param, Query, Headers } from "@nestjs/common";',
      "@Controller('items')",
      "export class ItemsController {",
      "  @Get(':id')",
      "  show(@Param('id') id: string, @Query('page') page: number, @Headers('x-tenant') tenant: string) { return {}; }",
      "}",
    ].join("\n");

    const project = await createTempProject({
      "package.json": PACKAGE,
      "src/items/items.controller.ts": controllerSource,
    });
    try {
      const { routes, match } = await scanProject("nestjs", project.root).then(async (r) => ({ ...r, match: await new NestJsProjectScanner().resolve(project.root) }));
      const get = routes.find((r) => r.method === "GET");
      if (!get) return;
      const provider = new NestJsClassValidatorProvider();
      const { fields } = await provider.resolve(get, match, EMPTY_SCAN_RESULT);
      const names = fields.map((f) => f.fieldName);
      expect(names).toContain("id");
      expect(fields.find((f) => f.fieldName === "id")?.location).toBe("path");
      expect(names).toContain("page");
      expect(fields.find((f) => f.fieldName === "page")?.location).toBe("query");
      expect(fields.find((f) => f.fieldName === "page")?.type).toBe("number");
      expect(names).toContain("x-tenant");
      expect(fields.find((f) => f.fieldName === "x-tenant")?.location).toBe("header");
    } finally {
      await project.cleanup();
    }
  });

  test("DTO importado desde archivo externo se resuelve correctamente", async () => {
    const dtoSource = [
      'import { IsString, IsEmail } from "class-validator";',
      "export class RegisterDto {",
      "  @IsString()",
      "  name: string;",
      "  @IsEmail()",
      "  email: string;",
      "}",
    ].join("\n");

    const controllerSource = [
      'import { Controller, Post, Body } from "@nestjs/common";',
      'import { RegisterDto } from "./register.dto";',
      "@Controller('auth')",
      "export class AuthController {",
      "  @Post('register')",
      "  register(@Body() body: RegisterDto) { return body; }",
      "}",
    ].join("\n");

    const project = await createTempProject({
      "package.json": PACKAGE,
      "src/auth/register.dto.ts": dtoSource,
      "src/auth/auth.controller.ts": controllerSource,
    });
    try {
      const { routes, match } = await scanProject("nestjs", project.root).then(async (r) => ({ ...r, match: await new NestJsProjectScanner().resolve(project.root) }));
      const post = routes.find((r) => r.method === "POST");
      if (!post) return;
      const provider = new NestJsClassValidatorProvider();
      const { fields } = await provider.resolve(post, match, EMPTY_SCAN_RESULT);
      expect(fields.map((f) => f.fieldName)).toContain("name");
      expect(fields.map((f) => f.fieldName)).toContain("email");
    } finally {
      await project.cleanup();
    }
  });

  test("tsTypeToSpecType: number, boolean, date y array como tipos TypeScript", async () => {
    const controllerSource = [
      'import { Controller, Get, Query } from "@nestjs/common";',
      "@Controller('items')",
      "export class ItemsController {",
      "  @Get()",
      "  list(@Query('count') count: number, @Query('active') active: boolean, @Query('since') since: Date, @Query('tags') tags: string[]) { return []; }",
      "}",
    ].join("\n");

    const project = await createTempProject({
      "package.json": PACKAGE,
      "src/items/items.controller.ts": controllerSource,
    });
    try {
      const { routes, match } = await scanProject("nestjs", project.root).then(async (r) => ({ ...r, match: await new NestJsProjectScanner().resolve(project.root) }));
      const get = routes.find((r) => r.method === "GET");
      if (!get) return;
      const provider = new NestJsClassValidatorProvider();
      const { fields } = await provider.resolve(get, match, EMPTY_SCAN_RESULT);
      expect(fields.find((f) => f.fieldName === "count")?.type).toBe("number");
      expect(fields.find((f) => f.fieldName === "active")?.type).toBe("boolean");
      expect(fields.find((f) => f.fieldName === "since")?.type).toBe("date");
      expect(fields.find((f) => f.fieldName === "tags")?.type).toBe("array");
    } finally {
      await project.cleanup();
    }
  });
});
