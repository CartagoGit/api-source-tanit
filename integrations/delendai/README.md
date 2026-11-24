# Plugin delendai de tanit (uso interno)

**Este plugin NO es un paquete publicable.** No se publica en npm, no
tiene `dist/`, y no se consume desde fuera del repositorio. Es una pieza
interna de `tanit` (proyecto API Source Discovery): monta el CLI como
tools MCP para que los LLM que trabajan **dentro de este repo** tengan
herramientas de una pieza (generar, validar, inspeccionar colecciones)
sin tocar shell.

La declaración `"private": true` de su `package.json` es contractual, no
decorativa: cualquier intento de publicarlo es un error, no un descuido.

## Cómo se carga

El host de delendai importa el **TS directamente** (Bun lo compila al
importar; no hay paso de build):

```jsonc
// delendai.config.json de la raíz
{
  "plugins": {
    "tanit": {
      "path": "integrations/delendai/src/index.ts"
    }
  }
}
```

El host se declara una vez en `.mcp.json` (sincronizado a
`.vscode/mcp.json` y `.codex/config.toml` con `bun run mcp:sync`).

## Tools expuestos

| Tool | Función |
| --- | --- |
| `tanit_generate` | Genera la colección Postman v2.1.0 desde el proyecto. `projectRoot` opcional (fallback: `defaultProjectRoot` → workspace). |
| `tanit_validate` | Valida un JSON Postman v2.1.0 (schema + cobertura bidireccional). |
| `tanit_check` | Detecta desincronización entre el código y la colección generada. |
| `tanit_list` | Lista las rutas detectadas por framework. |
| `tanit_stats` | Métricas del proyecto (rutas, frameworks, cobertura). |
| `tanit_scan` | Muestra qué ve el discovery sin generar nada. |
| `delendai_tanit_client_usage` | Analiza llamadas HTTP del frontend y, con `backendRoot`, las compara con un catálogo de operaciones. Devuelve el mismo informe estructurado que `apisrc client-usage --format json`. Las carpetas deben estar dentro del workspace del servidor. |
| `delendai_tanit_client_candidates` | Recibe `projectRoot` y `role` (`frontend` o `backend`). Devuelve carpetas del workspace o IDs de servicios del catálogo compartido de Tanit. |
| `delendai_tanit_client_links` | Recibe `frontends` y `links` como el plan de `apisrc client-links`. Compara solo los enlaces declarados y devuelve el mismo informe de solo lectura que el CLI. Las rutas relativas se resuelven desde el workspace del servidor y todas las raíces deben estar dentro de él. |
| `tanit_summary` | El proyecto ya interpretado (framework, config, salud). |
| `tanit_test` | Ejecuta la batería de tests del CLI contra el proyecto. |
| `tanit_push` | Publica la colección (el único que sale de la máquina). |
| `tanit_init` | Inicializa la configuración de tanit. |

Cada tool sigue el contrato estándar de delendai:
- Input validado con Zod (estricto, `.strict()`).
- Output tipado via `toolJson()` (compact JSON envelope).
- Errores via `toolError()` (structured envelope con hint).

## Convenciones del proyecto

- **Clean code**: archivos `<concept>.tool.ts` para tools,
  `<concept>.service.ts` para lógica de dominio, `<concept>.helper.ts`
  para utilidades puras.
- **SOLID**: cada tool recibe sus dependencias vía `IMcpPluginContext`,
  nunca toca `process.cwd()` ni `process.env` directamente.
- **Agnóstico**. Tanit funciona por separado y este plugin es opcional.
  Las herramientas reutilizan servicios compartidos. Las que necesitan
  ejecutar un proceso usan el CLI como entrada.

## Runtime de desarrollo: DelendAI estable global

El nombre canónico del servidor es `DelendAI:Tanit`. Los clientes MCP
ejecutan el comando global `delendai`, el canal estable de la máquina
(`~/.local/share/delendai/stable`), igual en todos los proyectos y equipos.
No hay copias por proyecto ni rutas de máquina en la configuración.

Instalación en cada equipo (una vez, Bun y Git requeridos), con un clon
del repositorio DelendAI:

```bash
bun run --cwd <clon-de-DelendAI> install:stable   # último tag estable y el comando `delendai`
delendai --version
```

Después, en este checkout (o en cada worktree que use la integración):

```bash
bash scripts/integrations/delendai-runtime.sh --link --verify
```

`scripts/integrations/delendai-runtime.json` fija la versión que debe tener
la instalación (`0.3.0`). El verificador compara la versión real de
`packages/core/package.json`; si la instalación es un checkout Git, exige
además el commit fijado y un árbol sin cambios. `--link` enlaza solo la
dependencia ignorada `integrations/delendai/node_modules/@delendai/core`.
`DELENDAI_PATH` (o `DELENDAI_RUNTIME_DIR`) apunta a otra instalación;
el CI usa un checkout del commit fijado.

El producto Tanit no necesita esta instalación. La configuración MCP deriva
solo de `.mcp.json`; `bun run mcp:sync` actualiza VS Code y Codex.

### Mismo servidor en todos los clientes

`.mcp.json` declara `command: "delendai"` y los argumentos `__serve`,
`--workspace=.`, `--config=./delendai.config.json`.
El sincronizador sustituye las rutas por `${workspaceFolder}` en VS Code.
El TOML de Codex usa rutas relativas y deja que Codex tome el directorio
del hilo. En la extensión de VS Code sobre WSL, fijar `cwd = "."` puede
resolver esas rutas desde la carpeta de instalación del editor.
La configuración de proyecto desactiva el servidor genérico heredado
`DelendAI` en el checkout de Tanit.

OpenAI documenta la configuración de MCP por proyecto en
[Model Context Protocol](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
`bun run lint:mcp` comprueba que ambos formatos sigan el origen común.
Los procesos de cliente ya abiertos conservan su catálogo hasta recargar
su conexión MCP.
