---
id: p00044
title: "p00044 — auditoría exhaustiva del proyecto (2026-08-08)"
kind: audit
status: review
type: proposal
track: export-to-postman
date: 2026-08-08
related:
    - p00007 # sigue bloqueada por npm; es la única no cerrada antes de esta ronda
---

> **Qué es esto.** Un barrido completo del repositorio: arquitectura,
> código, carpetas y nombres, tests, seguridad, dependencias,
> documentación, rendimiento y ampliaciones. Se hizo **midiendo**, no
> leyendo: cada afirmación de aquí abajo tiene detrás un comando que se
> ejecutó y una salida que se miró.
>
> Salieron **23 hallazgos**. Cuatro estaban rotos de verdad y ya están
> corregidos y publicados; los otros diecinueve se reparten en siete
> propuestas por sección, que se crean cuando esta se apruebe.

# p00044 — auditoría exhaustiva

## por qué se hizo así

La ronda anterior dejó una lección incómoda: **el mismo error apareció
tres veces** —`dedupeSpecs`, el chequeo de duplicados de los
invariantes y `check`— siempre por dar por hecho que el par
`método + URI` identifica una operación. Eso vale en REST y no vale en
GraphQL ni en tRPC, donde hay un endpoint y lo que distingue una
consulta de otra es el nombre.

Tres apariciones del mismo fallo no son tres despistes: son una pieza
que falta. Así que esta auditoría no buscó "sitios donde el código está
feo", buscó **suposiciones compartidas que nadie escribió**.

Y el método que funcionó fue el mismo que destapó aquello: ejecutar el
producto de verdad. Los dos hallazgos graves de esta ronda no se ven
leyendo el código —los dos ficheros parecen correctos— y aparecieron en
cuanto se lanzaron los comandos contra los 21 ejemplos y se miró qué
salía.

---

## 1. Estado medido al empezar

| Medida | Valor |
|---|---|
| Tests | 1877 en 92 ficheros |
| Ejemplos que generan colección válida | 21 / 21 |
| Lints | 13 |
| Secciones que tipan por separado | 5 |
| Frameworks soportados | 21 |
| Comandos del CLI | 12 |
| Líneas de producción | 23.874 |
| Líneas de test | 14.745 |
| Propuestas abiertas | 1 (`p00007`, bloqueada por npm) |
| Alertas de Dependabot | 67 |
| `bun audit` | 0 vulnerabilidades |

La discrepancia entre las dos últimas filas es el hilo del que salió la
sección 6.

---

## 2. Lo que ya está corregido y publicado

Cuatro cosas estaban rotas de forma que no se podía dejar pasar. Se
arreglaron durante la auditoría y están en `main`.

### 2.1 `enrich --in-place` vaciaba la colección — **grave, pérdida de datos**

`enrich` descubre endpoints por el **camino legacy de Laravel**
(`frameworks/laravel/endpoint-discovery`), no por el registro de
scanners. Se lanzó contra los 21 ejemplos:

```
enrich: 1 con contenido, 20 vacíos
```

En los otros veinte `discovered.specs` sale vacío — y **escribía
igual**. Con `--in-place` eso significa escribir la colección vacía
encima de la buena. Medido sobre `example-express`:

```
antes:   13 nombres, 27.514 bytes
después:  1 nombre,     502 bytes     exit=0
```

Imprimiendo `✔ Colección principal escrita`. Ni la persona ni un script
se enteraban.

Corregido en `a2ce484`: cero endpoints descubiertos no es un resultado,
es haber fallado al descubrirlos. Ahora no escribe, sale con 1 y dice
que para el resto de frameworks `generate` aplica el mismo
enriquecimiento. **Qué hacer con el comando** —retirarlo o hacerlo
agnóstico— es el hallazgo H-3, más abajo.

### 2.2 Un test que solo pasaba por suerte

`exit-codes.test.ts` copia un ejemplo y hace `chmod 0555` sobre la raíz
para comprobar que `generate` falla al no poder escribir. Pero `cp` se
traía también la carpeta `export-to-postman/` que deja una ejecución
anterior —está en `.gitignore`, no en el repo, pero **está en disco**— y
con ella ya creada y a 0755, `generate` escribía dentro y salía con 0.

El test solo pasaba en una máquina donde nadie hubiera lanzado el CLI
sobre los ejemplos. Saltó en esta misma sesión al hacerlo yo.

Corregido con `copyExampleClean()` en `tests/helpers/fixtures.ts`.

### 2.3 `readdir` tipaba `string[]` devolviendo `Dirent[]`

Las dos sobrecargas estaban al revés en `postman.d.ts`, y TypeScript se
queda con la primera que encaje: `{ withFileTypes: true }` encajaba con
`withFileTypes?: boolean`. **Los doce sitios** que la llaman lo
esquivaban con `as never` o `as unknown as`, que apaga la comprobación
justo sobre `entry.name` y `entry.isDirectory()` — el tipo de código
para el que se activó `noUncheckedIndexedAccess`.

Corregido en `ecb9505`: sobrecarga específica primero, doce castings
retirados.

### 2.4 `dependabot.yml` no tocaba las alertas

Ver sección 6.

---

## 3. Arquitectura

### H-1 · `ParsedRoute` no tiene identidad — **causa raíz, alta**

Es la pieza que falta detrás de cuatro bugs distintos.

`ParsedRoute` describe una ruta con `method`, `uri`, `sourceFile`,
`prefixChain`… y **nada que diga qué operación es** ni **de qué scanner
viene**. De ahí salen:

| Bug | Cómo se manifestó |
|---|---|
| `dedupeSpecs` | un esquema GraphQL entero producía **una** request |
| Invariantes | avisaba de las otras cuatro como "duplicadas" |
| `check` | contaba 1 ruta de 5, y no podía detectar deriva ninguna |
| `__params` (H-2) | el scanner de OpenAPI no puede decir "esta ruta es mía" |

Los tres primeros están parcheados uno a uno. **Nada impide el cuarto.**

Lo que falta es una noción explícita de identidad de endpoint —una
clave que incluya el nombre de la operación cuando el protocolo lo
necesite— y un campo `framework` en `ParsedRoute`, usados por todos los
sitios que hoy improvisan su propia clave.

### H-2 · Propiedad colada por `as any` — media

`openapi.scanner.ts` escribe una propiedad que no está en el contrato:

```ts
(out[out.length - 1] as any).__params = params;          // línea 454
return Boolean((_r as any).__params) || _m.framework === "openapi";  // línea 535
```

`__params` **se escribe y nunca se lee para nada más**: `resolve()`
vuelve a leer el spec del disco. Solo sirve para que `supports()` diga
que sí en un proyecto híbrido, que es justo lo que resolvería el campo
`framework` de H-1.

### H-3 · `enrich` es un comando de Laravel disfrazado de general — media

Más allá del vaciado ya corregido: el comando **duplica a `generate`**
(reconstruye la colección, aplica el flujo de auth, enriquece con las
mismas reglas) por un camino que solo entiende un framework de 21. Es un
resto de cuando esto era una herramienta solo para Laravel.

Hay que decidir: retirarlo, o rehacerlo sobre el orquestador. La
propuesta de la sección lo plantea con las dos opciones y una
recomendación.

### H-4 · `lint:boundaries` no ve este caso — media

La regla es de **sección**: `cli` declara `dependsOn: ["core",
"frameworks"]`, así que un comando genérico importando
`frameworks/laravel/` es legal. Es exactamente por donde se coló H-3.

Falta la regla fina: un comando que no sea específico de un framework no
puede importar de `frameworks/<uno concreto>/`; tiene que pasar por el
registro. (`diff` lo hace bien: usa el orquestador y Laravel solo como
último recurso.)

### H-5 · Un servicio genérico viviendo en la carpeta de Laravel — baja

`frameworks/laravel/catalog-enricher.service.ts` lo usa `generate` para
**todos** los frameworks. No es de Laravel; está aparcado ahí.

### H-6 · Dos carpetas vacías — baja

`projects/core/export-to-postman/` y
`tests/fixtures/fiber-comprehensive/internal`. La primera tiene además
el nombre del producto, lo que invita a pensar que ahí vive algo.

---

## 4. Código

### H-7 · La detección por manifiesto está reimplementada 21 veces — media

`readPackageJson` está **duplicado literalmente** en `hono.scanner.ts` y
`fastify.scanner.ts` (mismas diez líneas), y otros cinco scanners leen
`package.json` por su cuenta con reglas propias. Lo mismo con
`requirements.txt`/`pyproject.toml`/`Pipfile` en los tres de Python y
con `go.mod` en los dos de Go.

No es solo repetición: **no se comportan igual**. Unos miran
`devDependencies` y otros no, unos capturan el error de parseo y otros
lo dejan subir. Un framework declarado en `devDependencies` se detecta o
no según cuál sea.

### H-8 · Cuatro `readFlag` con **tipos de retorno distintos** — media

| Fichero | Devuelve |
|---|---|
| `core/discovery/project-loader.service.ts` | `string \| null` |
| `core/discovery/project-context.service.ts` | `string \| undefined` |
| `cli/commands/push.script.ts` | `string \| null` |
| `cli/commands/init.script.ts` (`flag`) | `string \| null` |

Cuatro copias de "leer un flag de `argv`", y las dos del núcleo
discrepan en cómo dicen "no está". Eso es una fuente de `?? ""` mal
puestos esperando a ocurrir.

### H-9 · `generate.script.ts`: un `main()` de 325 líneas — media

El comando principal del producto es una función de 325 líneas que
descubre, construye, aplica auth, enriquece, exporta a seis formatos,
escribe entornos e imprime el informe. Cada trozo es razonable; el
conjunto no se puede probar por partes, y es el fichero al que hay que
tocar para cualquier cambio de comportamiento.

### H-10 · Un parser de YAML escrito a mano, de 267 líneas — media

`parseYamlLite` en `openapi.scanner.ts`. Lee specs OpenAPI **de otra
gente**, que es entrada no controlada. Merece o un banco de pruebas
adversarial propio, o pasar a algo probado.

### H-11 · Nombres de Laravel dentro del núcleo agnóstico — baja

`toPostmanUri(laravelUri: string)` en
`core/adapters/parsed-route-to-spec.adapter.ts`. Cosmético, pero es
justo el tipo de resto que hace dudar de si el núcleo es agnóstico de
verdad.

---

## 5. Tests

Lo primero, lo bueno, porque también es un resultado medido: **no hay un
solo test vacuo** (ninguno con menos `expect` que casos), **ni un
`.skip`, ni un `.only`**. Los exportadores, que temía flojos, tienen 42
tests cubriendo los seis formatos.

### H-12 · Seis comandos sin ningún test que los ejecute — media

`scan`, `open`, `init`, `push`, `watch` y `summary` no aparecen en
ningún test que los lance. Algunos tienen probada su pieza pura
(`watcher.service.spec.ts`, `postman-api.service.spec.ts`), pero **el
comando** —parseo de flags, códigos de salida, mensajes— no.

Que esto importa lo demuestra esta misma auditoría: el vaciado de
`enrich` estaba en un comando sin test, y apareció al primer intento de
ejecutarlo.

### H-13 · Nada impide que vuelva la no-hermeticidad — baja

El fallo de 2.2 —un test que depende de lo que hubiera en disco— no lo
caza nada. Un lint que prohíba `cp(exampleDir(...))` sin pasar por
`copyExampleClean` lo cerraría.

---

## 6. Seguridad y dependencias

### H-14 · Las 67 alertas: causa entendida, corregida, pendiente de confirmar cierre

La ronda anterior declaró en `.github/dependabot.yml` solo los dos
paquetes reales dando por hecho que las alertas se cerrarían. **No se
movió ni una.** Dependabot tiene dos mitades:

- **Actualizaciones** — salen del `.yml`, directorio a directorio.
- **Alertas** — salen del *grafo de dependencias*, que escanea **todos**
  los manifiestos y **no admite exclusiones por ruta**.

Las 67 salían de los **50 manifiestos que este repo contiene y no son
suyos**: cada ejemplo y cada fixture trae el suyo porque de ahí deducen
los scanners el framework. Las trece rutas señaladas estaban todas bajo
`examples/` o `tests/`, ni una bajo un paquete real, con `bun audit` en
cero.

Como el grafo no se filtra, la palanca que queda es lo que esos
manifiestos declaran. Subidas las 21 declaraciones que alertaban, cada
una a su `first_patched_version`. El grafo ya lo refleja para npm y
composer:

```
@apollo/server  ^5.5.0     fastify  ^5.8.3     next  ^15.5.21
@nestjs/core    ^11.1.18   laravel/framework  >= 12.61.1
```

Go todavía no ha reindexado y el cierre de alertas va por detrás del
grafo. **Queda confirmar que bajan a 0**; si alguna se resiste, el
siguiente paso es descartarla como `not_used`, que es literalmente lo
que es.

`tests/cli/dependabot.spec.ts` lleva ahora el suelo de versión de cada
paquete que llegó a alertar y falla si alguno vuelve a bajar; se
comprobó devolviendo `next` a `^14` y viendo el gate romper.

Las 7 ramas de Dependabot abiertas están fusionadas y borradas.

### H-15 · Superficie de ejecución: limpia

Se auditó a propósito y no hay hallazgo. Ningún `spawn` usa
`shell: true`; `open-postman.script.ts` pasa argumentos como array
también en Windows (`cmd /c start "" <ruta>`), así que una ruta con
espacios o metacaracteres no se interpreta. La API key se lee de
`--api-key` o del entorno y no se escribe en ningún fichero.

---

## 7. Organización, nombres y experiencia de uso

### H-16 · El CLI habla dos idiomas — media

| Comando | Idioma |
|---|---|
| `generate` | inglés… y español en los errores |
| `push` | inglés |
| `diff`, `enrich`, `init`, `stats`, `validate`, `watch` | español |

`generate` mezcla los dos **en la misma ejecución**: dice
`→ Enriching with validation-rule variants…` y, si falla,
`✗ No se ha encontrado ningún endpoint`.

Los comentarios y las propuestas en español son una decisión del
proyecto y están bien. Lo que ve quien usa la herramienta es otra cosa y
tiene que ser una sola.

### H-17 · El plugin llega a 4 de los 12 comandos — media

Expone `generate`, `validate`, `summary` y `test`. Un agente no puede
listar endpoints, ver estadísticas, comprobar deriva (`check`) ni subir
a Postman. `check` es el más llamativo: es la herramienta que responde
"¿se ha desincronizado la colección?", que es exactamente lo que un
agente querría preguntar.

### H-18 · El binario pesa 95 MB — baja

Es el runtime de Bun embebido. Cuatro plataformas × 95 MB en cada
release. Merece medir si `--minify` o excluir los ejemplos lo baja.

### H-19 · No se compila para Mac Intel — baja

`TARGETS` cubre `linux-x64`, `linux-arm64`, `darwin-arm64` y
`windows-x64`. Falta `darwin-x64`.

---

## 8. Documentación

Sin hallazgos que arreglar. `lint:docs` ya comprueba enlaces relativos,
anclas, cifras afirmadas, secciones por framework y que cada comando
esté documentado, y `lint:api` mantiene `docs/API.md` al día con el área
pública. Los 13 lints pasan.

La única observación: `docs/mcp-vertex/AUDIT-2026-08-06.md` es una
auditoría anterior que vive **fuera** del sistema de propuestas,
mientras esta vive dentro. Conviene una sola forma. Se propone mover
aquella a `done/audits/` conservando su texto —es registro histórico y
no se reescribe— para que las auditorías se encuentren todas en el
mismo sitio.

---

## 9. Ampliaciones — una UI completa de escritorio

Encargo explícito: poder usar el proyecto desde un `.deb` u otro
formato de Linux, un archivo de Mac y un `.exe` de Windows que abra una
interfaz.

**El punto de partida es mejor de lo que parece.** Ya existe
`projects/ui/` con el asistente interactivo, la tabla y el *dashboard*
de calidad: la lógica de "qué preguntar y qué enseñar" está escrita y
probada. Y el pipeline entero es una función (`generateWithAllFrameworks`),
no un script, así que una UI no tiene que reimplementar nada.

### Las tres opciones

| | A · `expostman ui` (web local) | B · Tauri | C · Electron |
|---|---|---|---|
| Instaladores nativos | no | **sí** (.deb, .dmg, .msi) | sí |
| Peso añadido | ~0 | ~8 MB | ~150 MB |
| Toolchain nuevo | ninguno | Rust + CI en 3 SO | Node |
| Se ve como "una app" | pestaña del navegador | **sí** | sí |
| Trabajo hasta algo usable | bajo | medio | medio |

### Recomendación: A primero, B después

`Bun.serve` ya está en el runtime que el binario lleva dentro, así que
la opción A **no añade ninguna dependencia**: un comando `expostman ui`
que levante `localhost` y abra el navegador. Y lo importante es que **no
es trabajo tirado**: en Tauri la ventana nativa carga exactamente la
misma interfaz. A es el 90% del trabajo de B, y se puede usar el día que
esté.

Se descarta Electron: 150 MB por plataforma para envolver una interfaz
que en Tauri ocupa 8, en un proyecto cuyo binario ya pesa 95.

Lo que la UI debería hacer, en orden: elegir carpeta y enseñar lo
detectado antes de escribir nada (lo que ya hace el asistente),
seleccionar formatos de salida, ver la colección resultante, lanzar
`check` para ver la deriva, y subir a Postman.

Va en propuesta propia con el plan por fases.

---

## 10. Reparto en propuestas

| Propuesta | Recoge | Prioridad |
|---|---|---|
| Identidad de endpoint | H-1, H-2 | **alta** — es la causa raíz de cuatro bugs |
| Fronteras y `enrich` | H-3, H-4, H-5, H-11 | alta |
| Código reutilizable | H-7, H-8, H-9, H-10 | media |
| Tests de los comandos | H-12, H-13 | media |
| Un solo idioma en el CLI | H-16 | media |
| El plugin llega a todo el CLI | H-17 | media |
| Empaquetado y limpieza | H-6, H-18, H-19, doc §8 | baja |
| **UI de escritorio** | §9 | a decidir |

Cierre de H-14 (confirmar las alertas a 0) se sigue en esta misma
propuesta hasta que se pueda dar por hecho.

---

## Qué queda fuera a propósito

- **No se tocan las versiones de `express` (4.x) ni `symfony` (6.4)** en
  los manifiestos de ejemplo. No tienen avisos abiertos, y `express` 5
  cambió la sintaxis de rutas: subirlo cambiaría lo que el scanner tiene
  que saber parsear. Eso es una ampliación, no una actualización.
- **No se reescriben las propuestas cerradas.** Son registro de lo que
  pasó.
- **`p00007` sigue bloqueada.** Depende de que `@mcp-vertex/core` se
  publique en npm, que no es de este repositorio.
