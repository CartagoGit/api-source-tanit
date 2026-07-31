# `@postman-exporter/mcp-vertex-testing-plugin`

Plugin MCP-vertex que expone el tool `postman_exporter_test` para
validar la salud del paquete `postman-exporter` desde cualquier
agente MCP-vertex compatible.

## Tool expuesto

### `postman_exporter_test { step? }`

Ejecuta los gates del paquete sin salir del workspace:

| Step | Comando | Qué valida |
| --- | --- | --- |
| `typecheck` | `bunx tsc --noEmit` | TypeScript sin errores |
| `build` | `bun run scripts/generate.script.ts` | Colección se genera |
| `check` | `bun run scripts/diff.script.ts && bun run scripts/validate-json.script.ts` | Cobertura + schema v2.1.0 |
| `all` | los 3 anteriores | resumen roll-up |

Output: `{ ok: boolean, steps: ReadonlyArray<{ name, ok, exitCode, durationMs, detail? }>, durationMs: number }`.

## Activación

```jsonc
// mcp-vertex.config.json
{
  "plugins": {
    "postman-exporter-testing": {
      "options": {
        "timeoutMs": 30000
      }
    }
  }
}
```

Si el plugin vive fuera del monorepo de `mcp-vertex`, declarar el
`path` apuntando a este directorio:

```jsonc
{
  "plugins": {
    "postman-exporter-testing": {
      "path": "./plugins/postman-exporter-testing/src/index.ts"
    }
  }
}
```

## Convenciones del plugin

- **Single source of truth**: las definiciones de los pasos viven en
  `src/lib/contract/test-steps.constant.ts` (constante + Zod schema).
- **Pure**: el tool no toca `process.cwd()` ni `process.env`; el
  workspace lo inyecta el dispatcher de mcp-vertex.
- **Testable**: cada step tiene un helper en `src/lib/helpers/steps/`
  que es una función pura `(cwd: string) => Promise<IStepResult>`.
- **Fail-fast**: si `step` es uno concreto, aborta en el primer fallo;
  si es `all`, sigue hasta el final y reporta el roll-up.
