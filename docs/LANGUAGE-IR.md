# El LanguageIR agnóstico — cómo se monta un lenguaje encima

Tanit analiza código fuente y encuentra APIs. Hoy lo hace con
**26 scanners**, y cada scanner sabe cómo está escrito el lenguaje
que lee. Este documento explica el contrato que se ha puesto
**debajo** de esa capa para que el próximo lenguaje no obligue a
reescribir el pipeline.

- El contrato: [`packages/contracts/interfaces/language-ir/`](../packages/contracts/interfaces/language-ir/)
- La implementación de referencia (TypeScript):
  [`packages/core/language-frontends/typescript/typescript-frontend.helper.ts`](../packages/core/language-frontends/typescript/typescript-frontend.helper.ts)
- Los tests que lo vigilan:
  [`tests/contracts/language-ir-shape.spec.ts`](../tests/contracts/language-ir-shape.spec.ts) y
  [`tests/core/typescript-frontend-shape.spec.ts`](../tests/core/typescript-frontend-shape.spec.ts)

---

## 1. El problema que resuelve

Un scanner de Express busca `app.get("/users", handler)`. Uno de FastAPI
busca `@app.get("/users")`. Uno de Gin busca `r.GET("/users", h)`. Uno
de Spring busca `@GetMapping("/users")`. Cuatro scanners, cuatro
gramáticas, y **cuatro copias** de la misma pregunta: ¿qué ruta
declara este fichero?

Mientras solo hubiera un lenguaje, esa duplicación era tolerable. En
cuanto entra el segundo, el tercero y el cuarto, cada scanner tiene que
reimplementar —y mantener— la parte de "leer el fichero" de su
lenguaje. Un cambio en cómo se lee un decorator de NestJS obliga a
mirar cinco scanners.

El contrato que sigue separa las dos mitades:

- **Leer el fichero** — de eso se ocupa un *frontend de lenguaje*.
- **Entender lo que se ha leído** — de eso se ocupa el *IR agnóstico*,
  y es lo mismo para todos los lenguajes.

---

## 2. El contrato

Cinco interfaces, en `packages/contracts/interfaces/language-ir/`:

| Interface | Qué responde |
|---|---|
| `ILocation` | ¿dónde está esto? (fichero, línea, columna) |
| `ISymbol` | ¿qué declara este fichero? (funciones, clases, métodos, variables) |
| `ICallExpression` | ¿qué llama a qué? (receptor, método, argumentos) |
| `IDecorator` / `IAttribute` | ¿qué marcadores cuelgan de cada declaración? |
| `ILanguageFrontend` | ¿cómo se lee un fichero de este lenguaje? |

Ninguna menciona un lenguaje concreto. Eso no es una aspiración
estilística: hay un test que lo comprueba. El test
[`tests/contracts/language-ir-shape.spec.ts`](../tests/contracts/language-ir-shape.spec.ts)
quita los comentarios de los contratos y busca en lo que queda
`ts`, `babel`, `TSFile`, `TSSymbol`, `estree`… Si alguien escribe un
contrato que dependa de la implementación de TypeScript, el test
falla.

### Las dos decisiones de diseño que importan

**La llamada se describe con estructura, no con texto.** `ICallExpression`
separa el receptor (`receiver`), la forma de llegar a él
(`receiverKind`) y el método (`method`). El `callee` — `"this.router.get"`,
`"server[\"get\"]"` — se conserva para los mensajes de error, pero no
para deducir el verbo: un consumidor que parte el texto por puntos
pierde `this.router.get` (el verbo sería `router`) y `server["get"]`
(no hay punto). Las seis formas que el IR reconoce:

| `receiverKind` | Ejemplo |
|---|---|
| `identifier` | `app.get(...)` |
| `this` | `this.router.get(...)` |
| `member` | `api.router.get(...)` |
| `factory` | `getRouter().get(...)` |
| `computed` | `server["get"]` |
| `optional` | `router?.get(...)` |

El caso `computed` se escribe sin paréntesis a propósito: el miembro se
accede con una expresión computada (`server["get"]`), no con un nombre.

### La posición: el ancla, no el nodo

`ILocation` pide fichero, línea y columna. La columna no es "donde
empieza el nodo": es donde está el **ancla** — la cosa que identifica
lo que se está buscando.

| Qué | Dónde está el ancla | Ejemplo |
|---|---|---|
| Una declaración | el **nombre** que introduce | `class A {` → el `A`, columna 6 |
| Un marcador | el **nombre** que lleva | `@Get()` → el `Get`, columna 1 |
| Una llamada | la **expresión** que se llama | `app.get(...)` → el `app` |

La diferencia importa. Una clase decorada **empieza** en su decorador
(`@Controller`), así que el nodo está en la línea 1; pero su nombre
está en la línea 2. Un consumidor que posiciona por columna tiene que
recibir un par *coherente* — la línea y la columna tienen que hablar de
lo mismo — y ese par es el del nombre.

El frontend de TypeScript cumple esto: el AST normalizado solo traía
la **línea** de cada declaración (los scanners nunca necesitaron la
columna), así que las columnas se leen del **mismo árbol de sintaxis**
que produjo el AST. Un parse, dos vistas.

**La visibilidad de un método viene de su clase.** El frontend de
TypeScript no modela la visibilidad de los miembros, así que un método
hereda la de la clase que lo contiene: el método público de una clase
exportada **es** visible desde fuera del módulo, y el de una clase que
no se exporta, no. Es una aproximación declarada, no un accidente —
y hay un test que la fija.

**El decorador y el atributo son la misma cosa.** En JavaScript y en
Python se llama *decorador*; en Java, *anotación*; en C#, *atributo*.
El mecanismo es idéntico —un nombre, unos argumentos y la
declaración a la que se engancha— así que el contrato lo declara una
vez (`IAttribute`) y publica `IDecorator` como alias. Un frontend de
Java y uno de Python llenan la misma ranura, y el consumidor decide
por el **nombre** del marcador (`"Get"`, `"GetMapping"`, `"HttpGet"`),
que es dato y no vocabulario.

---

## 3. La implementación de referencia

El frontend de TypeScript ya existía: `typescript.parser.ts` produce
un `TSFile` (imports, símbolos, clases, llamadas, decoradores) que
consumen los scanners de JavaScript. **No se ha sustituido** — se ha
añadido una vista al lado.

```
packages/core/language-frontends/typescript/
  typescript.parser.ts          # el parser de siempre (sin cambios)
  typescript-frontend.helper.ts # la vista agnóstica (nuevo)
  index.ts                      # el barrel (una exportación nueva)
```

El fichero nuevo hace **un solo parse** y proyecta el resultado:

- Los símbolos salen de `TSFile.symbols` y `TSFile.classes`.
- Los decoradores salen de `TSFile.decorators`.
- Las llamadas salen del LanguageIR (`buildLanguageIRFromProgram`), que
  es quien reconoce las seis formas de callee.

El contrato pide posición; el LanguageIR la guarda como rango de
caracteres y el frontend la convierte a línea y columna. Las
**declaraciones** no vienen con rango: el AST normalizado solo trae la
línea, y la columna se lee del árbol de sintaxis — el mismo del que
sale todo lo demás (ver [la posición](#la-posición-el-ancla-no-el-nodo)).

Lo que **no** ha cambiado: `parse()`, `parseModule()`,
`parseModuleWithProgram()` y `extractRoutes()` devuelven exactamente lo
que devolvían. Los scanners de JavaScript no se han tocado. Eso es lo
que hace que el refactor sea invisible para los consumidores actuales,
y hay un test que lo comprueba
([`tests/core/typescript-frontend-shape.spec.ts`](../tests/core/typescript-frontend-shape.spec.ts)).

### 3.1 Cuando el parse falla: degradar, no lanzar

El frontend de referencia llama a `parseWithProgram`, que **lanza** un
`SyntaxError` cuando el fichero no compila. Para uso directo —un test,
un script— está bien: quien llama puede coger el error. Para un
frontend de producción, no: un scanner no puede abortar el escaneo
entero porque un fichero tenga una sintaxis rara.

El camino que usan los scanners de hoy es `parseModuleWithProgram`
([`packages/core/language-frontends/typescript/typescript.parser.ts`](../packages/core/language-frontends/typescript/typescript.parser.ts)),
que **degrada**: devuelve `null` y registra el motivo en `diagnostics`.

```ts
const diagnostics: Array<IParseDiagnostic> = [];
const parsed = parseModuleWithProgram(raw, filename, diagnostics);
if (!parsed) {
  // El fichero no se pudo leer. Se sigue con el siguiente y el
  // motivo queda visible para quien lo quiera reportar.
  return { routes: [], diagnostics };
}
const { tsFile, program } = parsed;
```

La regla es una sola: **un frontend de producción nunca lanza por un
fichero que no puede parsear**. Degrada —documento vacío y
diagnóstico— y deja que el escaneo continúe.

`parseWithProgram` y `parse` son la puerta de atrás: sirven para uso
directo, cuando el que llama sabe manejar el error. La variante que
degrada es la que se usa en producción, y es la que debe usar el
frontend del próximo lenguaje.

---

## 4. Un frontend mínimo, de referencia

Este es el esqueleto de un frontend. Es **completo**: se puede copiar,
cambiarle el `languageId` y compilar.

```ts
// packages/core/language-frontends/<lenguaje>/<lenguaje>-frontend.helper.ts
import type {
  ICallExpression,
  IDecorator,
  ILanguageDocument,
  ILanguageFrontend,
  ISymbol,
} from "../../../contracts/interfaces/language-ir/language-ir.interface.js";

/**
 * The frontend for one language: it reads a file and answers the four
 * questions of the agnostic contract.
 */
export const exampleFrontend: ILanguageFrontend = {
  languageId: "example",

  parse(source: string, filename: string): ILanguageDocument {
    // 1. Read the file with whatever parser this language has.
    //    If the read FAILS, degrade: do not throw. Record the reason
    //    in a diagnostic and return an empty document, so that the
    //    scan which called us continues with the next file.
    // 2. Project what was read onto the agnostic shapes.
    const symbols: ISymbol[] = [];
    const calls: ICallExpression[] = [];
    const decorators: IDecorator[] = [];

    return { languageId: "example", filename, symbols, calls, decorators };
  },

  extractSymbols(document: ILanguageDocument): ReadonlyArray<ISymbol> {
    return document.symbols;
  },

  extractCalls(document: ILanguageDocument): ReadonlyArray<ICallExpression> {
    return document.calls;
  },

  extractDecorators(document: ILanguageDocument): ReadonlyArray<IDecorator> {
    return document.decorators;
  },
};
```

> **Un frontend de producción degrada, no lanza.** Si el parse falla,
> devuelve un documento vacío y deja el motivo en el diagnóstico; el
> escaneo sigue. La sección 3.1 lo explica con el camino que usan los
> scanners de hoy.

Y el barrel de la carpeta:

```ts
// packages/core/language-frontends/<lenguaje>/index.ts
export { exampleFrontend } from "./<lenguaje>-frontend.helper.js";
```

> **El sufijo del fichero.** La regla de nombres (`lint:naming`) admite
> `.parser.ts` y `.helper.ts` dentro de
> `packages/core/language-frontends/typescript/` (la carpeta del
> frontend de referencia tiene su propia regla). Para un lenguaje
> **nuevo**, la regla de la carpeta padre admite `.parser.ts` — así que
> el fichero del frontend se llama `<lenguaje>-frontend.parser.ts`. Un
> `.service.ts` —que es lo que proponía la propuesta original para el
> frontend de TypeScript— no pasa el gate, y esta slice no toca el
> gate.

---

## 5. Montar un lenguaje de verdad

### 5.1 El esqueleto

Cada lenguaje nuevo es una carpeta dentro de
`packages/core/language-frontends/`, con **exactamente la misma
forma** que la de TypeScript:

```
packages/core/language-frontends/python/
  python-frontend.helper.ts   # implementa ILanguageFrontend
  index.ts                    # barrel
```

Nada más. No se toca `packages/core/discovery/`, ni
`packages/core/language-ir/`, ni los exporters.

### 5.2 Con tree-sitter

Los cuatro lenguajes que tienen gramática de tree-sitter disponible
—Python, PHP, Go y Java— comparten el mismo esqueleto: `tree-sitter`
parsea a un árbol concrete syntax tree, y el frontend camina ese árbol
con consultas y proyecta lo que encuentra.

```ts
import { Parser, type Node } from "tree-sitter";
import Python from "tree-sitter-python";

const parser = new Parser();
parser.setLanguage(Python);
```

El frontend son tres pasos, y solo el primero es específico del
lenguaje:

1. **Parsear.** `parser.parse(source)` → el árbol. Es lo único que
   sabe qué es un `decorated_definition` o un `method_declaration`.
2. **Caminar el árbol.** Una consulta por cada cosa que el contrato
   pide: declaraciones, llamadas y marcadores.
3. **Proyectar.** Cada nodo del árbol se convierte en un `ISymbol`, un
   `ICallExpression` o un `IDecorator`.

```ts
// 3. Proyectar — la parte que NO cambia de un lenguaje a otro.
function toSymbol(node: Node, filename: string): ISymbol {
  return {
    name: node.childForFieldName("name")?.text ?? "",
    kind: "function",
    exported: !isPrivate(node),
    location: { file: filename, line: node.startPosition.row + 1, column: node.startPosition.column },
  };
}
```

### 5.3 Qué cambia en cada lenguaje

| Lenguaje | Gramática | Dónde vive la ruta | Marcadores |
|---|---|---|---|
| Python | `tree-sitter-python` | `call` sobre `decorator` | decorador (`@app.get`) |
| PHP | `tree-sitter-php` | `member_call_expression` | atributo (`#[Route]`) |
| Go | `tree-sitter-go` | `call_expression` con `selector` | — (no hay marcadores) |
| Java | `tree-sitter-java` | `method_invocation` | anotación (`@GetMapping`) |

Tres de los cuatro tienen marcadores y uno no. El contrato lo
resuelve sin ramas por lenguaje: un frontend sin marcadores devuelve
`decorators: []` y el resto de la cadena no se entera. Un frontend
Java llena la misma ranura que uno de Python, porque `IDecorator` e
`IAttribute` son la misma forma.

Go es el caso interesante: no tiene decoradores, y su forma de
declarar una ruta (`r.GET("/x", h)`) ya es una llamada con receptor.
El frontend de Go no necesita nada que los otros no tengan.

### 5.4 Y el scanner

El scanner de un lenguaje nuevo es un scanner **nuevo**, en
`packages/frameworks/scanners/`, y consume el contrato:

```ts
import { pythonFrontend } from "../../core/language-frontends/python/index.js";

export class PythonProjectScanner implements IProjectScanner {
  scan(file: string, raw: string): ParsedRoute[] {
    const document = pythonFrontend.parse(raw, file);
    return document.calls
      .filter((call) => call.method === "get")
      .map((call) => ({ method: "GET", path: String(call.args[0]?.value ?? "") }));
  }
}
```

Ese scanner **no sabe** que hay un árbol de tree-sitter detrás. Si
mañana el frontend de Python cambia de parser, el scanner no se
toca.

> **Dónde viven hoy los scanners.** La propuesta original nombraba
> `packages/core/scanners/`. Esa carpeta **no existe** en este
> repositorio: los scanners están en
> `packages/frameworks/scanners/`. El contrato agnóstico no cambia
> dónde viven, y ningún scanner existente se modifica al añadir un
> frontend nuevo.

---

## 6. Lo que no hay que tocar

Al añadir un lenguaje, **no** se modifica:

- `packages/core/discovery/` — el pipeline que encuentra ficheros y
  reparte trabajo entre scanners.
- `packages/core/language-ir/` — el LanguageIR que ya consumen los
  scanners de JavaScript.
- `packages/contracts/interfaces/core/language-ir.interface.ts` — el
  IR que ya existe, con sus consumidores.
- Los scanners que ya están — Express, NestJS, Fastify, Hono, Next.js,
  tRPC y el resto.
- Los exporters.

El contrato nuevo es **aditivo**: una carpeta de contratos y una
carpeta de frontend. Los consumidores del IR actual siguen hablando
con el IR actual.

---

## 7. Cómo se comprueba

```bash
bun run typecheck
bun run lint:contracts
bun run test:core
bun run validate
```

Los dos tests que vigilan el contrato:

- `tests/contracts/language-ir-shape.spec.ts` — que los contratos no
  nombren ningún lenguaje concreto, que las cinco interfaces estén,
  que el IR de TypeScript las cumpla y que un frontend de un lenguaje
  que todavía no existe (escrito dentro del propio test) quepa en el
  mismo contrato. Además:
  - el contrato **no puede importar fuera de su carpeta** (una regla
    que no depende del vocabulario: un
    `import … from "../core/language-ir.interface.js"` se colaba sin
    que ninguna de las otras reglas lo viera), y ninguna **cadena de
    tipos** alcanzable —siguiendo los imports de dentro— nombra un
    lenguaje (`TS*`, `Babel*`);
  - **todo frontend registrado** —cada carpeta de
    `packages/core/language-frontends/*/`— implementa el contrato
    entero, así que el lenguaje que llegue mañana no puede romper el
    shape sin que un test lo diga.
- `tests/core/typescript-frontend-shape.spec.ts` — que el frontend de
  TypeScript cumpla el contrato en runtime, que las seis formas de
  callee sobrevivan estructuradas, que el refactor sea invisible y
  que ningún scanner mencione un parser concreto.

### La lista blanca del IR que todavía es de TypeScript

El gate que vigila "ningún consumidor del IR usa implementaciones
concretas" mira el **código** de `packages/frameworks/scanners/`,
`packages/frameworks/laravel/`, `packages/core/language-ir/` y
`packages/core/discovery/` — la prosa puede nombrar el parser que hay
detrás; el código no.

Dos rutas quedan **fuera** de ese criterio, y la lista es explícita:

| Ruta | Por qué |
|---|---|
| `packages/core/language-ir/` | El IR de TypeScript que ya existía, que consumen los seis scanners de JavaScript. |
| `packages/core/discovery/host-config-parser.service.ts` | El parser de la configuración del host, que lee TypeScript. |

Migrarlos al contrato agnóstico es un **no-goal explícito** de la
slice que introdujo el contrato: el trabajo está planificado para una
propuesta posterior. Hasta entonces, la dependencia es una **entrada
de lista blanca con su motivo**, no un agujero que nadie mira — y un
test comprueba que las entradas existen y que sólo hay una.
