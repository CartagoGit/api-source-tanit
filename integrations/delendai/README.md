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

## Runtime de desarrollo fijado a 0.3.0

El nombre canónico del servidor es `DelendAI:Tanit`. Su lanzador verifica
el commit de `scripts/integrations/delendai-runtime.json` antes de ejecutar
el host y comprueba que el plugin resuelve **ese mismo** `@delendai/core`.
Un checkout `develop` con el mismo número de versión no satisface el pin.
El CLI antiguo puede mostrar `0.1.0` en `--version`; la verificación usa
el commit y la versión real de `packages/core/package.json`.

Instalación explícita (Bun y Git requeridos; no se descarga nada al arrancar):

```bash
runtime_dir="$HOME/.local/share/tanit/delendai/0.3.0-f8ab95e8"
git clone --branch v0.3.0 --single-branch https://github.com/CartagoGit/DelendAI.git "$runtime_dir"
git -C "$runtime_dir" checkout --detach f8ab95e8caf66128f8cd18cbf5b3035f74172ba4
bun install --frozen-lockfile --ignore-scripts --cwd "$runtime_dir"
bun run --cwd "$runtime_dir/packages/core" build
bash scripts/integrations/delendai-runtime.sh --link --verify
```

El build genera los artefactos y tipos del core fijado; no modifica su
código versionado. `--link` enlaza únicamente la dependencia ignorada de
esta integración. Si se usa otra ubicación, exportar `DELENDAI_RUNTIME_DIR`
para el proceso MCP y el CLI. Cada worktree que use la integración necesita
su propio `--link`. No se cambia el ejecutable global de otros proyectos.

Ejecutar operaciones de desarrollo desde la raíz del checkout:

```bash
DELENDAI_AGENT_ID=openai-gpt-6.1-sol bash scripts/integrations/delendai-runtime.sh work status
```

El producto Tanit no necesita esta instalación. La configuración MCP deriva
solo de `.mcp.json`; `bun run mcp:sync` actualiza VS Code. Las reglas de
validación del `develop` de DelendAI son una referencia para scripts de
Tanit; nunca son una instrucción para actualizar este runtime.
