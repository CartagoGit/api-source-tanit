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
`.vscode/mcp.json` con `bun run mcp:sync`).

## Tools expuestos

| Tool | Función |
| --- | --- |
| `tanit_generate` | Genera la colección Postman v2.1.0 desde el proyecto. `projectRoot` opcional (fallback: `defaultProjectRoot` → workspace). |
| `tanit_validate` | Valida un JSON Postman v2.1.0 (schema + cobertura bidireccional). |
| `tanit_check` | Detecta desincronización entre el código y la colección generada. |
| `tanit_list` | Lista las rutas detectadas por framework. |
| `tanit_stats` | Métricas del proyecto (rutas, frameworks, cobertura). |
| `tanit_scan` | Muestra qué ve el discovery sin generar nada. |
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
- **Agnóstico**: este plugin NO importa el código del repo en runtime.
  Solo define herramientas que invocan al CLI
  (`packages/cli/cli.script.ts`) vía spawn.
