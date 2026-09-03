import { describe, expect, test } from "vitest";
import {
  FastApiProjectScanner,
  FastApiRouteScanner,
  FastApiPydanticValidationProvider,
} from "../../packages/frameworks/scanners/fastapi.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture, createTempProject } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir, smokeFixtureDir } from "../../scripts/helpers/root.helper";

describeScannerContract({
  framework: "fastapi",
  fixtureRoot: comprehensiveFixture("fastapi"),
  capabilities: {
    validation: true,
    pathParams: true,
    stripsComments: true,
  },
  minimalProject: {
    "requirements.txt": 'fastapi\n',
    "main.py": "from fastapi import FastAPI\napp = FastAPI()\n\n@app.get('/vivo')\ndef vivo():\n    return {}\n",
  },
  commentedEndpoint: {
    file: 'main.py',
    source: "# @app.get('/endpoint-comentado')",
  },
});

const ROOT = smokeFixtureDir("fastapi");
const COMPREHENSIVE = comprehensiveFixtureDir("fastapi");

describe("FastAPI scanner", () => {
  test("async def conserva el nombre del handler", async () => {
    const project = await createTempProject({
      "requirements.txt": "fastapi\n",
      "main.py": [
        "from fastapi import FastAPI",
        "app = FastAPI()",
        "@app.post('/users')",
        "async def create_user():",
        "    return {}",
      ].join("\n"),
    });
    try {
      const match = await new FastApiProjectScanner().resolve(project.root);
      const routes = await new FastApiRouteScanner().scan(match);
      expect(routes[0]?.displayName).toBe("create_user");
    } finally {
      await project.cleanup();
    }
  });

  test("detect() > 0 cuando requirements.txt tiene 'fastapi'", async () => {
    expect((await new FastApiProjectScanner().detect(ROOT)).score).toBeGreaterThan(0);
  });

  test("detect() === 0 cuando no hay requirements.txt ni pyproject.toml", async () => {
    expect((await new FastApiProjectScanner().detect("/tmp")).score).toBe(0);
  });

  test("scan() encuentra las 4 rutas del mini-fixture", async () => {
    const match = await new FastApiProjectScanner().resolve(ROOT);
    const routes = await new FastApiRouteScanner().scan(match);
    expect(routes).toHaveLength(4);
  });

  test("GET /health, GET /api/users, POST /api/users, GET /api/users/{user_id}", async () => {
    const match = await new FastApiProjectScanner().resolve(ROOT);
    const routes = await new FastApiRouteScanner().scan(match);
    const pairs = routes.map((r) => `${r.method} ${r.uri}`);
    expect(pairs).toContain("GET /health");
    expect(pairs).toContain("GET /api/users");
    expect(pairs).toContain("POST /api/users");
    const showRoute = routes.find((r) => r.method === "GET" && r.uri.includes("{user_id}"));
    expect(showRoute).toBeDefined();
  });

  test("path param {user_id} preservado tal como lo escribe el dev", async () => {
    const match = await new FastApiProjectScanner().resolve(ROOT);
    const routes = await new FastApiRouteScanner().scan(match);
    const show = routes.find((r) => r.uri.includes("{user_id}"));
    expect(show?.uri).toContain("{user_id}");
  });

  test("comprehensive: detecta >10 rutas con @router decorators y prefijos", async () => {
    const match = await new FastApiProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new FastApiRouteScanner().scan(match);
    expect(routes.length).toBeGreaterThanOrEqual(10);
  });

  test("Pydantic provider resuelve campos de BaseModel para POST", async () => {
    const match = await new FastApiProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new FastApiRouteScanner().scan(match);
    const post = routes.find((r) => r.method === "POST" && r.uri.includes("users"));
    if (!post) return;
    const provider = new FastApiPydanticValidationProvider();
    const result = await provider.resolve(post, match);
    expect(result.fields.length).toBeGreaterThan(0);
    const names = result.fields.map((f) => f.fieldName);
    expect(names).toContain("name");
    expect(names).toContain("email");
  });
});

describe("FastAPI — detect() con pyproject.toml y Pipfile", () => {
  test("detect() > 0 cuando pyproject.toml lista fastapi como dependencia", async () => {
    const project = await createTempProject({
      "pyproject.toml": '[project]\nname = "demo"\ndependencies = ["fastapi>=0.100"]\n',
    });
    try {
      expect((await new FastApiProjectScanner().detect(project.root)).score).toBeGreaterThan(0);
    } finally {
      await project.cleanup();
    }
  });

  test("detect() > 0 cuando Pipfile tiene fastapi", async () => {
    const project = await createTempProject({
      "Pipfile": '[packages]\nfastapi = "*"\n',
    });
    try {
      expect((await new FastApiProjectScanner().detect(project.root)).score).toBeGreaterThan(0);
    } finally {
      await project.cleanup();
    }
  });

  test("resolve() incluye pyproject.toml cuando existe", async () => {
    const project = await createTempProject({
      "pyproject.toml": '[project]\ndependencies = ["fastapi"]\n',
      "main.py": "from fastapi import FastAPI\napp = FastAPI()\n",
    });
    try {
      const match = await new FastApiProjectScanner().resolve(project.root);
      expect(match.artifacts).toContain("pyproject.toml");
    } finally {
      await project.cleanup();
    }
  });
});

describe("FastAPI — branches del router prefix y el scanner de rutas", () => {
  test("APIRouter con prefix definido en la misma línea aplica prefijo", async () => {
    const project = await createTempProject({
      "requirements.txt": "fastapi\n",
      "main.py": [
        "from fastapi import FastAPI",
        "from fastapi.routing import APIRouter",
        "app = FastAPI()",
        "router = APIRouter(prefix='/api/v1')",
        "@router.get('/users')",
        "def list_users(): return []",
        "@router.post('/users')",
        "def create_user(): return {}",
      ].join("\n"),
    });
    try {
      const match = await new FastApiProjectScanner().resolve(project.root);
      const routes = await new FastApiRouteScanner().scan(match);
      const uris = routes.map((r) => r.uri);
      expect(uris).toContain("/api/v1/users");
    } finally {
      await project.cleanup();
    }
  });

  test("decorador con ident que no está en routerPrefixes usa path sin prefijo", async () => {
    const project = await createTempProject({
      "requirements.txt": "fastapi\n",
      "main.py": [
        "from fastapi import FastAPI",
        "from fastapi.routing import APIRouter",
        "app = FastAPI()",
        "other_router = APIRouter()",
        "@other_router.get('/items')",
        "def list_items(): return []",
      ].join("\n"),
    });
    try {
      const match = await new FastApiProjectScanner().resolve(project.root);
      const routes = await new FastApiRouteScanner().scan(match);
      expect(routes.some((r) => r.uri === "/items")).toBe(true);
    } finally {
      await project.cleanup();
    }
  });

  test("decorador sin def en líneas siguientes no incluye displayName", async () => {
    const project = await createTempProject({
      "requirements.txt": "fastapi\n",
      "main.py": [
        "from fastapi import FastAPI",
        "app = FastAPI()",
        "@app.get('/status')",
        "status_handler = lambda: {'ok': True}",
      ].join("\n"),
    });
    try {
      const match = await new FastApiProjectScanner().resolve(project.root);
      const routes = await new FastApiRouteScanner().scan(match);
      const r = routes.find((r) => r.uri === "/status");
      expect(r).toBeDefined();
      expect(r?.displayName).toBeUndefined();
    } finally {
      await project.cleanup();
    }
  });
});

describe("FastAPI — Pydantic validation branches", () => {
  test("provider devuelve vacío cuando no hay BaseModel en el proyecto", async () => {
    const project = await createTempProject({
      "requirements.txt": "fastapi\n",
      "main.py": [
        "from fastapi import FastAPI",
        "app = FastAPI()",
        "@app.post('/items')",
        "def create(): return {}",
      ].join("\n"),
    });
    try {
      const match = await new FastApiProjectScanner().resolve(project.root);
      const routes = await new FastApiRouteScanner().scan(match);
      const post = routes.find((r) => r.method === "POST");
      if (!post) return;
      const provider = new FastApiPydanticValidationProvider();
      const result = await provider.resolve(post, match);
      expect(result.fields).toHaveLength(0);
    } finally {
      await project.cleanup();
    }
  });

  test("provider devuelve vacío para GET con path param (no body)", async () => {
    const project = await createTempProject({
      "requirements.txt": "fastapi\n",
      "main.py": [
        "from fastapi import FastAPI",
        "from pydantic import BaseModel",
        "app = FastAPI()",
        "class Item(BaseModel):",
        "    name: str",
        "@app.get('/items/{item_id}')",
        "def show(item_id: int): return {}",
      ].join("\n"),
    });
    try {
      const match = await new FastApiProjectScanner().resolve(project.root);
      const routes = await new FastApiRouteScanner().scan(match);
      const get = routes.find((r) => r.uri.includes("{item_id}"));
      if (!get) return;
      const provider = new FastApiPydanticValidationProvider();
      const result = await provider.resolve(get, match);
      expect(result.fields).toHaveLength(0);
    } finally {
      await project.cleanup();
    }
  });

  test("provider devuelve vacío para DELETE", async () => {
    const project = await createTempProject({
      "requirements.txt": "fastapi\n",
      "main.py": [
        "from fastapi import FastAPI",
        "from pydantic import BaseModel",
        "app = FastAPI()",
        "class Item(BaseModel):",
        "    name: str",
        "@app.delete('/items/{item_id}')",
        "def delete(item_id: int): return {}",
      ].join("\n"),
    });
    try {
      const match = await new FastApiProjectScanner().resolve(project.root);
      const routes = await new FastApiRouteScanner().scan(match);
      const del = routes.find((r) => r.method === "DELETE");
      if (!del) return;
      const provider = new FastApiPydanticValidationProvider();
      const result = await provider.resolve(del, match);
      expect(result.fields).toHaveLength(0);
    } finally {
      await project.cleanup();
    }
  });
});
