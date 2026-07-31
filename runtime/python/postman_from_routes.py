#!/usr/bin/env python3
"""
postman-from-routes — alternativa Python puro (sin dependencias externas).

Para proyectos donde solo hay Python 3.9+:
  python3 runtime/python/postman_from_routes.py generate
  python3 runtime/python/postman_from_routes.py check
  python3 runtime/python/postman_from_routes.py open

Implementa el mismo contrato agnóstico:
  - Descubre rutas PHP.
  - Resuelve FormRequest por convención.
  - Genera `build/<proyecto>.postman_collection.json`.
  - Abre Postman (mac/win/linux/web).
"""

from __future__ import annotations
import json
import os
import re
import subprocess
import sys
from pathlib import Path

CWD = Path.cwd()
BUILD_DIR = CWD / "build"
BUILD_DIR.mkdir(exist_ok=True)

POSTMAN_SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"


def strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    src = re.sub(r"(^|[^:])\/\/.*$", r"\1", src, flags=re.MULTILINE)
    return src


def to_postman_uri(laravel: str) -> str:
    u = re.sub(r"^/?(api/)?", "", laravel)
    u = re.sub(r"\{([^}:]+)(?::[^}]+)?\}", r"{{\1}}", u)
    if not u.startswith("/"):
        u = "/" + u
    return re.sub(r"/+", "/", u)


def parse_routes(file_prefixes: dict[str, list[str]] | None = None) -> list[dict]:
    file_prefixes = file_prefixes or {}
    routes_dir = CWD / "routes"
    if not routes_dir.is_dir():
        print(f"✘ No se encuentra {routes_dir}", file=sys.stderr)
        sys.exit(1)
    out = []
    for f in sorted(routes_dir.glob("*.php")):
        rel = f"routes/{f.name}"
        prefixes = file_prefixes.get(rel, ["api"])
        text = strip_comments(f.read_text(encoding="utf-8"))

        imports: dict[str, str] = {}
        for m in re.finditer(
            r"use\s+([A-Za-z0-9_\\]+)\s*(?:as\s+([A-Za-z0-9_]+))?\s*;",
            text,
        ):
            fqcn = m.group(1)
            short = fqcn.split("\\")[-1]
            alias = m.group(2) or short
            imports[alias] = fqcn
            imports.setdefault(short, fqcn)

        stack = list(prefixes)
        lines = text.split("\n")
        for i, line in enumerate(lines):
            nxt = lines[i + 1] if i + 1 < len(lines) else ""
            pm = re.search(r"Route::prefix\(\s*['\"]([^'\"]+)['\"]", line)
            if pm:
                stack.append(pm.group(1))
            if re.search(r"\}\s*\)", line) and len(stack) > len(prefixes):
                stack.pop()
            rm = re.search(
                r"Route::(get|post|put|delete|patch)\s*\(\s*['\"]([^'\"]*)['\"]",
                line,
            )
            if rm:
                method = rm.group(1).upper()
                raw_uri = rm.group(2)
                segments = [*stack, raw_uri] if raw_uri else list(stack)
                full = re.sub(r"/+", "/", "/".join(segments))
                window = line + " " + nxt
                am = re.search(
                    r"\[\s*([A-Za-z0-9_]+)::class\s*,\s*['\"]([A-Za-z0-9_]+)['\"]\s*\]",
                    window,
                )
                entry = {"method": method, "uri": full}
                if am:
                    alias = am.group(1)
                    entry["actionName"] = am.group(2)
                    entry["controllerClass"] = imports.get(
                        alias, f"App\\Http\\Controllers\\{alias}"
                    )
                out.append(entry)
    return out


def top_group(uri: str) -> str:
    u = re.sub(r"^/?(api/)?", "", uri)
    return next(iter([s for s in u.split("/") if s]), "(raíz)")


def pretty(k: str) -> str:
    return " ".join(p.capitalize() for p in re.split(r"[-_]", k) if p)


PATH_HINTS = [
    (re.compile(r"(^|_)id($|_)", re.I), "1"),
    (re.compile(r"(^|_)codigo($|_)", re.I), "COD001"),
    (re.compile(r"(^|_)matricula($|_)", re.I), "1234ABC"),
    (re.compile(r"^email$", re.I), "usuario@ejemplo.com"),
    (re.compile(r"uuid", re.I), "00000000-0000-0000-0000-000000000001"),
]


def example_for_path_param(name: str) -> str:
    for re_, v in PATH_HINTS:
        if re_.search(name):
            return v
    return "1"


def infer_query(method: str, uri: str) -> list[dict]:
    if method.upper() != "GET":
        return []
    if re.search(r"\{\{[^}]+\}\}", uri):
        return [{"key": "include", "value": "all", "description": "Relaciones a incluir"}]
    last = (uri.rsplit("/", 1)[-1] if "/" in uri else uri).lower()
    if re.search(r"alive|auth-test|historial|blacklist|codigos|pdf|csv|excel", last):
        return [{"key": "q", "value": "ejemplo", "description": "Búsqueda libre"}]
    return [
        {"key": "pagina", "value": "1", "description": "Número de página"},
        {"key": "items_por_pagina", "value": "20", "description": "Tamaño de página"},
        {"key": "q", "value": "ejemplo", "description": "Búsqueda libre"},
    ]


def infer_body(method: str, uri: str) -> dict | None:
    m = method.upper()
    if m not in {"POST", "PUT", "PATCH"}:
        return None
    segs = [s for s in uri.split("/") if s]
    last = (segs[-1] if segs else "").lower()
    if re.search(
        r"cancel|reindex|reactivate|restore|approve|reject|refresh|sincronizar|importar|exportar|ejecutar|force|publish",
        last,
    ):
        return {"force": True}
    if last in {"despersonar", "logout", "desactivar"}:
        return {}
    return {"force": False}


def infer_variables(specs: list[dict]) -> list[dict]:
    out = {"baseUrl": "http://localhost/api", "token": ""}
    for s in specs:
        for m in re.finditer(r"\{\{([^}]+)\}\}", s["uri"]):
            k = m.group(1)
            if k not in out:
                out[k] = example_for_path_param(k)
    return [{"key": k, "value": v, "type": "string"} for k, v in out.items()]


def load_config() -> dict:
    env = os.environ.get("POSTMAN_CONFIG")
    if env and Path(env).is_file():
        return json.loads(Path(env).read_text(encoding="utf-8"))
    examples = CWD / "examples"
    if examples.is_dir():
        for d in sorted(examples.iterdir()):
            for f in ("config.constant.json", "config.json"):
                p = d / f
                if p.is_file():
                    return json.loads(p.read_text(encoding="utf-8"))
    p = CWD / "config.json"
    if p.is_file():
        return json.loads(p.read_text(encoding="utf-8"))
    name = CWD.name
    return {
        "name": name,
        "collectionName": f"{name} (Postman)",
        "collectionDescription": "Colección generada por postman-from-routes (Python).",
        "variables": [
            {"key": "baseUrl", "value": "http://localhost/api", "type": "string"},
            {"key": "token", "value": "", "type": "string"},
        ],
        "filePrefixes": {},
    }


def build_collection(specs: list[dict], cfg: dict) -> dict:
    groups: dict[str, list[dict]] = {}
    for s in specs:
        k = top_group(s["uri"])
        req = {
            "method": s["method"],
            "header": [
                {"key": "Accept", "value": "application/json", "type": "text"},
                {"key": "Authorization", "value": "Bearer {{token}}", "type": "text"},
            ]
            + (
                [{"key": "Content-Type", "value": "application/json", "type": "text"}]
                if s.get("body") is not None
                else []
            ),
            "url": {
                "raw": "{{baseUrl}}" + s["uri"],
                "host": ["{{baseUrl}}"],
                "path": [p for p in s["uri"].split("/") if p],
            },
        }
        if s.get("query"):
            req["url"]["query"] = [{**q, "disabled": False} for q in s["query"]]
        if s.get("body") is not None:
            req["body"] = {
                "mode": "raw",
                "raw": json.dumps(s["body"], indent=2, ensure_ascii=False),
                "options": {"raw": {"language": "json"}},
            }
        groups.setdefault(k, []).append({"name": s["name"], "request": req})
    items = [{"name": pretty(k), "item": ch} for k, ch in groups.items()]
    return {
        "info": {
            "name": cfg.get("collectionName") or cfg.get("name", "collection"),
            "description": cfg.get("collectionDescription", ""),
            "schema": POSTMAN_SCHEMA,
            "_postman_id": "00000000-0000-0000-0000-000000000001",
        },
        "auth": {
            "type": "bearer",
            "bearer": [{"key": "token", "value": "{{token}}", "type": "string"}],
        },
        "variable": cfg.get("variables") or infer_variables(specs),
        "item": items,
    }


def open_postman(path: Path) -> int:
    if not path.exists():
        print(f"✘ No se encuentra {path}", file=sys.stderr)
        return 1
    abs_path = path.resolve()
    print(f"→ Abriendo Postman con: {abs_path}")
    if sys.platform == "darwin":
        subprocess.run(["open", "-a", "Postman", str(abs_path)], check=False)
        return 0
    if sys.platform.startswith("win"):
        subprocess.run(["cmd", "/c", "start", "", str(abs_path)], check=False)
        return 0
    r = subprocess.run(["xdg-open", str(abs_path)], check=False)
    if r.returncode == 0:
        return 0
    r = subprocess.run(["gio", "open", str(abs_path)], check=False)
    if r.returncode == 0:
        return 0
    print("→ No hay app de escritorio; abre https://app.postman.com/import y arrastra:", abs_path)
    subprocess.run(["xdg-open", "https://app.postman.com/import"], check=False)
    return 0


def endpoint_name(method: str, action: str | None, uri: str) -> str:
    labels = {
        "index": "Listar", "show": "Ver", "store": "Crear", "create": "Crear",
        "update": "Actualizar", "destroy": "Eliminar", "delete": "Eliminar",
        "login": "Login", "logout": "Cerrar sesión", "alive": "Alive",
    }
    verb = labels.get(action or "", action or method)
    segs = [s for s in uri.split("/") if s and not s.startswith("{{")]
    resource = segs[-1] if segs else ""
    res_pretty = pretty(resource) if resource else ""
    return (f"{verb} {res_pretty}").strip() or verb


def cmd_generate() -> int:
    cfg = load_config()
    routes = parse_routes(cfg.get("filePrefixes") or {})
    specs = []
    for r in routes:
        if r["method"] not in {"GET", "POST", "PUT", "DELETE", "PATCH"}:
            continue
        pm = to_postman_uri(r["uri"])
        spec = {
            "method": r["method"],
            "uri": pm,
            "name": endpoint_name(r["method"], r.get("actionName"), pm),
            "query": infer_query(r["method"], pm),
        }
        body = infer_body(r["method"], pm)
        if body is not None:
            spec["body"] = body
        specs.append(spec)
    coll = build_collection(specs, cfg)
    base = os.environ.get("POSTMAN_OUTPUT_BASENAME") or f"{cfg.get('name', CWD.name)}.postman_collection"
    out = BUILD_DIR / f"{base}.json"
    out.write_text(json.dumps(coll, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"✔ Colección escrita en {out}")
    print(f"  · {len(specs)} specs")
    if "--open" in sys.argv:
        open_postman(out)
    return 0


def cmd_check() -> int:
    cfg = load_config()
    base = os.environ.get("POSTMAN_OUTPUT_BASENAME") or f"{cfg.get('name', CWD.name)}.postman_collection"
    path = BUILD_DIR / f"{base}.json"
    if not path.exists():
        print(f"✘ Falta {path} (ejecuta generate)", file=sys.stderr)
        return 1
    json.loads(path.read_text(encoding="utf-8"))
    print("✔ JSON válido")
    return 0


def cmd_list() -> int:
    for r in parse_routes():
        print(f"  {r['method']:<6} /{to_postman_uri(r['uri'])}")


def cmd_open() -> int:
    cfg = load_config()
    base = os.environ.get("POSTMAN_OUTPUT_BASENAME") or f"{cfg.get('name', CWD.name)}.postman_collection"
    return open_postman(BUILD_DIR / f"{base}.json")


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else None
    if cmd == "generate":
        return cmd_generate()
    if cmd == "check":
        return cmd_check()
    if cmd == "list":
        cmd_list()
        return 0
    if cmd == "open":
        return cmd_open()
    print("postman-from-routes (Python)")
    print("Uso: python3 postman_from_routes.py <generate|check|list|open> [--open]")
    return 0 if cmd is None else 1


if __name__ == "__main__":
    sys.exit(main())
