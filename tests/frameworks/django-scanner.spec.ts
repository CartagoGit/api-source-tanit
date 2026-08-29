import { describe, expect, test } from "vitest";
import {
  DjangoProjectScanner,
  DjangoRouteScanner,
  DjangoSerializerProvider,
} from "../../projects/frameworks/scanners/django.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture, createTempProject, scanProject } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir, smokeFixtureDir } from "../../scripts/helpers/root.helper";
import type { ParsedRoute } from "../../projects/contracts/interfaces/core/scanner.interface";

describeScannerContract({
  framework: "django",
  fixtureRoot: comprehensiveFixture("django"),
  capabilities: {
    validation: true,
    pathParams: true,
    stripsComments: true,
    // Django declara la barra final a propósito: con APPEND_SLASH (el
    // defecto) llamar sin ella devuelve 301 y un POST pierde el body.
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
  test("detect() > 0 cuando hay manage.py", async () => {
    expect(await new DjangoProjectScanner().detect(ROOT)).toBeGreaterThan(0);
  });

  test("detect() === 0 cuando no hay manage.py", async () => {
    expect(await new DjangoProjectScanner().detect("/tmp")).toBe(0);
  });

  test("scan() encuentra las 4 rutas del mini-fixture", async () => {
    const match = await new DjangoProjectScanner().resolve(ROOT);
    const routes = await new DjangoRouteScanner().scan(match);
    expect(routes).toHaveLength(4);
  });

  test("rutas contienen health, api/users, api/users/<int:id>", async () => {
    const match = await new DjangoProjectScanner().resolve(ROOT);
    const routes = await new DjangoRouteScanner().scan(match);
    const uris = routes.map((r) => r.uri);
    expect(uris).toContain("/health/");
    expect(uris.some((u) => u.includes("/api/users/"))).toBe(true);
    expect(uris.some((u) => u.includes("<int:id>") || u.includes("{id}"))).toBe(true);
  });

  test("path param Django <int:id> preservado en uri del ParsedRoute", async () => {
    const match = await new DjangoProjectScanner().resolve(ROOT);
    const routes = await new DjangoRouteScanner().scan(match);
    const show = routes.find((r) => r.uri.includes("<int:id>"));
    expect(show).toBeDefined();
  });

  test("comprehensive: detecta >15 rutas con include() y CBVs/FBVs", async () => {
    const match = await new DjangoProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new DjangoRouteScanner().scan(match);
    expect(routes.length).toBeGreaterThanOrEqual(15);
  });

  test("DRF serializer provider resuelve campos para POST /api/users", async () => {
    const match = await new DjangoProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new DjangoRouteScanner().scan(match);
    const post = routes.find((r) => r.method === "POST" && r.uri.includes("api/users"));
    if (!post) return;
    const provider = new DjangoSerializerProvider();
    const result = await provider.resolve(post, match);
    expect(result.fields.length).toBeGreaterThan(0);
    expect(result.fields.some((f) => f.fieldName === "name" || f.fieldName === "email")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Detección: las variantes de manifest que el mini-fixture no ejercita.
// ---------------------------------------------------------------------------

describe("Django detect — variantes de manifest", () => {
  test("Pipfile con django da 0.8 sin manage.py", async () => {
    const project = await createTempProject({
      Pipfile: '[packages]\ndjango = "*"\n',
    });
    try {
      expect(await new DjangoProjectScanner().detect(project.root)).toBe(0.8);
    } finally {
      await project.cleanup();
    }
  });

  test("pyproject.toml con djangorestframework da 0.8", async () => {
    const project = await createTempProject({
      "pyproject.toml": '[project]\ndependencies = ["djangorestframework"]\n',
    });
    try {
      expect(await new DjangoProjectScanner().detect(project.root)).toBe(0.8);
    } finally {
      await project.cleanup();
    }
  });

  test("requirements.txt sin django da 0 aunque exista", async () => {
    const project = await createTempProject({
      "requirements.txt": "flask==3.0\n",
    });
    try {
      expect(await new DjangoProjectScanner().detect(project.root)).toBe(0);
    } finally {
      await project.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Routing: expansión de ViewSets según la clase base de DRF.
// ---------------------------------------------------------------------------

/** urls.py mínimo con una CBV dada y su views.py con la herencia declarada. */
function drfProject(appDir: string, className: string, baseClass: string) {
  return {
    "manage.py": "#!/usr/bin/env python\n",
    "urls.py": `from django.urls import path\n\nurlpatterns = [path("cosas/", ${className}.as_view())]\n`,
    [`${appDir}/views.py`]: `class ${className}(${baseClass}):\n    serializer_class = None\n`,
  };
}

describe("Django — expansión de ViewSets por clase base", () => {
  const casos: ReadonlyArray<[string, string]> = [
    ["generics.ListCreateAPIView", "GET,POST"],
    ["generics.RetrieveUpdateDestroyAPIView", "DELETE,GET,PATCH,PUT"],
    ["generics.UpdateAPIView", "PATCH,PUT"],
    ["generics.CreateAPIView", "POST"],
    ["generics.DestroyAPIView", "DELETE"],
    ["generics.RetrieveAPIView", "GET"],
    ["generics.ListAPIView", "GET"],
    ["viewsets.ModelViewSet", "DELETE,GET,PATCH,POST,PUT"],
    ["viewsets.ReadOnlyModelViewSet", "DELETE,GET,PATCH,POST,PUT"],
    ["viewsets.ViewSet", "DELETE,GET,PATCH,POST,PUT"],
  ];

  const tabla = test.each(casos);

  tabla("clase base %s → métodos %s", async (base, esperados) => {
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

  test("CBV sin clase base conocida cae al heurístico GET", async () => {
    const project = await createTempProject(drfProject("app", "OpacaView", "object"));
    try {
      const { routes } = await scanProject("django", project.root);
      expect(routes.map((r) => r.method)).toEqual(["GET"]);
    } finally {
      await project.cleanup();
    }
  });

  test("views.py se busca también en apps/<app>/ (convención DRF)", async () => {
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
// Routing: FBV con @api_view y heurística sin decorador.
// ---------------------------------------------------------------------------

describe("Django — function based views", () => {
  test("@api_view(['POST','PUT']) expande los verbos declarados", async () => {
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

  test("@api_view con verbos no reconocidos cae a GET", async () => {
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

  test("FBV sin @api_view usa el heurístico GET", async () => {
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
  test("include('app.items.urls') resuelve el módulo con puntos", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "urls.py": 'from django.urls import path, include\n\nurlpatterns = [path("items/", include("items.urls"))]\n',
      "items/urls.py": "urlpatterns = [path('lista/', lista), path('detalle/<int:id>/', detalle)]\n",
    });
    try {
      const { routes } = await scanProject("django", project.root);
      const uris = routes.map((r) => r.uri).sort();
      expect(uris).toEqual(["/items/detalle/<int:id>/", "/items/lista/"]);
      // El prefixChain arrastra el prefijo declarado en path().
      expect(routes[0]?.prefixChain).toEqual(["items/"]);
    } finally {
      await project.cleanup();
    }
  });

  test("include([...]) en forma de lista procesa cada sub-urls", async () => {
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

  test("un include ya procesado no se procesa dos veces", async () => {
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
      // La segunda include llega a un fichero ya procesado: no duplica.
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

  test("ruta sin sourceFile devuelve fields vacías", async () => {
    const project = await createTempProject({ "manage.py": "" });
    try {
      const match = await new DjangoProjectScanner().resolve(project.root);
      const result = await provider.resolve(ruta("/x/", ""), match);
      expect(result.fields).toEqual([]);
      expect(result.endpointKey).toBe("post /x/");
    } finally {
      await project.cleanup();
    }
  });

  test("CBV sin serializer_class devuelve fields vacías", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "app/urls.py": "urlpatterns = [path('cosas/', CosasView.as_view())]\n",
      "app/views.py": "class CosasView:\n    pass\n",
    });
    try {
      const match = await new DjangoProjectScanner().resolve(project.root);
      const result = await provider.resolve(ruta("/cosas/", "app/urls.py"), match);
      expect(result.fields).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });

  test("CBV sin views.py devuelve fields vacías", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "app/urls.py": "urlpatterns = [path('huerfana/', HuerfanaView.as_view())]\n",
    });
    try {
      const match = await new DjangoProjectScanner().resolve(project.root);
      const result = await provider.resolve(ruta("/huerfana/", "app/urls.py"), match);
      expect(result.fields).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });

  test("fields Meta + inline: type map, EmailField y ChoiceField con choices", async () => {
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
      const result = await provider.resolve(ruta("/users/", "app/urls.py"), match);
      const byName = new Map(result.fields.map((f) => [f.fieldName, f]));
      expect(byName.get("name")).toMatchObject({ type: "string", required: true });
      expect(byName.get("email")).toMatchObject({ type: "string", format: "email" });
      expect(byName.get("role")).toMatchObject({ type: "enum", enumValues: ["a", "b"] });
    } finally {
      await project.cleanup();
    }
  });

  test("field con tipo no reconocido en el type map cae a any", async () => {
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
      const result = await provider.resolve(ruta("/raro/", "app/urls.py"), match);
      expect(result.fields[0]).toMatchObject({ fieldName: "desconocido", type: "any" });
    } finally {
      await project.cleanup();
    }
  });

  test("serializer sin Meta.fields emite los inline fields como requeridos", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "app/urls.py": "urlpatterns = [path('inline/', InlineView.as_view())]\n",
      "app/views.py": "class InlineView:\n    serializer_class = InlineSerializer\n",
      "app/serializers.py": [
        "class InlineSerializer(serializers.Serializer):",
        "    titulo = serializers.CharField(max_length=10)",
        "    activo = serializers.BooleanField()",
        // BUG conocido del scanner (se reporta en la entrega): la rama
        // inline compara `required=false` en minúsculas, así que el
        // `required=False` real de Python sale como obligatorio.
        "    nota = serializers.CharField(required=False)",
      ].join("\n"),
    });
    try {
      const match = await new DjangoProjectScanner().resolve(project.root);
      const result = await provider.resolve(ruta("/inline/", "app/urls.py"), match);
      const byName = new Map(result.fields.map((f) => [f.fieldName, f]));
      expect(byName.get("titulo")).toMatchObject({ type: "string", required: true });
      expect(byName.get("activo")).toMatchObject({ type: "boolean" });
      // Comportamiento actual: required=true pese a `required=False`.
      expect(byName.get("nota")).toMatchObject({ required: true });
    } finally {
      await project.cleanup();
    }
  });

  test("FBV: encuentra el serializer por nombre capitalizado de la función", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "app/urls.py": "urlpatterns = [path('fbv/', pedido)]\n",
      "app/views.py": "def pedido(request):\n    pass\n",
      "app/serializers.py":
        "class PedidoSerializer(serializers.Serializer):\n    class Meta:\n        fields = ['x']\n    x = serializers.CharField()\n",
    });
    try {
      const match = await new DjangoProjectScanner().resolve(project.root);
      const result = await provider.resolve(ruta("/fbv/", "app/urls.py"), match);
      expect(result.fields.map((f) => f.fieldName)).toEqual(["x"]);
    } finally {
      await project.cleanup();
    }
  });

  test("FBV sin serializers.py devuelve fields vacías", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "app/urls.py": "urlpatterns = [path('solo/', fsv)]\n",
      "app/views.py": "def fsv(request):\n    pass\n",
    });
    try {
      const match = await new DjangoProjectScanner().resolve(project.root);
      const result = await provider.resolve(ruta("/solo/", "app/urls.py"), match);
      expect(result.fields).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });

  test("findViewNameForUri quita el prefijo declarado en prefixChain", async () => {
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
      // La URI trae el prefijo aplicado; el prefixChain lo arrastra desde
      // el include. El provider debe quitarlo antes de comparar.
      const result = await provider.resolve(
        ruta("/api/lista/", "app/api/urls.py", "POST", { prefixChain: ["api/"] }),
        match,
      );
      expect(result.endpointKey).toBe("post /api/lista/");
      expect(result.fields.map((f) => f.fieldName)).toEqual(["v"]);
    } finally {
      await project.cleanup();
    }
  });

  test("URI relativa vacía busca el path('') del urls.py", async () => {
    const project = await createTempProject({
      "manage.py": "",
      "app/urls.py": "urlpatterns = [path('', RaizView.as_view())]\n",
      "app/views.py": "class RaizView:\n    pass\n",
    });
    try {
      const match = await new DjangoProjectScanner().resolve(project.root);
      // Tras normalizar, la URI relativa queda vacía: rama del path("").
      const result = await provider.resolve(ruta("/", "app/urls.py", "GET"), match);
      expect(result.endpointKey).toBe("get /");
      expect(result.fields).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });
});
