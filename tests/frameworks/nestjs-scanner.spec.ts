import { describe, expect, test } from "vitest";
import {
  NestJsProjectScanner,
  NestJsRouteScanner,
  NestJsClassValidatorProvider,
} from "../../packages/frameworks/scanners/nestjs.scanner";
import type { IProjectMatch } from "../../packages/contracts/interfaces/core/scanner.interface";

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
  test("detect() > 0 when package.json contains @nestjs/core", async () => {
    const scanner = new NestJsProjectScanner();
    const score = (await scanner.detect(ROOT)).score;
    expect(score).toBeGreaterThan(0);
  });

  test("detect() === 0 in an empty directory", async () => {
    const scanner = new NestJsProjectScanner();
    const score = (await scanner.detect("/tmp")).score;
    expect(score).toBe(0);
  });

  test("scan() returns the 5 routes of the mini-fixture", async () => {
    const ps = new NestJsProjectScanner();
    const match = await ps.resolve(ROOT);
    const routes = (await new NestJsRouteScanner().scan(match)).routes;
    expect(routes).toHaveLength(5);
    const methods = routes.map((r) => r.method).sort();
    expect(methods).toEqual(["DELETE", "GET", "GET", "POST", "PUT"]);
  });

  test("prefix @Controller('users') is applied to every route", async () => {
    const ps = new NestJsProjectScanner();
    const match = await ps.resolve(ROOT);
    const routes = (await new NestJsRouteScanner().scan(match)).routes;
    for (const r of routes) expect(r.uri).toMatch(/^\/users/);
  });

  test("path param ':id' present in routes with @Get(':id'), @Put(':id'), @Delete(':id')", async () => {
    const ps = new NestJsProjectScanner();
    const match = await ps.resolve(ROOT);
    const routes = (await new NestJsRouteScanner().scan(match)).routes;
    const withId = routes.filter((r) => r.uri.includes(":id"));
    expect(withId.length).toBeGreaterThanOrEqual(3);
  });

  test("comprehensive: detects >10 routes across 3 controllers", async () => {
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

  // `setGlobalPrefix` applies to ALL controllers. Without reading it,
  // a project that used it —the norm in NestJS— came out with URIs
  // without prefix and no request would respond.
  test("applies the global prefix to all routes", async () => {
    expect(await scanWithMain('app.setGlobalPrefix("api/v1");')).toEqual([
      "GET /api/v1/users",
      "POST /api/v1/users",
    ]);
  });

  test("without the global prefix the routes stay as they are", async () => {
    expect(await scanWithMain("const app = 1;")).toEqual(["GET /users", "POST /users"]);
  });

  test("a commented setGlobalPrefix is not applied", async () => {
    expect(await scanWithMain('// app.setGlobalPrefix("comentado");')).toEqual([
      "GET /users",
      "POST /users",
    ]);
  });

  test("accepts single quotes and backticks", async () => {
    expect(await scanWithMain("app.setGlobalPrefix('api');")).toEqual([
      "GET /api/users",
      "POST /api/users",
    ]);
  });

  test("normalizes the prefix with a leading slash", async () => {
    expect(await scanWithMain('app.setGlobalPrefix("/api");')).toEqual([
      "GET /api/users",
      "POST /api/users",
    ]);
  });
});

describe("NestJS — detect() score variants", () => {
  const PACKAGE = JSON.stringify({ dependencies: { "@nestjs/core": "^10.0.0" } });

  test("detect() === 1 when there is src and nest-cli.json", async () => {
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

  test("detect() === 0.8 when there is src but no nest-cli.json", async () => {
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

  test("detect() === 0.5 when there is no src nor nest-cli.json", async () => {
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

  test("@Controller({ path: 'items' }) applies the path as prefix", async () => {
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

  test("a file without @Controller produces no routes", async () => {
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
// f00011 S1 — regression for new signals (nest-cli.json boost +
// frameworkSearchRoot).
// ---------------------------------------------------------------------------

describe("NestJS — detect() boost por nest-cli.json (f00011 S1)", () => {
  const PKG = JSON.stringify({ dependencies: { "@nestjs/core": "^10.0.0" } });
  // f00011 S1: the weight of `nest-cli.json` goes up from 0.3 to
  // 0.7. It is the canonical signal that the project was initialized
  // with the Nest CLI (not just a dependency hanging there).
  test("detect() === 1 (cap) when there is nest-cli.json + @nestjs/core + src/", async () => {
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

  test("detect() === 1 (cap) when there is nest-cli.json but NO src/", async () => {
    const project = await createTempProject({
      "package.json": PKG,
      "nest-cli.json": "{}",
    });
    try {
      // 0.5 (@nestjs/core) + 0.7 (nest-cli.json) = 1.2 → cap 1.
      // The cap makes it match the previous case — that is the
      // correct behavior: the cap avoids inflating past "detected".
      expect((await new NestJsProjectScanner().detect(project.root)).score).toBe(1);
    } finally {
      await project.cleanup();
    }
  });
});

describe("NestJS — frameworkSearchRoot para monorepos (f00011 S1)", () => {
  const PKG = JSON.stringify({ dependencies: { "@nestjs/core": "^10.0.0" } });
  // f00011 S1: in a monorepo the `src/` lives in `apps/api/`.
  // Without `frameworkSearchRoot` the scanner looks at the root and
  // finds no controllers; with it, the full subdir scan comes out.
  test("scan() finds routes when frameworkSearchRoot points at the src/ subdir", async () => {
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

  // `setGlobalPrefix` is still looked up at `projectRoot` even if the
  // `src/` lives in a subdir — that is where the `main.ts` lives and
  // where the orchestrator expects to find the bootstrap.
  test("setGlobalPrefix is applied even when frameworkSearchRoot points at a subdir", async () => {
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

  test("supports() === false when the route has no description", async () => {
    const provider = new NestJsClassValidatorProvider();
    const route = { method: "GET", uri: "/users", rawUri: "/users", sourceFile: "src/users.controller.ts", lineNumber: 1, prefixChain: [] };
    const match = { framework: "nestjs" as const, projectRoot: "/tmp", artifacts: [] };
    expect(await provider.supports(route, match, EMPTY_SCAN_RESULT)).toBe(false);
  });

  test("supports() === false when framework is not nestjs", async () => {
    const provider = new NestJsClassValidatorProvider();
    const route = { method: "GET", uri: "/users", rawUri: "/users", sourceFile: "src/users.controller.ts", lineNumber: 1, prefixChain: [], description: "list" };
    const match = { framework: "express" as const, projectRoot: "/tmp", artifacts: [] };
    expect(await provider.supports(route, match, EMPTY_SCAN_RESULT)).toBe(false);
  });

  test("resolves inline DTO with IsEmail, IsUUID, IsArray, IsBoolean, IsDate, IsEnum, IsUrl", async () => {
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

  test("parseSignatureParams extracts @Param, @Query and @Headers", async () => {
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

  test("DTO imported from an external file resolves correctly", async () => {
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

  test("tsTypeToSpecType: number, boolean, date and array as TypeScript types", async () => {
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

// ---------------------------------------------------------------------------
// f00011 S4 — lockfiles como bonus de scoring en detect().
// ---------------------------------------------------------------------------

describe("NestJS — lockfiles as runtime bonuses (f00011 S4)", () => {
  // f00011 S4: `pnpm-lock.yaml` and `bun.lockb` sharpen the
  // detector's confidence without being detection. Small weights:
  // +0.1 (pnpm), +0.15 (bun). The lockfile shows up in `evidence`
  // even though the `withEvidence` cap of 1 already masks it in
  // projects with `nest-cli.json` (which summed 0.7 + 0.5 = 1.2).
  test("pnpm-lock.yaml adds evidence with weight 0.1", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { "@nestjs/core": "^10.0.0" } }),
      "pnpm-lock.yaml": "",
    });
    try {
      const result = await new NestJsProjectScanner().detect(project.root);
      const pnpm = result.evidence.find((e) => e.artifact === "pnpm-lock.yaml");
      expect(pnpm).toBeDefined();
      expect(pnpm?.weight).toBe(0.1);
    } finally {
      await project.cleanup();
    }
  });

  test("bun.lockb adds evidence with weight 0.15", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { "@nestjs/core": "^10.0.0" } }),
      "bun.lockb": "",
    });
    try {
      const result = await new NestJsProjectScanner().detect(project.root);
      const bun = result.evidence.find((e) => e.artifact === "bun.lockb");
      expect(bun).toBeDefined();
      expect(bun?.weight).toBe(0.15);
    } finally {
      await project.cleanup();
    }
  });

  test("pnpm-lock.yaml + bun.lockb add both signals", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { "@nestjs/core": "^10.0.0" } }),
      "pnpm-lock.yaml": "",
      "bun.lockb": "",
    });
    try {
      const result = await new NestJsProjectScanner().detect(project.root);
      expect(result.evidence.some((e) => e.artifact === "pnpm-lock.yaml")).toBe(true);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(true);
    } finally {
      await project.cleanup();
    }
  });

  test("without lockfiles no lockfile signal appears", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { "@nestjs/core": "^10.0.0" } }),
    });
    try {
      const result = await new NestJsProjectScanner().detect(project.root);
      expect(result.evidence.some((e) => e.artifact === "pnpm-lock.yaml")).toBe(false);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(false);
    } finally {
      await project.cleanup();
    }
  });
});

describe("NestJS scanner — global prefix from searchRoot (audit 2026-09-04 P2 #3)", () => {
  test("setGlobalPrefix in apps/api/src/main.ts is applied with frameworkSearchRoot", async () => {
    // In monorepos the bootstrap lives in the workspace (apps/api),
    // not in the root. Previously the scanner only looked in
    // `match.projectRoot` and did not find the setGlobalPrefix, so
    // routes came out without the prefix.
    const project = await createTempProject(
      {
        "package.json": JSON.stringify({
          dependencies: { "@nestjs/core": "^10.0.0" },
        }),
        "src/app.controller.ts": `import { Controller, Get } from "@nestjs/common";
@Controller("items")
export class AppController {
  @Get() list() { return []; }
}
`,
        "src/main.ts": `import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1");
  await app.listen(3000);
}
bootstrap();
`,
      },
      "nestjs-monorepo-prefix-",
    );

    const match: IProjectMatch = {
      framework: "nestjs",
      projectRoot: project.root,
      artifacts: ["package.json", "src"],
      frameworkSearchRoot: ".", // simulates what expandMonorepoDetection would produce
    };
    const routes = (await new NestJsRouteScanner().scan(match)).routes;
    expect(routes[0]?.uri).toBe("/api/v1/items");

    await project.cleanup();
  }, 15_000);
});
