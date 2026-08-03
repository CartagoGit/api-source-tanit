# `@postman-exporter/mcp-vertex-plugin`

Plugin MCP-vertex que expone el proyecto `postman-exporter` como tools
descubribles por cualquier agente compatible (Copilot Chat, Claude Code,
Cursor, etc.).

## Tools expuestos (slice inicial)

| Tool | Función |
| --- | --- |
| `postman_exporter_generate` | Genera la colección Postman v2.1.0 desde un proyecto Laravel host. `projectRoot` opcional (fallback: `defaultProjectRoot` → workspace). |
| `postman_exporter_validate` | Valida un JSON Postman v2.1.0 (schema + cobertura bidireccional). `projectRoot` opcional. |
| `postman_exporter_summary` | Inspecciona el proyecto host sin generar nada. `projectRoot` opcional. |

Cada tool sigue el contrato estándar de mcp-vertex:
- Input validado con Zod (estricto, `.strict()`).
- Output tipado via `toolJson()` (compact JSON envelope).
- Errores via `toolError()` (structured envelope con hint).

## Activación

```jsonc
// .vscode/mcp.json del proyecto host
{
  "servers": {
    "mcp-vertex": {
      "type": "stdio",
      "command": "bun",
      "args": [
        "<ruta-al-binario-mcp-vertex>",
        "--workspace=${workspaceFolder}",
        "--config=${workspaceFolder}/mcp-vertex.config.json"
      ]
    }
  }
}
```

Y en `mcp-vertex.config.json`:

```jsonc
{
  "plugins": {
    "postman-exporter": {
      "options": {
        "defaultProjectRoot": "${workspaceFolder}/.."
      }
    }
  }
}
```

## Convenciones del proyecto

- **Clean code**: archivos `<concept>.tool.ts` para tools, `<concept>.service.ts`
  para lógica de dominio, `<concept>.helper.ts` para utilidades puras.
- **SOLID**: cada tool recibe sus dependencias vía `IMcpPluginContext`,
  nunca toca `process.cwd()` ni `process.env` directamente.
- **Agnóstico**: este plugin NO conoce el código del paquete `postman-exporter`
  en runtime. Solo define herramientas que invocan a los scripts en
  `${workspaceFolder}` del proyecto host.
