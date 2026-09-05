import { describe, expect, test } from "vitest";

import { parseRoutesFile } from "../../packages/frameworks/laravel/laravel.scanner";
import { LaravelFormRequestValidationProvider } from "../../packages/frameworks/laravel/laravel.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture } from "../helpers/scanner-fixture";
import { EMPTY_SCAN_RESULT } from "../helpers/empty-scan-result";

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
 * Helper: writes a routes/api.php into a tmpdir and parses it.
 * Returns the routes + a cleanup function.
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
  test("Route::resource expands to 7 RESTful routes (+ PATCH for update)", async () => {
    const { routes, cleanup } = await withRoutesFile(
      `<?php
use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\UserController;
Route::resource('users', UserController::class);
`,
    );
    try {
      // a00010 / B-03, B-04: 7 REST actions + 1 extra PATCH for
      // `update` (Laravel 5+ accepts both PUT and PATCH). The path
      // param is `{user}`, not `{id}`.
      expect(routes).toHaveLength(8);
      const methods = routes.map((r) => r.method);
      expect(methods).toContain("GET");
      expect(methods).toContain("POST");
      expect(methods).toContain("PUT");
      expect(methods).toContain("PATCH");
      expect(methods).toContain("DELETE");
      // 4 GETs: index, create, show, edit
      const getRoutes = routes.filter((r) => r.method === "GET");
      expect(getRoutes).toHaveLength(4);
    } finally {
      cleanup();
    }
  });

  test("Route::resource generates the canonical RESTful actions", async () => {
    const { routes, cleanup } = await withRoutesFile(
      `<?php
Route::resource('users', UserController::class);
`,
    );
    try {
      // `update` appears twice (PUT and PATCH); the actions are still
      // the 7 canonical ones.
      const actions = routes.map((r) => r.actionName).sort();
      expect(actions).toEqual([
        "create",
        "destroy",
        "edit",
        "index",
        "show",
        "store",
        "update",
        "update",
      ]);
    } finally {
      cleanup();
    }
  });

  test("Route::apiResource expands to 5 routes (+ PATCH for update)", async () => {
    const { routes, cleanup } = await withRoutesFile(
      `<?php
Route::apiResource('orders', OrderController::class);
`,
    );
    try {
      // 5 + 1 PATCH for update.
      expect(routes).toHaveLength(6);
      const actions = routes.map((r) => r.actionName).sort();
      expect(actions).toEqual([
        "destroy",
        "index",
        "show",
        "store",
        "update",
        "update",
      ]);
      // apiResource must NOT bring out /create or /edit
      const createOrEdit = routes.filter(
        (r) => r.uri.endsWith("/create") || r.uri.endsWith("/edit"),
      );
      expect(createOrEdit).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  test("->where('field', 'regex') is encoded into the URI", async () => {
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

  test("->where('user', '\\d+') applies to the (singular) {user} of Route::resource", async () => {
    const { routes, cleanup } = await withRoutesFile(
      `<?php
Route::resource('users', UserController::class)->where('user', '\\d+');
`,
    );
    try {
      // 7 + 1 PATCH = 8 routes.
      expect(routes).toHaveLength(8);
      // a00010 / B-03: the path param is `{user}`, not `{id}`. The
      // constraint is applied by name.
      const withUser = routes.filter((r) => r.uri.includes("{user"));
      expect(withUser.length).toBeGreaterThan(0);
      for (const r of withUser) {
        expect(r.uri).toContain("{user:\\d+}");
      }
    } finally {
      cleanup();
    }
  });

  test("Route::resource with use() aliases resolves the FQCN", async () => {
    const { routes, cleanup } = await withRoutesFile(
      `<?php
use App\\Http\\Controllers\\UserController as UC;
Route::resource('users', UC::class);
`,
    );
    try {
      expect(routes).toHaveLength(8);
      for (const r of routes) {
        expect(r.controllerClass).toBe("App\\Http\\Controllers\\UserController");
      }
    } finally {
      cleanup();
    }
  });

  test("singularizes irregular and -ies names", async () => {
    const { routes, cleanup } = await withRoutesFile(
      `<?php
Route::apiResource('categories', CategoryController::class);
Route::apiResource('statuses', StatusController::class);
Route::apiResource('people', PersonController::class);
`,
    );
    try {
      expect(routes.some((route) => route.uri === "/api/categories/{category}")).toBe(true);
      expect(routes.some((route) => route.uri === "/api/statuses/{status}")).toBe(true);
      expect(routes.some((route) => route.uri === "/api/people/{person}")).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("->parameters() overrides the resource's parameter name", async () => {
    const { routes, cleanup } = await withRoutesFile(
      `<?php
Route::apiResource('users', UserController::class)->parameters(['users' => 'user_id']);
`,
    );
    try {
      expect(routes.some((route) => route.uri === "/api/users/{user_id}")).toBe(true);
      expect(routes.some((route) => route.uri.includes("{user}"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("external prefix (api/v1) is applied to the expanded routes", async () => {
    const { routes, cleanup } = await withRoutesFile(
      `<?php
Route::resource('users', UserController::class);
`,
      ["api/v1"],
    );
    try {
      expect(routes).toHaveLength(8);
      for (const r of routes) {
        expect(r.uri.startsWith("/api/v1/")).toBe(true);
      }
    } finally {
      cleanup();
    }
  });

  test("mixing Route::resource + Route::get produces both", async () => {
    const { routes, cleanup } = await withRoutesFile(
      `<?php
Route::resource('users', UserController::class);
Route::get('/health', fn() => ['ok' => true]);
`,
    );
    try {
      // 7 (resource) + 1 (PATCH update) + 1 (health) = 9.
      expect(routes).toHaveLength(9);
      const health = routes.find((r) => r.uri === "/api/health");
      expect(health).toBeDefined();
    } finally {
      cleanup();
    }
  });

  test("FormRequest from store() extracts real fields and formats", async () => {
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
      }, EMPTY_SCAN_RESULT);

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
