import { describe, expect, test } from "vitest";
import {
  DjangoProjectScanner,
  DjangoRouteScanner,
  DjangoSerializerProvider,
} from "../../packages/frameworks/scanners/django.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture, createTempProject, scanProject } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir, smokeFixtureDir } from "../../scripts/helpers/root.helper";
import type { ParsedRoute } from "../../packages/contracts/interfaces/core/scanner.interface";

import { EMPTY_SCAN_RESULT } from "../helpers/empty-scan-result";
describeScannerContract({
  framework: "django",
  fixtureRoot: comprehensiveFixture("django"),
  capabilities: {
    validation: true,
    pathParams: true,
    stripsComments: true,
    // Django declares the trailing slash on purpose: with
    // APPEND_SLASH (the default) calling without it returns 301 and a
    // POST loses the body.
    trailingSlash: true,
  },
  minimalProject: {
    "manage.py": '#!/usr/bin/env python\n',
    "requirements.txt": 'django\n',
    "app/urls.py": "from django.urls import path\nfrom . import views\n\nurlpatterns = [\n    path('vivo/', views.vivo),\n]\n",
  },
  commentedEndpoint: {
    file: 'app/urls.py',
    source: "# path('endpoint-comentado/', views.x),",
  },
});

const ROOT = smokeFixtureDir("django");
const COMPREHENSIVE = comprehensiveFixtureDir("django");

describe("Django scanner", () => {
  test("detect() > 0 when manage.py exists", async () => {
    expect((await new DjangoProjectScanner().detect(ROOT)).score).toBeGreaterThan(0);
  });

  test("detect() === 0 when there is no manage.py", async () => {
    expect((await new DjangoProjectScanner().detect("/tmp")).score).toBe(0);
  });

  test("scan() finds the 4 routes of the mini-fixture", async () => {
    const match = await new DjangoProjectScanner().resolve(ROOT);
    const routes = (await new DjangoRouteScanner().scan(match)).routes;
    expect(routes).toHaveLength(4);
  });

  test("routes contain health, api/users, api/users/<int:id>", async () => {
    const match = await new DjangoProjectScanner().resolve(ROOT);
    const routes = (await new DjangoRouteScanner().scan(match)).routes;
    const uris = routes.map((r) => r.uri);
    expect(uris).toContain("/health/");
    expect(uris.some((u) => u.includes("/api/users/"))).toBe(true);
    expect(uris.some((u) => u.includes("<int:id>") || u.includes("{id}"))).toBe(true);
  });

  test("Django path param <int:id> preserved in ParsedRoute uri", async () => {
    const match = await new DjangoProjectScanner().resolve(ROOT);
    const routes = (await new DjangoRouteScanner().scan(match)).routes;
    const show = routes.find((r) => r.uri.includes("<int:id>"));
    expect(show).toBeDefined();
  });

  test("comprehensive: detects >15 routes with include() and CBVs/FBVs", async () => {
    const match = await new DjangoProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new DjangoRouteScanner().scan(match)).routes;
    expect(routes.length).toBeGreaterThanOrEqual(15);
  });

  test("DRF serializer provider resolves fields for POST /api/users", async () => {
    const match = await new DjangoProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new DjangoRouteScanner().scan(match)).routes;
    const post = routes.find((r) => r.method === "POST" && r.uri.includes("api/users"));
    if (!post) return;
    const provider = new DjangoSerializerProvider();
    const result = await provider.resolve(post, match, EMPTY_SCAN_RESULT);
    expect(result.fields.length).toBeGreaterThan(0);
    expect(result.fields.some((f) => f.fieldName === "name" || f.fieldName === "email")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Detection: manifest variants the mini-fixture does not exercise.
// ---------------------------------------------------------------------------

describe("Django detect — manifest variants", () => {
  test("Pipfile with django scores 0.8 without manage.py", async () => {
    const project = await createTempProject({
      Pipfile: '[packages]\ndjango = "*"\n',
    });
    try {
      expect((await new DjangoProjectScanner().detect(project.root)).score).toBe(0.8);
    } finally {
      await project.cleanup();
    }
  });

  test("pyproject.toml with djangorestframework scores 0.8", async () => {
    const project = await createTempProject({
      "pyproject.toml": '[project]\ndependencies = ["djangorestframework"]\n',
    });
    try {
      expect((await new DjangoProjectScanner().detect(project.root)).score).toBe(0.8);
    } finally {
      await project.cleanup();
    }
  });

  test("requirements.txt without django scores 0 even when present", async () => {
    const project = await createTempProject({
      "requirements.txt": "flask==3.0\n",
    });
    try {
      expect((await new DjangoProjectScanner().detect(project.root)).score).toBe(0);
    } finally {
      await project.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Routing: ViewSet expansion according to the DRF base class.
// ---------------------------------------------------------------------------

/** Minimal urls.py with a given CBV and its views.py with the declared inheritance. */
function drfProject(appDir: string, className: string, baseClass: string) {
  return {
    "manage.py": "#!/usr/bin/env python\n",
    "urls.py": `from django.urls import path\n\nurlpatterns = [path("cosas/", ${className}.as_view())]\n`,
    [`${appDir}/views.py`]: `class ${className}(${baseClass}):\n    serializer_class = None\n`,
  };
}

describe("Django — ViewSet expansion by base class", () => {
  const casos: ReadonlyArray<[string, string]> = [
    ["generics.ListCreateAPIView", "GET,POST"],
    ["generics.RetrieveUpdateDestroyAPIView", "DELETE,GET,PATCH,PUT"],
    ["generics.UpdateAPIView", "PATCH,PUT"],
    ["generics.CreateAPIView", "POST"],
    ["generics.DestroyAPIView", "DELETE"],
    ["generics.RetrieveAPIView", "GET"],
    ["generics.ListAPIView", "GET"],
    ["viewsets.ModelViewSet", "DELETE,GET,PATCH,POST,PUT"],
    ["viewsets.ReadOnlyModelViewSet", "GET"],
    ["viewsets.ViewSet", "DELETE,GET,PATCH,POST,PUT"],
  ];

  const tabla = test.each(casos);

  tabla("base class %s → methods %s", async (base, esperados) => {
    const project = await createTempProject(drfProject("app/items", "CosasView", base));
    try {
      const { match, routes } = await scanProject("django", project.root);
      expect(match.artifacts).toContain("manage.py");
      const metodos = routes
        .filter((r) => r.uri === "/cosas/")
        .map((r) => r.method)
        .sort()
        .join(",");
      expect(metodos).toBe(esperados);
    } finally {
      await project.cleanup();
    }
  });

  test("CBV under src/ resolves the base class", async () => {
    const project = await createTempProject(
      drfProject("src/items", "CosasView", "viewsets.ModelViewSet"),
    );
    try {
      const { routes } = await scanProject("django", project.root);
      expect(routes.map((route) => route.method).sort()).toEqual([
        "DELETE",
        "GET",
        "PATCH",
        "POST",
        "PUT",
      ]);
    } finally {
      await project.cleanup();
    }
  });

  test("CBV without a known base class falls back to the GET heuristic", async () => {
    const project = await createTempProject(drfProject("app", "OpacaView", "object"));
    try {
      const { routes } = await scanProject("django", project.root);
      expect(routes.map((r) => r.method)).toEqual(["GET"]);
    } finally {
      await project.cleanup();
    }
  });

  test("views.py is also looked up under apps/<app>/ (DRF convention)", async () => {
    const project = await createTempProject(drfProject("apps/pedidos", "PedidosView", "generics.CreateAPIView"));
    try {
      const { routes } = await scanProject("django", project.root);
      expect(routes.map((r) => r.method)).toEqual(["POST"]);
    } finally {
      await project.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Routing: FBV with @api_view and heuristic without decorator.
// ---------------------------------------------------------------------------

describe("Django — function based views", () => {
  test("@api_view(['POST','PUT']) expands the declared verbs", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "urls.py": "from django.urls import path\nfrom . import views\n\nurlpatterns = [path('accion/', views.accion)]\n",
      "views.py": "from rest_framework.decorators import api_view\n\n@api_view(['POST', 'PUT'])\ndef accion(request):\n    pass\n",
    });
    try {
      const { routes } = await scanProject("django", project.root);
      expect(routes.map((r) => r.method).sort()).toEqual(["POST", "PUT"]);
    } finally {
      await project.cleanup();
    }
  });

  test("@api_view with unrecognized verbs falls back to GET", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "urls.py": "urlpatterns = [path('raro/', views.raro)]\n",
      "views.py": "@api_view(['TRACE'])\ndef raro(request):\n    pass\n",
    });
    try {
      const { routes } = await scanProject("django", project.root);
      expect(routes.map((r) => r.method)).toEqual(["GET"]);
    } finally {
      await project.cleanup();
    }
  });

  test("FBV without @api_view uses the GET heuristic", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "urls.py": "urlpatterns = [path('plano/', views.plano)]\n",
      "views.py": "def plano(request):\n    pass\n",
    });
    try {
      const { routes } = await scanProject("django", project.root);
      expect(routes.map((r) => r.method)).toEqual(["GET"]);
    } finally {
      await project.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Routing: includes en forma string y en lista.
// ---------------------------------------------------------------------------

describe("Django — include()", () => {
  test("include('app.items.urls') resolves the dotted module", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "urls.py": 'from django.urls import path, include\n\nurlpatterns = [path("items/", include("items.urls"))]\n',
      "items/urls.py": "urlpatterns = [path('lista/', lista), path('detalle/<int:id>/', detalle)]\n",
    });
    try {
      const { routes } = await scanProject("django", project.root);
      const uris = routes.map((r) => r.uri).sort();
      expect(uris).toEqual(["/items/detalle/<int:id>/", "/items/lista/"]);
      // The prefixChain carries the prefix declared in path().
      expect(routes[0]?.prefixChain).toEqual(["items/"]);
    } finally {
      await project.cleanup();
    }
  });

  test("include([...]) as a list processes each sub-urls", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "urls.py": "urlpatterns = [include(['app/urls_a.py', 'app/urls_b.py'])]\n",
      "app/urls_a.py": "urlpatterns = [path('a/', va)]\n",
      "app/urls_b.py": "urlpatterns = [path('b/', vb)]\n",
    });
    try {
      const { routes } = await scanProject("django", project.root);
      expect(routes.map((r) => r.uri).sort()).toEqual(["/a/", "/b/"]);
    } finally {
      await project.cleanup();
    }
  });

  test("an already-processed include is not processed twice", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "urls.py": [
        "urlpatterns = [",
        "    path('x/', include('items.urls')),",
        "    path('y/', include('items.urls')),",
        "]",
      ].join("\n"),
      "items/urls.py": "urlpatterns = [path('uno/', uno)]\n",
    });
    try {
      const { routes } = await scanProject("django", project.root);
      // The second include hits an already processed file: no duplicate.
      expect(routes.map((r) => r.uri)).toEqual(["/x/uno/"]);
    } finally {
      await project.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// DjangoSerializerProvider: ramas fuera del happy path del comprehensive.
// ---------------------------------------------------------------------------

describe("DjangoSerializerProvider — ramas del proveedor", () => {
  const provider = new DjangoSerializerProvider();

  function ruta(
    uri: string,
    sourceFile: string,
    method = "POST",
    extra: Partial<ParsedRoute> = {},
  ): ParsedRoute {
    return {
      method,
      uri,
      rawUri: uri,
      sourceFile,
      lineNumber: 0,
      prefixChain: [],
      ...extra,
    };
  }

  test("route without sourceFile returns empty fields", async () => {
    const project = await createTempProject({ "manage.py": "" });
    try {
      const match = await new DjangoProjectScanner().resolve(project.root);
      const result = await provider.resolve(ruta("/x/", ""), match, EMPTY_SCAN_RESULT);
      expect(result.fields).toEqual([]);
      expect(result.endpointKey).toBe("post /x/");
    } finally {
      await project.cleanup();
    }
  });

  test("CBV without serializer_class returns empty fields", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "app/urls.py": "urlpatterns = [path('cosas/', CosasView.as_view())]\n",
      "app/views.py": "class CosasView:\n    pass\n",
    });
    try {
      const match = await new DjangoProjectScanner().resolve(project.root);
      const result = await provider.resolve(ruta("/cosas/", "app/urls.py"), match, EMPTY_SCAN_RESULT);
      expect(result.fields).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });

  test("CBV without views.py returns empty fields", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "app/urls.py": "urlpatterns = [path('huerfana/', HuerfanaView.as_view())]\n",
    });
    try {
      const match = await new DjangoProjectScanner().resolve(project.root);
      const result = await provider.resolve(ruta("/huerfana/", "app/urls.py"), match, EMPTY_SCAN_RESULT);
      expect(result.fields).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });

  test("Meta fields + inline: type map, EmailField and ChoiceField with choices", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "app/urls.py": "urlpatterns = [path('users/', UserCreateView.as_view())]\n",
      "app/views.py": "class UserCreateView:\n    serializer_class = UserCreateSerializer\n",
      "app/serializers.py": [
        "class UserCreateSerializer(serializers.Serializer):",
        "    class Meta:",
        "        fields = ['name', 'email', 'role']",
        "    name = serializers.CharField()",
        "    email = serializers.EmailField()",
        "    role = serializers.ChoiceField(choices=['a', 'b'])",
      ].join("\n"),
    });
    try {
      const match = await new DjangoProjectScanner().resolve(project.root);
      const result = await provider.resolve(ruta("/users/", "app/urls.py"), match, EMPTY_SCAN_RESULT);
      const byName = new Map(result.fields.map((f) => [f.fieldName, f]));
      expect(byName.get("name")).toMatchObject({ type: "string", required: true });
      expect(byName.get("email")).toMatchObject({ type: "string", format: "email" });
      expect(byName.get("role")).toMatchObject({ type: "enum", enumValues: ["a", "b"] });
    } finally {
      await project.cleanup();
    }
  });

  test("field with an unrecognized type in the type map falls back to any", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "app/urls.py": "urlpatterns = [path('raro/', RaroView.as_view())]\n",
      "app/views.py": "class RaroView:\n    serializer_class = RaroSerializer\n",
      "app/serializers.py": [
        "class RaroSerializer(serializers.Serializer):",
        "    class Meta:",
        "        fields = ['desconocido']",
        "    desconocido = serializers.CampoInventado()",
      ].join("\n"),
    });
    try {
      const match = await new DjangoProjectScanner().resolve(project.root);
      const result = await provider.resolve(ruta("/raro/", "app/urls.py"), match, EMPTY_SCAN_RESULT);
      expect(result.fields[0]).toMatchObject({ fieldName: "desconocido", type: "any" });
    } finally {
      await project.cleanup();
    }
  });

  test("serializer without Meta.fields emits inline fields as required", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "app/urls.py": "urlpatterns = [path('inline/', InlineView.as_view())]\n",
      "app/views.py": "class InlineView:\n    serializer_class = InlineSerializer\n",
      "app/serializers.py": [
        "class InlineSerializer(serializers.Serializer):",
        "    titulo = serializers.CharField(max_length=10)",
        "    activo = serializers.BooleanField()",
        // Known scanner bug (reported in the handoff): the inline
        // branch compares `required=false` in lowercase, so Python's
        // real `required=False` ends up as required.
        "    nota = serializers.CharField(required=False)",
      ].join("\n"),
    });
    try {
      const match = await new DjangoProjectScanner().resolve(project.root);
      const result = await provider.resolve(ruta("/inline/", "app/urls.py"), match, EMPTY_SCAN_RESULT);
      const byName = new Map(result.fields.map((f) => [f.fieldName, f]));
      expect(byName.get("titulo")).toMatchObject({ type: "string", required: true });
      expect(byName.get("activo")).toMatchObject({ type: "boolean" });
      // Current behavior: required=true despite `required=False`.
      expect(byName.get("nota")).toMatchObject({ required: true });
    } finally {
      await project.cleanup();
    }
  });

  test("FBV: finds the serializer by the capitalized name of the function", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "app/urls.py": "urlpatterns = [path('fbv/', pedido)]\n",
      "app/views.py": "def pedido(request):\n    pass\n",
      "app/serializers.py":
        "class PedidoSerializer(serializers.Serializer):\n    class Meta:\n        fields = ['x']\n    x = serializers.CharField()\n",
    });
    try {
      const match = await new DjangoProjectScanner().resolve(project.root);
      const result = await provider.resolve(ruta("/fbv/", "app/urls.py"), match, EMPTY_SCAN_RESULT);
      expect(result.fields.map((f) => f.fieldName)).toEqual(["x"]);
    } finally {
      await project.cleanup();
    }
  });

  test("FBV without serializers.py returns empty fields", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "app/urls.py": "urlpatterns = [path('solo/', fsv)]\n",
      "app/views.py": "def fsv(request):\n    pass\n",
    });
    try {
      const match = await new DjangoProjectScanner().resolve(project.root);
      const result = await provider.resolve(ruta("/solo/", "app/urls.py"), match, EMPTY_SCAN_RESULT);
      expect(result.fields).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });

  test("findViewNameForUri strips the prefix declared in prefixChain", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "urls.py":
        "from django.urls import path, include\n\nurlpatterns = [path('api/', include('app.api.urls'))]\n",
      "app/api/urls.py": "urlpatterns = [path('lista/', ListaView.as_view())]\n",
      "app/api/views.py": "class ListaView:\n    serializer_class = ListaSerializer\n",
      "app/api/serializers.py":
        "class ListaSerializer(serializers.Serializer):\n    class Meta:\n        fields = ['v']\n    v = serializers.CharField()\n",
    });
    try {
      const match = await new DjangoProjectScanner().resolve(project.root);
      // The URI comes with the prefix applied; the prefixChain
      // carries it from the include. The provider must strip it
      // before comparing.
      const result = await provider.resolve(
        ruta("/api/lista/", "app/api/urls.py", "POST", { prefixChain: ["api/"] }),
        match,
        EMPTY_SCAN_RESULT,
      );
      expect(result.endpointKey).toBe("post /api/lista/");
      expect(result.fields.map((f) => f.fieldName)).toEqual(["v"]);
    } finally {
      await project.cleanup();
    }
  });

  test("empty relative URI looks up path('') in urls.py", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "app/urls.py": "urlpatterns = [path('', RaizView.as_view())]\n",
      "app/views.py": "class RaizView:\n    pass\n",
    });
    try {
      const match = await new DjangoProjectScanner().resolve(project.root);
      // After normalization, the relative URI is empty: the
      // path("") branch.
      const result = await provider.resolve(ruta("/", "app/urls.py", "GET"), match, EMPTY_SCAN_RESULT);
      expect(result.endpointKey).toBe("get /");
      expect(result.fields).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });
});
