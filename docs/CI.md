# CI

## Branch protection

El gate [scripts/gates/branch-protection.script.ts](../scripts/gates/branch-protection.script.ts) comprueba la política real de GitHub para `develop` y cualquier rama `release/*` que exista en el repositorio. La validación exige dos cosas:

1. `protected=true`
2. `required_status_checks.contexts` contiene exactamente los checks que hoy publica el workflow principal de validación:
   - `typecheck`
   - `lint`
   - `test-coverage`
   - `validate-examples`
   - `bench-check`
   - `security-audit`
   - `validate-package`
   - `integration-verifier`

Si falta la protección, si faltan checks o si la rama o la API responden `404`, el gate falla con un mensaje explícito.

## Ejecución real

Para consultar GitHub de verdad hacen falta estas variables de entorno:

- `GITHUB_TOKEN`
- `GITHUB_REPOSITORY` con formato `owner/repo`

Ejemplo:

```bash
GITHUB_TOKEN=... \
GITHUB_REPOSITORY=CartagoGit/api-source-tanit \
bun run scripts/gates/branch-protection.script.ts
```

Sin esas variables, el script falla de forma intencional y explica que el modo real necesita credenciales. Los tests no usan credenciales reales: llaman a `validateBranchProtection()` con `fetch` y `baseUrl` inyectables.