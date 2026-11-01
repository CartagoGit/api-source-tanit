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
   - `ci-summary`

El job `ci-summary` usa [scripts/gates/ci-summary.script.ts](../scripts/gates/ci-summary.script.ts)
y devuelve `exit 1` cuando cualquier job requerido termina en `failure`, `cancelled` o `skipped`.
También existe el workflow [ci-summary.yml](../.github/workflows/ci-summary.yml), que conserva un
check visible para la conclusión final del workflow `validate`.

## Ruleset

El workflow manual `integration-delendai` puede crear o actualizar el ruleset
`develop-required-checks` mediante `gh api`. Requiere el secreto `REPO_ADMIN_TOKEN` con permiso
de administración del repositorio. Sin ese secreto sólo emite un warning y no cambia GitHub.

Para promover la protección: ejecuta `integration-delendai` con `workflow_dispatch`, verifica
`bun run ci:branch-protection` y confirma que `develop` exige los nueve checks. En una emergencia
(rotación de secretos o incidente de infraestructura), un administrador puede usar el bypass
temporal del ruleset, documentar el motivo y retirarlo inmediatamente después del arreglo.

Si falta la protección, si faltan checks o si la rama o la API responden `404`, el gate falla con un mensaje explícito.

## Dependabot

[`.github/dependabot.yml`](../.github/dependabot.yml) es la configuración
de las dependencias que **se actualizan solas**. Tres decisiones que no
son obvias:

**Vigila las dos ramas.** Cada entrada declara
`target-branch: [main, develop]`. Sin eso, Dependabot abre sus PR
contra la rama por defecto —`main`— y `develop` se congela: un bump
que llega a `main` tarda una release entera en volver. Y no es una
cuestión de estilo: el grafo de dependencias que alimenta las
**alertas** se construye desde la rama por defecto, así que una
vulnerabilidad corregida en `develop` sigue parpadeando en la pestaña
de seguridad hasta que el arreglo llega a `main`.

**No vigila los ejemplos ni las fixtures, y hay un test que lo
impide.** Sus `package.json` son de muestra: 50+ proyectos que nadie
instala. El grafo de dependencias **no admite exclusiones** —los
escanea todos—, así que lo único que se puede hacer es que esos
manifiestos **declaren la versión que un proyecto real declararía
hoy**. `tests/cli/dependabot.spec.ts` lo sostiene con su tabla de
pisos: si un manifiesto de muestra vuelve a una versión con alertas
abiertas, el test **falla en el commit**, en vez de esperar a que
GitHub reconstruya el grafo días después y en otra rama. Un PR de
Dependabot sobre un ejemplo no llega nunca antes.

**Consecuencia:** arreglar una vulnerabilidad en `develop` **no** cierra
la alerta; la cierra el arreglo en `main`. Por eso promover `develop`
a `main` es también una operación de seguridad.

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