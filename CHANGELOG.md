# Changelog

## Sin publicar — 2026-08-07

### Novedades

- lint:secrets y lint:sast como gates propios, y audit en CI (p00038) (`f3359e3`)
  S1 ya estaba: bun audit da 0 vulnerabilidades. S3 y S4 se hacen como lints propios y no con secretlint/semgrep, por dos razones.
- exportacion a OpenAPI, Insomnia, Bruno, HAR y cURL (p00032) (`cbb62ed`)
  Los cinco formatos salen del MISMO catalogo de endpoints que la coleccion de Postman, asi que no pueden discrepar por haber escaneado cada uno por su cuenta. El contrato IExportTarget devuelve una lista de artefactos y no una cadena porque Bruno no es un fichero: es un arbol de carpetas con un .bru por request, que es justo su gracia.
- expostman watch — regenerar al guardar (p00036) (`b59ca63`)
  Esto no es "poner un fs.watch y regenerar". La herramienta ESCRIBE DENTRO de lo que vigila: la coleccion va a <proyecto>/export-to-postman/, que cuelga de la raiz observada. Un watcher que no lo tenga en cuenta ve su propia escritura, regenera, escribe, se ve otra vez — y no para nunca. Es la misma forma del bucle infinito que se llevo por delante una sesion entera de WSL en este repo.
- aserciones en todas las requests y documentacion derivada (p00031) (`1eae4d9`)
  Medido antes: de 17 requests del ejemplo de Laravel, 3 llevaban script — login, refresh y logout, o sea S1, que ya estaba hecha. Las otras 14 no comprobaban nada. Ahora 17/17.
- el bloque auth sale de lo que hace la API, no de una constante (p00039) (`6dca15a`)
  El auth de la coleccion estaba escrito a mano, sin condicion ninguna:
- p00042 cerrada — decir el framework desde el CLI, el asistente y el plugin (`6417fd2`)
  S2 y S3 de p00042. Cuando la deteccion por manifiesto no puede acertar —monorepo, dependencia con alias, manifiesto generado en el build— los tres caminos aceptan ahora que se lo digas.
- Rails, Phoenix y Ktor — 19 frameworks, p00029 cerrada (`d89ac41`)
  Los tres son "declarativos": las rutas viven en un fichero, no repartidas por el codigo. Eso los hace fiables de leer, pero comparten una trampa que hay que resolver bien.
- scanner de Rust y --framework para cuando la deteccion no puede acertar (`476c2cc`)
  RUST (Actix-web y Rocket) en un solo scanner: los dos declaran las rutas igual, con un macro de atributo encima del handler. Separarlos seria duplicar el mismo parser para cambiar dos lineas de deteccion.
- add Rust support with Actix-web and Rocket scanners (`1397e54`)
- **fiber**: scanner de Go, y lint del bucle infinito que tumbo la maquina (`d63871c`)
  Fiber copia la API de Express pero en Go. No se reutiliza el scanner de Gin porque las diferencias no son cosmeticas: Fiber agrupa con `app.Group("/api")` devolviendo un router encadenable, y sus tags son `validate:"..."` (go-playground/validator) en vez del `binding:"..."` de Gin.
- **hono**: scanner propio, y arreglo de un bug del parser de zod compartido (`9fe1c71`)
  Hono es el framework de los runtimes de borde (Workers, Deno, Bun). Se parece a Express, pero dos cosas rompen un scanner escrito para Express:
- **fastify**: scanner propio que lee su JSON Schema (p00029 S1) y plugin en delendai_expostman (`ed4a7eb`)
  Fastify lo recogia el scanner de Express, que lo reconocia por parecido de sintaxis y se perdia los esquemas enteros. Y eso es tirar la mejor fuente que puede tener un scanner: Fastify declara el esquema DENTRO de la propia ruta, y es JSON Schema, o sea tipos exactos en vez de inferidos.
- **bin**: lanzadores por ecosistema, sin reimplementar nada (p00022) (`b84b0f6`)
  bin/expostman (POSIX), bin/expostman.ps1 (Windows) y bin/wrappers/ con Python y PHP. Go, Gradle y Make se documentan como una linea en su fichero de build, que es todo lo que necesitan.
- **paths**: registro de rutas del repo y lint que prohibe contar ".." (`5a0148c`)
  Escribir resolve(__dirname, "../../..") ata un fichero a su profundidad en el arbol. En cuanto se mueve, la constante apunta a otro sitio Y NO FALLA: una ruta equivocada no lanza, simplemente no encuentra nada.
- **naming**: expostman como bin canonico y el plugin bajo plugins/delendai (p00025) (`28e662e`)
  Habia tres nombres a la vez y ninguno decia cual era el bueno: postman-from-routes, postman-exporter y export-to-postman.
- **output**: escribir en export-to-postman/ y no en el build/ ajeno (p00041 S1) (`c98a2c5`)
  La salida iba a `${projectRoot}/build/`. build/ no es una carpeta cualquiera: es la salida por defecto de Gradle, de Maven con ciertas configuraciones, de muchos proyectos de Go y de medio mundo de Makefiles. Estabamos mezclando nuestras colecciones con los artefactos de compilacion de quien usa la herramienta, en una carpeta que su `clean` borra entera.
- **examples**: example-laravel y paridad de nombre entre los 12 frameworks (p00023) (`6dd338c`)
  Habia ejemplo de once frameworks y no del que origino el proyecto. El gate empirico pasa de 11/11 a 12/12.
- add proposal documents for multi-format export, intelligent payload inference, and asynchronous I/O engine optimization (`58a680a`)
- **cli**: inglés, `push` a Postman y asistente interactivo (`e66cbca`)
  Tres cosas que pidió el usuario para que lo pueda usar gente de cualquier país y sin memorizar flags.
- **pipeline**: unificar la generación + gate empírico y lint de tools (`38991e5`)
- **aspnet**: detectar minimal APIs de .NET 6+ (`8e6f102`)
  `app.MapGet("/users", …)` en `Program.cs` es la forma por defecto desde .NET 6 —lo que genera `dotnet new webapi`— y no la cubría nada. Un proyecto moderno de ASP.NET que no usara controladores producía una colección VACÍA.
- **flask**: bodies reales desde Marshmallow y Pydantic (`669b0b9`)
  Flask era el único framework sin reglas de validación: su provider era un stub con `supports: false` que devolvía `[]`, así que los 14 endpoints del fixture recibían bodies inventados por la inferencia heurística.
- **cli**: binario autocontenido por plataforma (p00010) (`3ef9bb0`)
  `bun build --compile` producía un ejecutable que **no funcionaba**:
- **package**: dejar el paquete listo para publicar y verificarlo instalado (p00008) (`b8a39b6`)
  La documentación que escribí prometía `bun add -g @postman-exporter/cli`, pero el paquete **no está en npm** (404). Los comandos documentados no funcionaban.
- **auth**: la carpeta de autenticación se emite primera (p00015 S4) (`b0bb0f4`)
  Es el primer sitio al que hay que ir tras importar: sin lanzar el login ningún otro endpoint responde. En orden alfabético quedaba escondida en mitad de la lista (en flask salía tras Users y Orders).
- **auth**: login funcional y token persistente en Postman (p00015) (`795c6d8`)
  El auto-token existía pero no se activaba en NINGÚN proyecto. Medido sobre los 11 ejemplos antes del cambio: 11/11 con `auth: bearer`, 7/11 con endpoint de login detectado, **0/11 con el script que guarda el token**. Por eso había que pegarlo a mano en cada sesión.
- **postman**: identidad estable de colección y environment (p00014) (`8cd3b0c`)
  `_postman_id` era `crypto.randomUUID()`, evaluado en cada ejecución. Postman usa ese campo para decidir si un import ACTUALIZA la colección o CREA otra, así que cada regeneración dejaba una copia más en el workspace. Los environments tenían el mismo problema.
- **gate**: `bun run validate` autocontenido + lint de tools (p00018, p00011) (`c46e7f6`)
  El `validationCommand` declarado del proyecto era `bun run check`, que en un clone limpio falla:
- **scanner**: add comprehensive tests for ASP.NET, Django, Express, FastAPI, Flask, Gin, NestJS, Next.js, OpenAPI, Spring Boot, and Symfony scanners (`b8804ee`)
- **smoke**: add mini fixtures + expected.json for 7 missing frameworks (`f544787`)
  The postman_exporter_test tool now runs smoke tests against all 12 frameworks instead of just 5. Each mini fixture contains the minimum code for the scanner to detect the framework and parse 4-5 routes, and the expected.json records the exact ParsedRoute.uri values that the scanner emits (before toPostmanUri conversion).
- **scanner**: add Gin, Spring Boot and ASP.NET comprehensive fixtures with 30 passing tests (`682fca3`)
  - Gin: implement BindingProvider with json tag + binding:'required,email,oneof'. Find routes in cmd/, pkg/, internal/. Match structs to URI heuristically. - Spring Boot: implement BeanValidationProvider with jakarta.validation.constraints. Detect @RequestBody @Valid <DtoType> in controllers. Parse DTOs from other files. - ASP.NET: implement DataAnnotationsProvider with [Required], [EmailAddress], [StringLength], [Range], [RegularExpression]. Detect [FromBody] <DtoType>.
- **scanner**: laravel Route::resource + where() expansion (p00001 S1) (`2c26624`)
  Closes the 11-route delta that motivated the slice: the Laravel scanner used to skip Route::resource and Route::apiResource silently, and ignored the where('field', 'regex') constraint that disambiguates routes with the same shape.
- **summary**: in-process summary helper + script + shared scanner registry (p00001 S2) (`d7f1de2`)
  Drops the 'run generate --inspect and parse stdout with regex' hack in the summary tool. Replaces it with a direct in-process call to a new summarizeProject() helper that returns structured IProjectSummary data.
- **smoke-tests**: add mini fixtures and expected outputs for Django, Express, FastAPI, Laravel, and Symfony (`cf802f5`)
- **test**: add test tool registration and integration tests (`7a96572`)
- **scanner**: django-comprehensive fixture + 16 e2e tests (`de324b1`)
  Adds a Django DRF fixture covering 18 endpoints across 3 apps (users, orders, auth) and ships all 16 e2e tests covering detection, serializer resolution and edge cases.
- **scanner**: comprehensive fixtures + e2e tests for Express, NestJS and Symfony (`cd078fd`)
  - express-comprehensive fixture (zod + Joi + nested schemas + enums) - nestjs-comprehensive fixture (DTO classes with class-validator) - symfony-comprehensive fixture (YAML routes + PHP #[Route] attributes) - toPostmanUri now handles Django-style <int:id> / <str:slug> / <id> params before falling through to Express :param and Laravel {param} - symfony.scanner: parseSingleController now extracts class-level #[Route('/prefix')] prefix and applies it to method routes - nestjs.scanner: NestJsClassValidatorProvider resolves referenced DTO types via the controller's imports before falling back to inline decorators
- add comprehensive FastAPI and Symfony fixtures with OpenAPI support (`1e3373c`)
  - Created FastAPI project fixture with dependencies in pyproject.toml - Added comprehensive OpenAPI specification in YAML format - Implemented Symfony project fixture with console entry point and composer.json - Defined routes for health check, authentication, user, order, and pet management in Symfony - Developed controllers for handling authentication and CRUD operations for users and orders - Introduced smoke tests and JSON comparison helpers for testing framework - Added fixture management utilities for creating and cleaning up temporary test directories - Implemented a scanner runner to execute the full scan and generate process for fixtures
- **scanner**: add OpenApiScanner and SymfonyScanner implementations (`70e13e7`)
  - Implement OpenApiScanner for detecting and parsing OpenAPI specifications in various formats (JSON/YAML) from common project directories. - Introduce SymfonyScanner for detecting Symfony projects and parsing routes defined in YAML and PHP attributes. - Add validation support for Symfony attributes using SymfonyAttributesValidationProvider. - Enhance route scanning capabilities for both OpenAPI and Symfony frameworks.

### Arreglos

- OpenAPI en YAML (rectificado), y un GET que salia con requestBody (`32a734f`)
  Rectifico la decision del commit anterior. Emiti JSON por miedo a las reglas de escalares de YAML: un `descripcion: si` sin comillas es un booleano, y un fallo asi corrompe el documento en silencio. Al volver sobre ello, la forma segura resulto ser trivial — citar TODA cadena. Una cadena entre comillas dobles es una cadena y ninguna regla de YAML se le aplica; los numeros y booleanos van sin comillas porque eso es lo que son en el dato de origen. El escapado se delega en JSON.stringify, que es identico al de las comillas dobles de YAML y es la parte donde un fallo propio seria mas dificil de ver.
- los DTOs de NestJS nunca dieron un campo, y otros tres bugs (p00034) (`5b1e332`)
  Medido antes de tocar nada: 64/74 endpoints de escritura con body (86%). Ahora 70/74 (95%), y los 4 que quedan son logouts — que no llevan body porque un logout no recibe nada.
- p00027 cerrada — S4 se retira con evidencia, no se da por hecha (`44f9322`)
  S4 proponia sustituir los `../../../../../` del plugin por una dependencia de paquete. Se intento y se midio:
- noUncheckedIndexedAccess en todas las secciones (p00043) (`a8ee98f`)
  tsconfig.base.json dice que ninguna seccion relaja sus reglas, y aun asi faltaba la que mas importa aqui. `strict` NO la incluye: sin ella `array[i]` tipa como T aunque el indice se salga, y `match[1]` como string aunque el grupo no haya casado.
- **docs**: lint que impide que la documentacion mienta (`6864e8d`)
  Auditoria de los comandos documentados, ejecutandolos de verdad. Los 6 subcomandos del CLI funcionan, pero dos referencias llevaban commits rotas:
- **body**: los `update` salian sin ejemplo, y 60 tests de calidad de la coleccion (`c1a15f1`)
  Auditando la coleccion generada del ejemplo de Laravel salio que `PUT /api/users/{{id}}` no llevaba body, teniendo su FormRequest reglas para `name` y `age`.
- **scan**: un ciclo de enlaces dejaba el escaneo ciego, y otros bugs de auditoria (`9a6a1b2`)
  Auditoria por comportamiento, no por lectura: se le dieron al CLI proyectos raros y se miro que hacia.
- **quality**: 135 declaraciones muertas fuera y noUnusedLocals en el gate (p00037) (`b1774f5`)
  Los 14 hallazgos de la auditoria, cerrados.
- **summary**: mismo camino que generate, y pipeline seguro en concurrencia (`2af8607`)
  Encontrado usando el propio MCP: `summary` decia 7 endpoints para examples/example-laravel y `generate` producia 18. El contrato de summary es "esto es lo que vas a obtener si generas", asi que un resumen que no anticipa la generacion no sirve para decidir nada.
- **dx**: barrido de avisos del editor (p00026 S3+S4) (`d766c2a`)
  S3 se resolvio por otro camino del previsto. La propuesta queria meter plugins/ en el include del tsconfig de la raiz, y avisaba de que eso chocaria: el plugin compila con @types/node real mientras el resto del repo usa las declaraciones a mano de contracts/postman.d.ts, y las dos fuentes se pisan en spawnSync y en Bun.
- **deps**: cero vulnerabilidades regenerando el lockfile (`fb984d4`)
  `bun audit` daba dos moderadas y las dos eran rancieza del lockfile, no dependencias de verdad:
- **discovery**: escanear todos los frameworks que reconocen el proyecto (p00024) (`13f8240`)
  Un repo hibrido —un Express heredado sirviendo la API vieja mientras las rutas nuevas se escriben en Next.js— es una forma de API real y frecuente, y el pipeline la trataba fatal: el orchestrator puntuaba los dos detectores, se quedaba con el de mas score y tiraba el otro.
- **plugin**: el plugin como proyecto independiente y su contrato con el CLI (p00027) (`160365d`)
  El plugin es un paquete propio que delendai carga en su proceso, pero estaba tratado como una carpeta mas del CLI. Eso habia dejado cuatro cosas rotas a la vez, todas en silencio.
- **plugin**: errores de tipos que el gate nunca había visto (p00025 S1+S2) (`2f7b465`)
  `bun run typecheck` usa el tsconfig de la raíz, cuyo `include` no lista `plugins/`. El plugin llevaba desde siempre fuera del gate y tenía 5 errores:
- **scanners**: tres bugs que hacían perder endpoints en proyectos reales (`c5f993f`)
  Encontrados probando formas de proyecto que no están en los fixtures.
- **aspnet**: resolver el DTO del body por endpoint, no por fichero (`c05a0f9`)
  `AspNetDataAnnotationsProvider` buscaba el primer `[FromBody] X` de TODO el fichero. En un controlador con varios endpoints, todos recibían el DTO del primero: en el fixture, `PATCH /orders/{id}/status` salía con los campos de creación de pedido.
- **types**: declarar mkdtemp, rm, node:os, Bun y Response (`a3ac252`)
  El commit anterior dejó `bun run typecheck` en rojo: el script de validación de empaquetado usa APIs que las declaraciones ambient del proyecto no cubrían. El proyecto declara los globals de Node a mano para no depender de @types/node ni @types/bun, así que cada API nueva hay que añadirla.
- hacer el pipeline reentrante entre proyectos (p00017, parcial) (`1289ee8`)
  `paths.service` resuelve la raíz del proyecto una vez por proceso y la cachea. Consecuencia: generar el proyecto A y luego el B en el mismo proceso le daba a B la configuración y las rutas de A. Afectaba al servidor MCP, al gate y a la suite de tests, y era la causa de fondo del bug del provider de FormRequests de Laravel.
- **cli**: `--project-root` producía una colección VACÍA en proyectos externos (`d76d3d5`)
  El caso de uso principal del paquete —instalarlo y lanzarlo contra tu API— estaba roto y sin cobertura.
- **types**: dejar `tsc --noEmit` limpio y unificar el recorrido de ficheros (`e63d7af`)
  `bun run typecheck` llevaba tiempo fallando con 8 errores. Ninguno era cosmético: el de django.scanner venía de un `as unknown as [...]` que mentía sobre el tipo real de `readdir(..., withFileTypes)` y dejaba `entries` declarado como `string[]`.
- dejar la suite en verde arreglando 5 bugs reales de scanner (`dded88c`)
  La suite venía con 9 tests rojos. Ninguno era ruido de test: cada uno tapaba un fallo que afectaba a colecciones reales.
- **scanner**: eliminar el cuelgue infinito de Next.js y deduplicar los parsers (`82c4c25`)
  `NextJsZodProvider` colgaba el proceso al escanear cualquier proyecto Next.js que declarase un `z.object(`: su copia local de `findAllBalanced` iteraba con `exec()` sobre una regex sin flag `g`, así que `lastIndex` nunca avanzaba. Afectaba a `bun test` entero (nunca terminaba) y a cualquier usuario real con un route handler validado con zod.
- **memory**: remove leftover spawn/GENERATE_SCRIPT dead code from run-scanner.ts (`024850c`)
  The previous commit partially rewrote run-scanner.ts but left the old spawn-based runGenerate and runGenerateMetrics implementations at the end of the file (after the new in-process versions). This caused:
- **memory**: eliminate all spawn subprocesses from tests and scripts (`d2fae59`)
  The previous implementation spawned a fresh 'bun' process for every test case via spawn() in run-scanner.ts and test-all.script.ts. With bun test running files in parallel, this could create dozens of concurrent bun processes each loading all 12 scanners + all services, consuming several GB of RAM and crashing the host.
- **test**: actually instantiate the scanner pair in the smoke step (`88c364f`)
  The test.tool registered a step that invoked `scannerPair.projectScanner.resolve()` directly on the *class* returned by the dynamic import, so the call returned `undefined.resolve` and the smoke step always reported 'scanner no disponible' / 'smoke crashed'.
- **runner**: tolerate invalid cwd / missing bun binary (`b329829`)
  runBunSpawnSyncArray used to throw on cwd inválido or binario no encontrado, which propagated up to MCP tools as an unhandled exception. Wrap the spawn in try/catch and return a 'failed' result (status:null, error:Error) so the caller can report it as a step with ok=false and an actionable detail instead of crashing.
- **p00013**: plugin boot, zod v4 alignment, namespace contract (`ce6dc37`)
  Server boot was failing with `ReferenceError: NAMESPACE is not defined` in 3 tools of the postman-exporter plugin. Beyond that, the plugin did not typecheck (6 ZodObject vs ZodRawShapeCompat errors, 1 readonly-issues.push error, missing @types/node). All four classes of bug share one root cause: the plugin was pinned to zod 3.23.8 while @delendai/core uses zod 4.4.x, whose ZodRawShapeCompat requires the standard interface (`~standard`, `~validate`).
- **agents**: replace unsupported GPT-5.4 model with MiniMax M3 (`ede6494`)
- **agents**: replace unsupported MCP glob with explicit tool names (`a8276a6`)
  VS Code silently ignores 'mcp-project-delendai/*' in the agents' `tools:` permission list — confirmed by the prompt validator warning "Unknown tool 'mcp-project-delendai/*' will be ignored." Each agent was left with only `read, search` (or `read, search, execute`), unable to invoke the MCP server at all.

### Rendimiento

- lectura en paralelo con tope, y un benchmark que la mide (p00033) (`6bbf20b`)
  La propuesta pedia "≥2× en proyectos grandes". Medido antes de tocar nada, salieron dos correcciones.

### Refactors

- **naming**: el plugin y su namespace MCP se llaman como el proyecto (`b60433c`)
  El proyecto se renombro a export-to-postman pero el plugin se quedo en postman-exporter, asi que sus tools se registraban como `delendai_postman-exporter_generate` mientras el binario ya era `export-to-postman`. Dos nombres para una cosa.
- projects/{core,frameworks,cli,ui,plugin} y scripts/{gates,build} (p00020) (`ad962f8`)
  La estructura era la de la primera version, cuando esto solo generaba colecciones de Laravel. No habia un centro: lo que el proyecto HACE estaba repartido en tres carpetas de la raiz, al mismo nivel que docs/ y examples/. Y scripts/ tenia 19 ficheros planos que eran tres familias distintas.
- carpetas contenedoras en plural (p00041 S2) (`54ddc4e`)
  Habia ocho carpetas y dos convenciones: contract/, helper/, service/ y plugins/src/lib/contract/ en singular; frameworks/, scripts/, tests/, examples/, plugins/, docs/ en plural. Sin criterio, solo historico.
- **core**: separar el nucleo agnostico de lo concreto de cada framework (`bb78599`)
  El proyecto decia ser agnostico pero el nucleo importaba lo concreto: generation.pipeline traia defaultOrchestrator() del registro, y con el entraban los 12 scanners. Consecuencia medible: `service/` no se podia compilar, ni testear, ni razonar sin arrastrar Laravel, Spring Boot y Gin detras. Un nucleo con una arista hacia lo concreto es agnostico solo en la documentacion.
- IProjectContext explícito en vez del singleton de paths (p00017) (`3fd6137`)
  `paths.service` resolvía la raíz del proyecto una vez por proceso. La dependencia era invisible en las firmas, y por eso el provider de FormRequests de Laravel podía recibir `match.projectRoot` e ignorarlo.

### Documentación

- add proposals for advanced API protocol support and expanded framework coverage, and update project configuration and scripts. (`01d8d19`)
- **p00007**: reescribir con el reparto real entre los dos repositorios (`53dc58b`)
  La propuesta decía "publicar @delendai/core en npm **y** cambiar los plugins". La primera mitad no es de este repositorio.
- **audit**: segunda tanda de bugs y estado final (0 propuestas abiertas) (`c855934`)
- **audit**: estado final, 6 bugs nuevos y lo que queda abierto (`54ba809`)
- reescribir la documentación de uso e import en Postman (p00019) (`391924f`)
  El README describía el paquete como "generador … de un proyecto **Laravel**", igual que la `description` del package.json, cuando soporta 12 frameworks. Quien llegase buscando Express, Django o Spring Boot concluía que no le servía. Y no había absolutamente nada sobre instalar ni sobre importar en Postman, que es el paso final y el de más fricción.
- **audit**: auditoría completa + 6 propuestas nuevas (p00014-p00019) (`a758c22`)
  Recoge el estado medido del repo, los 7 bugs corregidos con su causa raíz, y el capítulo aparte de por qué los tests no los detectaron (había tests que asertaban el bug como comportamiento correcto, y seis con `if (!x) return;` que pasaban en verde cuando el scanner dejaba de encontrar la ruta).
- **proposals**: close p00001 — S1+S2+S3 all shipped (`5f36cf0`)
  Final state:
- **proposals**: close p00002 — architecture pivoted to scanner trio (`a7e0573`)
  The original proposal imagined a single IRouterAdapter with detect()+discover(). Real implementation split the responsibility into three smaller contracts in contract/scanner.interface.ts:
- **proposals**: mark p00003 S2 as done (smoke runner shipped) (`ed06c85`)
  Smoke runner is now wired into postman_exporter_test: it dynamically load service/scanners/<framework>.scanner, instantiates the project + route scanners, runs the scanner against a mini fixture under tests/smoke-fixtures/<framework>-mini/ and diffs the output against the sibling expected.json.
- **proposals**: mark p00003 S1 as done (test tool shipped) (`2b87a84`)
  Implements the slice body that adds the 4th tool to the postman-exporter plugin: postman-exporter_test runs bun run typecheck and bun test tests/e2e/, plus an optional framework smoke step.

### Tests

- vitest con un project por seccion y runner por zona modificada (`d7b50b1`)
  La suite corria entera con `bun test` y no habia forma de pedir solo la parte que tocas. Ahora hay cuatro secciones (core, frameworks, cli, e2e) mas el plugin, cada una con su project de vitest.
- cubrir los 7 módulos sin tests directos (p00009) (`993b83b`)
  `service/` y `helper/` pasan de 31/38 a 38/38 módulos con tests propios. Los 7 que faltaban solo se ejercitaban de refilón por los e2e, así que sus fallos se manifestaban lejos de su causa.
- contrato de colección en los 12 e2e y auth flow dentro del pipeline (p00016 S3) (`43f560d`)
  `describeCollectionContract` comprueba sobre la colección generada lo que `describeScannerContract` comprueba sobre las rutas: invariantes de Postman v2.1.0, id estable entre generaciones, cero requests duplicadas, toda `{{variable}}` declarada, sin carpetas vacías, todas las urls arrancando en `{{baseUrl}}`, auth bearer presente, y que las métricas cuadren con los requests emitidos.
- contrato de scanner común a los 12 frameworks (p00016 S1+S2) (`be4faff`)
  Las 12 suites tenían un número parecido de tests pero no probaban lo mismo, y eso es lo que dejó pasar los bugs de la auditoría: solo Symfony tenía test de "no duplica endpoints" (escrito al revés, asertando que sí duplicaba), y ninguno comprobaba que `sourceFile` fuese relativo ni que un endpoint comentado quedase fuera.
- **nextjs**: add detection for Pages Router routes in /pages/api/*.ts (`6771b8f`)
- align gin coverage and docs (`108bf58`)
- tighten scanner unit coverage (`f7d4e96`)
- **e2e**: add laravel + nextjs comprehensive fixtures and e2e tests (`cc2ac15`)
  Closes the two missing e2e coverage gaps (laravel and nextjs were the only frameworks with a comprehensive fixture folder or e2e test but not both).
- **postman-exporter**: Flask comprehensive fixture with 7 passing tests (`1bbba3a`)
  Add fixtures and tests for Flask scanner: - app/__init__.py with create_app factory - app/routes.py with @app.route for /health - app/users/__init__.py with users_bp Blueprint (url_prefix=/api/users) - app/orders/__init__.py with orders_bp Blueprint - app/auth/__init__.py with auth_bp Blueprint - 7 E2E tests covering all paths, blueprints, methods, path converters
- **postman-exporter**: Django comprehensive fixture with 16 passing tests (`ec65f20`)
  Add fixtures and tests for Django + DRF scanner: - urls.py with health, includes for users/orders/auth - users/{serializers,views,urls}.py with multiple DTOs - orders/{serializers,views,urls}.py with ListCreate, Retrieve, Update views - auth/{serializers,views,urls}.py with FBV @api_view - 16 E2E tests covering all paths, methods, serializers
- **unit**: add 88 unit tests across 7 service modules (p00001 S3) (`c2f17dc`)
  Implements the vitest baseline called for in p00001 S3. The project uses bun:test (same API as vitest), so the resulting specs are valid in both runners.

### Build

- **mcp**: declarar los servidores MCP una sola vez, con lint de deriva (`dbaeb25`)
  Claude Code y VS Code leen ficheros distintos Y formatos distintos:
- sufijos de fichero coherentes con lint que los exige (p00041 S3+S4) (`a4fb6d0`)
  El repo tenia una convencion de sufijos escrita en CONTRIBUTING y nada que la comprobara, asi que habia ficheros que no la seguian sin forma de saberlo salvo mirando uno a uno.
- tipado y lint segmentados por seccion, con lint de limites entre capas (`9ea795c`)
  Los tests ya corrian por seccion; el tipado y el lint no. Un solo tsc sobre todo el repo pasa aunque las capas esten enredadas: mientras el programa completo compile, da igual quien importe a quien.

### Mantenimiento

- **plugin**: el id del setting de tsdk es js/ts.tsdk (`1cfa141`)
  VS Code renombro el ajuste; "typescript.tsdk" ya no es el id valido. Verificado que la ruta resuelve: projects/plugin/node_modules/typescript/lib existe (typescript NO esta hoisted a la raiz, asi que la ruta relativa al plugin es la correcta).
- retirar runtime/, 1231 lineas muertas (p00021) (`0207c57`)
  runtime/ eran tres reimplementaciones paralelas del CLI en Node (290 lineas), Python (348) y PHP (593), escritas para proyectos que no quisieran instalar bun.
- rename project and binaries to "export-to-postman" (`7755d31`)
- **proposals**: anclar el esqueleto de carpetas con .gitkeep (`8217410`)
  git no versiona directorios: en cuanto la ultima propuesta de un estado se movia a otro, la carpeta desaparecia del repo y el siguiente que quisiera usar ese estado se quedaba sin sitio donde dejarla.
- **proposals**: adoptar la disposición por estado de delendai (`b638fc4`)
  Las 25 propuestas vivían todas en `ready/`, incluidas las 17 cerradas. `ready/` no servía para saber qué queda por hacer, que es justo para lo que existe.
- cerrar p00003, p00004, p00005, p00012 y p00013 (`5707dcf`)
  Revisadas contra el estado real del repo, no contra lo que decían.
- **merge**: unificar main y develop en una sola línea de trabajo (`7d74fa9`)
  main llevaba todo el trabajo de scanners (12 frameworks, fixtures, suites unit/e2e) mientras develop llevaba las propuestas p00004-p00013, CLAUDE.md, CONTRIBUTING.md, los agents de host y el bootstrap de proyecto. Este merge junta ambas.
- **docs**: project bootstrap + extension-contract superseded (`8f9a28e`)
  Wire the project-specific agent bootstrap chain so postman-exporter follows the same host-appendix pattern that delendai itself uses, instead of being a hand-rolled copy of the universal bootstrap.
- **workspace**: align postman-exporter with delendai host contract (`88e892a`)
  Adopt the canonical cross-project setup from delendai docs/CROSS-PROJECT-SETUP.md and docs/delendai/CROSS-IDE.md so this workspace follows the same host contract as delendai itself.

_8 commit(s) fuera del convenio `tipo: asunto`, no listados._

