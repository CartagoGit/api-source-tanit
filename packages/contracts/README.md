# `packages/contracts` — interfaces, tipos y constantes

La sección más nuclear del repositorio: **no depende de nadie y todas
dependen de ella**. Aquí no hay una sola línea ejecutable.

## Por qué existe

Un tipo declarado al lado de la función que lo estrenó obliga a importar
esa función para usarlo. Suena inocuo. Se midió en tres sitios de este
mismo repositorio:

- La interfaz web importaba `IProjectSummary` de
  `core/discovery/summary.service`. Para **tipar** un resumen se llevaba
  el pipeline entero por delante.
- El plugin MCP importaba el catálogo de nombres de `frameworks/index`,
  que arrastra los veintiún scanners con sus parsers de PHP, Go, Java,
  Python y Rust, para declarar un `z.enum` de veintiún strings.
- `supportedFormats()` metía los cinco exportadores en el grafo por lo
  mismo.

El peso es lo de menos. El efecto grave es que, con el tipo dentro de la
implementación, **nada impide que se dupliquen**. `SummaryOutputSchema`
reescribía con zod la forma de `IProjectSummary`; las dos se separaron, y
el esquema declaraba 6 campos mientras el handler devolvía 18. Nadie
podía notarlo porque no había nada que los confrontara.

## Qué va dónde

| Carpeta | Qué contiene | Sufijo |
|---|---|---|
| `interfaces/` | `export interface`, `export type` | `.interface.ts`, `.d.ts` |
| `constants/` | valores compartidos | `.constant.ts` |

Y dentro de cada una, una subcarpeta por sección de origen: `core/`,
`frameworks/`, `cli/`.

## Qué **no** entra

**Implementación.** Ni una función exportada, ni una clase. Lo comprueba
`tests/contracts/self-contained.spec.ts`, que además verifica que ningún
fichero de aquí importe nada de fuera: un contrato que necesita alcanzar
`core/` para tiparse no es un contrato, es la firma de una
implementación con otro nombre.

**Un asset que usa `const`.** `UI_HTML` es la página entera de la
interfaz web, con su CSS y su JS dentro. Es un documento que el programa
sirve tal cual, no un valor del que dependa nadie. Meterlo aquí sería
cumplir la letra rompiendo el motivo.

**Una raíz de composición.** `DEFAULT_REGISTRY` parece una constante y no
lo es: es un grafo de scanners ya instanciados. Traerlo aquí metería los
veintiún scanners justo donde no puede haberlos.

Las dos están declaradas en `EXCEPTIONS`, en
`scripts/gates/lint-contracts.script.ts`, **con su motivo escrito**. Una
excepción sin motivo es una que nadie podrá revisar dentro de seis meses.

## El criterio

Algo es contrato cuando **más de un módulo depende de su valor o su forma
concreta**.

`AUTH_TOKEN_VARIABLE` lo cumple con creces: lo comparten el script del
login que guarda el token, el bloque `auth` de la colección y la cabecera
de cada petición. Si bailara entre ellos, la colección dejaría de
autenticar **sin que nada fallara** — Postman mandaría `Bearer {{token}}`
con el token vacío y la API contestaría 401 por un motivo que no tiene
nada que ver con lo que se estaba probando.

## Los catálogos, y por qué van al revés

`FRAMEWORK_IDS` y `EXPORT_FORMATS` son listas **literales**, no derivadas
del registro que las implementa. La dirección es deliberada: el catálogo
es dato y el registro es quien lo cumple. Derivarlo obligaba a arrastrar
la implementación para conocer la interfaz.

El precio son dos listas, y este repositorio ya sabe cómo acaba eso:
`NON_LARAVEL_FRAMEWORKS` enumeraba once de doce frameworks, Laravel no
estaba, y `summary` se iba por un camino distinto contando rutas
declaradas en vez de endpoints — decía 7 donde el pipeline encuentra 17.

Lo que hacía peligrosa aquella lista no era existir: era que **nadie la
comparaba**. Por eso hay un test por catálogo:

- `tests/frameworks/catalog-matches-registry.spec.ts`
- `tests/core/catalog-matches-exporters.spec.ts`

Los dos están verificados metiendo un valor inventado y viendo caer el
gate.

## El gate

```bash
bun run lint:contracts
```

Falla de dos maneras, las dos comprobadas reintroduciendo el fallo:

1. Un tipo o una constante exportados fuera de una carpeta de contratos.
2. Una excepción declarada que **ya no hace falta**. Importa tanto como
   lo primero: una lista de permisos que se queda vieja acaba autorizando
   lo que nadie ha vuelto a revisar.

## Los contratos del plugin

La integración con Delendai tiene **su propia** carpeta de contratos, en
`integrations/delendai/src/lib/contracts/`, con la misma
estructura. No es una excepción a la regla: es un paquete independiente
(`"private": true`, fuera de `workspaces` y de la CI del producto desde
x00041/x00045), compila con `@types/node` real mientras el resto del
repo usa declaraciones ambient escritas a mano, y sus esquemas zod son
**código ejecutable** que no cabe en una sección que promete no tener
implementación.
