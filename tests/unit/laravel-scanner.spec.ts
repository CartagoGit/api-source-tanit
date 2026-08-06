import { describe, expect, test } from "bun:test";

import { parseRoutesFile } from "../../service/scanners/laravel.scanner";
import { LaravelFormRequestValidationProvider } from "../../service/scanners/laravel.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture } from "../helpers/scanner-fixture";

describeScannerContract({
  framework: "laravel",
  fixtureRoot: comprehensiveFixture("laravel"),
  capabilities: {
    validation: true,
    pathParams: true,
    stripsComments: true,
  },
  minimalProject: {
    "artisan": '',
    "composer.json": '{"require":{"laravel/framework":"^11.0"}}',
    "routes/api.php": "<?php\nuse Illuminate\\\\Support\\\\Facades\\\\Route;\nRoute::get('/vivo', fn () => 1);\n",
  },
  commentedEndpoint: {
    file: 'routes/api.php',
    source: "// Route::get('/endpoint-comentado', fn () => 1);",
  },
});

/**
 * Helper: escribe un routes/api.php en un tmpdir y lo parsea.
 * Devuelve las rutas + un cleanup function.
 */
async function withRoutesFile(
  content: string,
  prefixes: string[] = ["api"],
): Promise<{
  routes: Awaited<ReturnType<typeof parseRoutesFile>>;
  cleanup: () => void;
}> {
  const { mkdtemp, writeFile, rm, mkdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "laravel-scan-"));
  await mkdir(join(dir, "routes"), { recursive: true });
  await writeFile(join(dir, "routes/api.php"), content, "utf8");
  const routes = await parseRoutesFile("routes/api.php", prefixes, dir);
  return {
    routes,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

describe("Laravel scanner — Route::resource + where()", () => {
  test("Route::resource expande a 7 rutas RESTful", async () => {
    const { routes, cleanup } = await withRoutesFile(
      `<?php
use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\UserController;
Route::resource('users', UserController::class);
`,
    );
    try {
      expect(routes).toHaveLength(7);
      const methods = routes.map((r) => r.method);
      expect(methods).toContain("GET");
      expect(methods).toContain("POST");
      expect(methods).toContain("PUT");
      expect(methods).toContain("DELETE");
      // 4 GET: index, create, show, edit
      const getRoutes = routes.filter((r) => r.method === "GET");
      expect(getRoutes).toHaveLength(4);
    } finally {
      cleanup();
    }
  });

  test("Route::resource genera las acciones RESTful canónicas", async () => {
    const { routes, cleanup } = await withRoutesFile(
      `<?php
Route::resource('users', UserController::class);
`,
    );
    try {
      const actions = routes.map((r) => r.actionName).sort();
      expect(actions).toEqual([
        "create",
        "destroy",
        "edit",
        "index",
        "show",
        "store",
        "update",
      ]);
    } finally {
      cleanup();
    }
  });

  test("Route::apiResource expande a 5 rutas (sin create/edit)", async () => {
    const { routes, cleanup } = await withRoutesFile(
      `<?php
Route::apiResource('orders', OrderController::class);
`,
    );
    try {
      expect(routes).toHaveLength(5);
      const actions = routes.map((r) => r.actionName).sort();
      expect(actions).toEqual([
        "destroy",
        "index",
        "show",
        "store",
        "update",
      ]);
      // apiResource NO debe sacar /create o /edit
      const createOrEdit = routes.filter(
        (r) => r.uri.endsWith("/create") || r.uri.endsWith("/edit"),
      );
      expect(createOrEdit).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  test("->where('field', 'regex') se codifica en la URI", async () => {
    const { routes, cleanup } = await withRoutesFile(
      `<?php
Route::get('/items/{id}', [ItemController::class, 'show'])->where('id', '\\d+');
`,
    );
    try {
      expect(routes).toHaveLength(1);
      expect(routes[0]?.uri).toBe("/api/items/{id:\\d+}");
    } finally {
      cleanup();
    }
  });

  test("->where('id', '\\d+') aplica al {id} de Route::resource", async () => {
    const { routes, cleanup } = await withRoutesFile(
      `<?php
Route::resource('users', UserController::class)->where('id', '\\d+');
`,
    );
    try {
      expect(routes).toHaveLength(7);
      // Las 4 rutas con {id} deben llevar la constraint
      const withId = routes.filter((r) => r.uri.includes("{id"));
      expect(withId.length).toBeGreaterThan(0);
      for (const r of withId) {
        expect(r.uri).toContain("{id:\\d+}");
      }
    } finally {
      cleanup();
    }
  });

  test("Route::resource con aliases use() resuelve la FQCN", async () => {
    const { routes, cleanup } = await withRoutesFile(
      `<?php
use App\\Http\\Controllers\\UserController as UC;
Route::resource('users', UC::class);
`,
    );
    try {
      expect(routes).toHaveLength(7);
      for (const r of routes) {
        expect(r.controllerClass).toBe("App\\Http\\Controllers\\UserController");
      }
    } finally {
      cleanup();
    }
  });

  test("prefijo externo (api/v1) se aplica a las expandidas", async () => {
    const { routes, cleanup } = await withRoutesFile(
      `<?php
Route::resource('users', UserController::class);
`,
      ["api/v1"],
    );
    try {
      expect(routes).toHaveLength(7);
      for (const r of routes) {
        expect(r.uri.startsWith("/api/v1/")).toBe(true);
      }
    } finally {
      cleanup();
    }
  });

  test("mezcla Route::resource + Route::get produce ambos", async () => {
    const { routes, cleanup } = await withRoutesFile(
      `<?php
Route::resource('users', UserController::class);
Route::get('/health', fn() => ['ok' => true]);
`,
    );
    try {
      // 7 (resource) + 1 (health)
      expect(routes).toHaveLength(8);
      const health = routes.find((r) => r.uri === "/api/health");
      expect(health).toBeDefined();
    } finally {
      cleanup();
    }
  });

  test("FormRequest de store() extrae campos reales y formatos", async () => {
    const { mkdtemp, rm, copyFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const fixtureRoot = `${process.cwd()}/tests/fixtures/laravel-comprehensive`;
    const dir = await mkdtemp(join(tmpdir(), "laravel-formrequest-"));
    await mkdir(join(dir, "app/Http/Controllers"), { recursive: true });
    await mkdir(join(dir, "app/Http/Requests"), { recursive: true });
    await mkdir(join(dir, "routes"), { recursive: true });
    await copyFile(
      join(fixtureRoot, "app/Http/Controllers/UserController.php"),
      join(dir, "app/Http/Controllers/UserController.php"),
    );
    await copyFile(
      join(fixtureRoot, "app/Http/Requests/CreateUserRequest.php"),
      join(dir, "app/Http/Requests/CreateUserRequest.php"),
    );
    await writeFileIfNeeded(join(dir, "artisan"));
    await writeFileIfNeeded(join(dir, "composer.json"), `{
  "require": { "laravel/framework": "^11.0" }
}`);
    await writeFileIfNeeded(join(dir, "routes/api.php"), `<?php
use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\UserController;
Route::resource('users', UserController::class);
`);

    try {
      const routes = await parseRoutesFile("routes/api.php", ["api"], dir);
      const post = routes.find((route) => route.method === "POST" && route.uri === "/api/users");
      expect(post).toBeDefined();
      if (!post) return;

      const provider = new LaravelFormRequestValidationProvider();
      const result = await provider.resolve(post, {
        framework: "laravel",
        projectRoot: dir,
        artifacts: [],
      });

      expect(result.fields.length).toBeGreaterThan(0);
      const names = result.fields.map((field) => field.fieldName);
      expect(names).toContain("name");
      expect(names).toContain("email");
      expect(names).toContain("age");
      expect(names).toContain("role");

      const emailField = result.fields.find((field) => field.fieldName === "email");
      expect(emailField?.format).toBe("email");
      const roleField = result.fields.find((field) => field.fieldName === "role");
      expect(roleField?.type).toBe("enum");
      expect(roleField?.enumValues).toEqual(["admin", "user", "guest"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function writeFileIfNeeded(path: string, content = ""): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, content, "utf8");
}
