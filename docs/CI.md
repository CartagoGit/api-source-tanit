# CI

## Branch protection

El gate [scripts/gates/branch-protection.script.ts](../scripts/gates/branch-protection.script.ts) comprueba la política real de GitHub para **las dos ramas que la política declara** — la de integración y la de release — y para cualquier rama `release/*` que exista en el repositorio. Los nombres no están escritos en el script: salen de `development.branches` en [delendai.config.json](../delendai.config.json), y si el bloque falta el gate **se niega a arrancar** en vez de proteger unos nombres inventados — un gate que se supone a su propia expectativa pasa lo que encuentra.

La validación exige dos cosas:

1. `protected=true`
2. `required_status_checks.contexts` contiene los checks que la política declara en `development.integration.requiredChecks` — hoy, uno: `ci-summary`

Además, cada rama se compara con **el número de aprobaciones que le toca por su papel**:

| Rama | Aprobaciones | De dónde sale |
| --- | --- | --- |
| Integración (`develop`) | `development.integration.requiredApprovals` | integra de forma autónoma |
| Release (`main`) | `development.integration.releaseRequiredApprovals` | es donde se corta una versión: la puerta se cierra hasta que alguien ha mirado |

Una rama de release protegida con **menos** aprobaciones de las que la política declara es una rama por la que una versión puede salir sin que nadie la haya mirado; el gate falla y dice las dos cifras —las que pide la rama y las que declara la política—. La comparación es por rama, no por repositorio: `develop` y `main` son el mismo repositorio con dos trabajos distintos, y no tienen la misma puerta. Las ramas `release/*` siguen el conteo de integración: no son la rama de corte, son otra puerta.

> Esto no es hipotético: `main` estuvo rojo porque exigía historia lineal mientras la política declara `mergeMethod: "merge"`. Un squash aplana la historia y deja fuera del árbol los commits que `lint:proposals` audita, así que `shippedIn` dejan de ser ancestros de `HEAD` y el gate falla con 166 referencias inalcanzables. El gate compara ahora, en cada rama, la historia lineal, el force-push y el borrado con lo que la política declara, y el método de merge con lo que declara **el repositorio** —que es donde vive ese interruptor—. Cuando divergen, el mensaje dice **qué** diverge y **qué hacer**: proteger la rama —o el repositorio, que es donde vive el método de merge— con la política, o cambiar la política.

El job `ci-summary` usa [scripts/gates/ci-summary.script.ts](../scripts/gates/ci-summary.script.ts)
y devuelve `exit 1` cuando cualquier job requerido termina en `failure`, `cancelled` o `skipped`.
También existe el workflow [ci-summary.yml](../.github/workflows/ci-summary.yml), que conserva un
check visible para la conclusión final del workflow `validate`.

### Cuándo se ejecuta

El job `branch-protection` del workflow [validate.yml](../.github/workflows/validate.yml) ya no está atado a `develop`: corre en cualquier push a una rama. Vigilar una sola rama dejaba las otras sin vigilancia: una rama de release mal protegida se enteraba el día de la promoción, cuando ya era tarde para corregirla sin historial roto.

El workflow se dispara en `main` y en `develop`, así que el gate llega a ejecutarse sobre la rama donde se corta una versión. Los dos hechos van juntos y los dos tienen su test: si la lista de ramas que el gate decide mirar dejara fuera la de release, el gate dejaría de mirarla; y si el `if` del job volviera a mirar sólo `develop`, el gate no llegaría a ejecutarse sobre `main`. En los dos casos la CI seguiría en verde mientras la rama de release queda sin vigilar.

## Ruleset

El workflow manual `integration-delendai` puede crear o actualizar el ruleset
`develop-required-checks` mediante `gh api`. Requiere el secreto `REPO_ADMIN_TOKEN` con permiso
de administración del repositorio. Sin ese secreto sólo emite un warning y no cambia GitHub.

Para promover la protección: ejecuta `integration-delendai` con `workflow_dispatch`, verifica
`bun run ci:branch-protection` y confirma que las ramas que declara la política exigen el check que la política nombra. En una emergencia
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

## Las releases

`develop` es donde se trabaja. `main` es donde **sale una versión**:
cada PR de `develop` a `main` corta una versión. Por eso el tag se
pone sobre `main`, y por eso los workflows de release sólo se
disparan desde ahí.

| Workflow | Cuándo | Qué hace |
|---|---|---|
| `release-cut` | Al empujar un tag `v*.*.*` | Crea la release de GitHub. Comprueba que el tag diga lo mismo que la versión del repo, saca las notas del CHANGELOG y marca la release como prerelease si el canal lo dice. |
| `release-binaries` | Al empujar el mismo tag | Compila el ejecutable autocontenido por plataforma y lo adjunta. |
| `release-desktop` | Al empujar el mismo tag | Compila los instaladores nativos por plataforma. Con `release.sign=false` —lo de hoy— los construye pero no publica nada. |

**Los tres escuchan el tag, no el evento `release`.** No es un
detalle: `release-cut` crea la release con `GITHUB_TOKEN`, y **los
eventos que dispara el propio `GITHUB_TOKEN` no crean ejecuciones
nuevas**. Con los workflows escuchando a `release: [published,
prereleased]`, la release se creaba bien —con sus notas y su marca de
prerelease— y **nadie adjuntaba los binarios**: la release salía
vacía, sin que ningún check fallara ni una línea del log lo dijera.
El tag sí lo empuja una persona, y eso GitHub lo dispara siempre.

`tests/release/release-workflows.spec.ts` vigila la regla.

**El canal lo decide el prefijo de la versión**, no el workflow.
`lint:release-channel` es la fuente: `release-cut` **pregunta** con
`--print-channel` en vez de decidir por su cuenta. Si el workflow
decidiera él, un día se desincronizaría del gate y una release
estable acabaría marcando un alfa.

**Las notas salen del CHANGELOG.** La sección de la versión **es** las
notas de la release; `scripts/release/release-notes.mjs` la extraa y
`release-cut` **para** si no la encuentra. Una release sin notas es
una release que dice "no hay nada".

**Los tres arrancan a la vez.** La release la crea `release-cut`, así
que los otros dos **esperan a que exista** antes de tocarla. Sin la
espera, adjuntar es un error de forma ("release not found") y no de
contenido.

**No hay publicación en npm.** La distribución es la release de GitHub:
el ejecutable autocontenido, que no necesita Bun ni Node en la máquina
destino. Publicar en npm es irreversible, y no había ninguna decisión
detrás de hacerlo.

## La auto-aprobación

`main` exige **una aprobación** y `enforce_admins` está activo: ni el
autor del PR ni un administrador pueden saltársela. Eso está bien
puesto —es la puerta que separa una release de un descuido—, pero en un
proyecto de una sola persona se convierte en un formality: hay que
pulsar un botón para aprobarse a uno mismo. Y GitHub **no** permite
aprobar el propio PR (`Can not approve your own pull request`): es regla
de la plataforma, no configuración.

El workflow [auto-approve.yml](../.github/workflows/auto-approve.yml) lo
resuelve con **otra identidad**: `github-actions[bot]`, que no es el
autor del PR. La aprobación **no** es ciega; sólo ocurre cuando:

1. el autor es el dueño del repositorio (`vars.OWNER`, por defecto
   `CartagoGit`), y
2. el check `ci-summary` —el que resume todos los jobs de validación—
   ha terminado en `success`.

Un PR de otra persona sigue necesitando una aprobación humana de
verdad. El workflow también activa el auto-merge con **merge commit**,
en las dos ramas.

> **Por qué merge y nunca squash.** La política declarada en
> `delendai.config.json` es `mergeMethod: "merge"`. No es un detalle
> de estilo: el gate `lint:proposals` exige que cada `shippedIn` de una
> propuesta cerrada sea **ancestro de HEAD** — es la auditoría de que
> la evidencia del cierre está en la historia. Un squash aplana la
> historia y esos commits dejan de ser ancestros: el gate falla con
> 166 `shippedIn` inalcanzables y la rama queda en rojo. Por eso la
> primera promoción —que se hizo con squash— dejó `main` en rojo, y
> el alfa se cortó desde una rama que ya no estaba verde.
>
> El auto-merge se activa por el **endpoint REST**
> (`PUT /repos/{owner}/{repo}/pulls/{pull_number}/auto-merge`) y no por
> `github.rest.pulls.enableAutoMerge`: ese método **no existe** en la
> versión de Octokit que trae `github-script@v7`, y la llamada moría
> con "enableAutoMerge is not a function". El PR quedaba aprobado y
> sin auto-merge, esperando a un humano que no hacía falta.

> El dueño se lee de `vars.OWNER` y no de `env`, porque el contexto
> `env` **no** existe en `jobs.<job_id>.if`: ahí sólo hay `github`,
> `needs`, `vars` e `inputs`. Con `env` la comparación nunca casaba y el
> workflow no hacía nada, en silencio.

`tests/cli/auto-approve.spec.ts` vigila las cuatro cosas que pueden
romperse sin que nadie se entere: que deje de mirar el autor, que deje
de esperar a la validación, que el merge deje de ser un squash, y que
el auto-merge se pida por el endpoint REST.

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