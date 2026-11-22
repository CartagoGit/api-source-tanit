# La interfaz (`apisrc ui`)

La herramienta sin terminal. Apuntas a la carpeta de tu API, ves lo que
se detecta antes de escribir nada, y generas la colección. Aquí está
todo lo que ofrece la pantalla.

Si aún no has instalado la herramienta: [INSTALL.md](INSTALL.md).

---

Los binarios distribuidos incluyen Angular y lo sirven con `apisrc ui`.
Es la misma app que usa el escritorio. Para trabajar sobre el frontend
desde el repositorio, usa `bun run ui:dev`. El checkout también conserva
una interfaz integrada de respaldo si aún no existe un build de Angular.

---

## La app de escritorio

La app es un cliente **real** de la Application API: lo que ves en
pantalla es lo que el backend responde, no un maqueta. Para verla en el
navegador, contra el backend de verdad:

```bash
bun run ui:dev                # Angular y Application API con recarga en desarrollo
bun run build:app             # compila el frontend que usa Tauri
bun run ui:web                # sirve ese build y la API en el mismo origen
```

### Analizar el consumo de API

Abre **Consumo de API**, elige la carpeta del frontend y, si quieres comparar
rutas, elige también un backend. El informe muestra las llamadas observadas,
su ubicación en el código y los casos que Tanit no pudo resolver. Con un backend
seleccionado, muestra las coincidencias, las llamadas sin operación y las que
tienen varias candidatas.

En **Varios proyectos**, busca las carpetas de frontend y los servicios de
backend que quieras usar. Selecciona los candidatos y añade cada vínculo de
forma explícita. Si una misma ruta encaja con varios servicios seleccionados,
el informe mantiene visibles las candidaturas y marca la llamada como ambigua.

En escritorio puedes usar el selector del sistema. En el navegador, usa la URL
de `apisrc ui` y elige una ruta que pueda leer el proceso de Tanit. Una web
estática no puede leer las carpetas de tu equipo.

### Servir el build con Apache

Construye la web y arranca la Application API en otra terminal.

```bash
bun run build:web
bun run ui:web --port 5200 --proxy-origin http://127.0.0.1:8080 --no-open
```

Usa `dist/web/browser/` como directorio raíz. El build incluye
`.htaccess`, que recupera la app al recargar una ruta como `/endpoints`
y conserva las respuestas de los recursos y de la API.

Configura Apache 2.4 con `mod_rewrite`, `mod_proxy` y `mod_proxy_http`.
Ajusta la ruta al build y usa el puerto que imprimió la Application API.

```apache
Listen 127.0.0.1:8080
<VirtualHost 127.0.0.1:8080>
    ServerName 127.0.0.1
    DocumentRoot "/ruta/absoluta/dist/web/browser"
    DirectoryIndex index.html
    ProxyPreserveHost On
    ProxyPassMatch "^(/api(?:/.*)?)$" "http://127.0.0.1:5200$1"

    <Directory "/ruta/absoluta/dist/web/browser">
        Options FollowSymLinks
        AllowOverride FileInfo
        Require local
    </Directory>
    <Location "/api">
        Require local
    </Location>
</VirtualHost>
```

Abre `http://127.0.0.1:8080`. El proxy conserva ese origen y el
navegador autentica sus solicitudes con un token por arranque. El
backend opera sobre los proyectos accesibles para el usuario que lo
ejecuta. La selección activa se recupera al recargar la misma pestaña.

Lo que hay en el menú lateral, en **cuatro grupos**. Los grupos dicen
qué es la app para lo que estás haciendo; las secciones son lo que hay
dentro.

### Inspeccionar — qué hay en el proyecto

| Sección | Qué hace |
|---|---|
| **Resumen** | Los frameworks reconocidos, los endpoints y los servicios del proyecto abierto. |
| **Endpoints** | La lista real, con los filtros en el backend: servicio, transporte, autenticación, validación, framework, respuestas, confianza y fichero de origen. Al elegir uno se pide su detalle: transporte, auth detectada, reglas de validación, estados de respuesta y fichero y línea. |
| **Servicios** | Los servicios detectados y sus transportes. |

### Producir — lo que sale del proyecto

| Sección | Qué hace |
|---|---|
| **Exportar** | El centro de exportación: Vista previa con los ficheros que se escribirían, su tamaño y si alguno pisaría lo que ya está ahí; y **Generar**, que los escribe de verdad, en la misma carpeta que miró la vista previa. |
| **Estadísticas** | Cuántas peticiones hay, por método y por zona. |
| **Comprobar** | Compara la colección con el código: dice qué rutas le faltan y qué peticiones no están en el código. |
| **Validar** | Los invariantes de una colección Postman v2.1.0, con los errores separados de los avisos. |
| **Sincronizar** | Genera y escribe, o solo enseña lo que escribiría. |
| **Subir** | Sube la colección a Postman. La clave sale del almacén de la app y **no vuelve**: la respuesta dice qué pasó, no qué se usó. |

### Observar — lo que está pasando

| Sección | Qué hace |
|---|---|
| **En vivo** | La suscripción a cambios de las fuentes. |
| **Historial** | Los eventos de la sesión —la instantánea tomada y los ficheros que cambiaron debajo— y las **revisiones** del proyecto: cada exportación deja una en disco, y dos de ellas se pueden comparar. |
| **Diagnóstico** | Lo que el escaneo notó del proyecto: los avisos de la generación y los detectores que no pudieron leer un fichero. |

### El historial que sobrevive a la sesión

Cada exportación deja una **revisión** en disco
(`~/.tanit/history/<proyecto>/`, un fichero por revisión), con su hash
y con la configuración con la que se hizo. La carpeta se puede mover
con `TANIT_HISTORY_DIR`.

Eso permite tres cosas que antes no eran posibles:

- **Comparar** dos revisiones: qué operaciones aparecieron, cuáles
  desaparecieron, cuáles cambiaron y de qué manera se configuró cada
  una.
- **Exportar otra vez** una revisión anterior, tal y como estaba.
- **Restaurar** una revisión: su colección vuelve al proyecto.

La revisión sobrevive a la sesión que la creó, y también a la app: es
un fichero, no un estado en memoria.

El CLI **no** deja revisiones. Su `history` es el registro de
ejecuciones (`~/.tanit/history.jsonl`): dice qué se ejecutó, cuándo y
cómo acabó. Son dos cosas distintas, y el gate
`bun run lint:cli-app-parity` vigila que el mapa de paridad siga
diciendo la verdad.

### Preferencias

| Sección | Qué hace |
|---|---|
| **Ajustes** | Idioma, tema y preferencias. |

Abrir un proyecto **abre una sesión** en el backend: se escanea y
devuelve el resumen del que se dibuja la pantalla. Si la apertura
falla, la app queda **cerrada**, no medio abierta.

Y abrir un proyecto es lo que **pide los datos**: la lista de
endpoints, los servicios, el historial de la sesión y la vista previa
de la exportación se piden al backend en ese momento. Ninguna sección
se queda esperando a que alguien pulse un botón: una pantalla que
muestra "cero resultados" cuando el proyecto tiene endpoints es una
pantalla que miente.

### Cómo está escrita la app

Cada componente vive en **tres ficheros**: `<nombre>.component.ts` (la
lógica), `<nombre>.component.html` (la plantilla) y
`<nombre>.component.scss` (los estilos). El HTML dentro de un literal de
TypeScript no lo revisa nadie —ni el resaltador, ni el formateador— y
el CSS tampoco; por eso van en su fichero. El gate
`bun run lint:angular-components` lo comprueba.

Los tests de la app (`bun run test:app`) **compilan los componentes con
el compilador de Angular**, igual que el build. Sin eso los tests
montarían clases a pelo, sin plantillas: es la diferencia entre
comprobar la app y comprobar que los ficheros se importan.

### Los idiomas de la app

La app habla **inglés, español y francés**, y lo dice en el selector de
**Ajustes**. El idioma se cambia **al momento**: todas las pantallas
siguen al cambio, sin recargar, y el documento declara su `lang` para
que el navegador y el lector de pantalla sepan en qué está escrito.

Las palabras viven en catálogos (`packages/app/src/app/core/i18n/locales/`),
no en las plantillas: una palabra escrita entre etiquetas sale en
inglés aunque el idioma sea el español, y por eso el gate
`bun run lint:app-i18n` **no lo permite**. El gate comprueba, además,
que los tres catálogos tengan exactamente las mismas claves, que toda
clave pedida exista en todos ellos y que ninguna sobra.

Añadir un idioma es **dejar un fichero** en esa carpeta y volver a
pasar el gate: el catálogo se importa solo y la lista de idiomas sale
de los `BUNDLED_LOCALES` del producto.

> La app de escritorio (`apisrc ui`) y esta app son dos superficies
> distintas, con dos conjuntos de idiomas: la primera habla quince, la
> segunda tres. Un catálogo a medias es peor que ninguno, así que cada
> una habla los suyos enteros.

---

## Arrancar

```bash
apisrc ui
```

Se abre en tu navegador, en `localhost`. Escucha **solo en tu máquina**;
no es alcanzable desde la red. Para cerrarla: **Ctrl-C** en la terminal.

- `--port 5000` — usa ese puerto en vez de buscar uno libre.
- `--no-open` — no abre el navegador; imprime la URL y ya está.
- `--static-dir <ruta>` — sirve la **app compilada** de esa carpeta en
  vez de la interfaz que va dentro del binario.

La terminal indica si sirve Angular empaquetado, un build en disco o
la interfaz de respaldo. `--static-dir` selecciona un build en disco.

---

## La pantalla

### Carpeta del proyecto

La raíz, donde vive el manifiesto (`package.json`, `go.mod`,
`composer.json`…). **Ver lo detectado** enseña el framework reconocido,
cuántos endpoints hay, la base URL y si se detectó un login — antes de
generar nada.

### Formato de salida

Puedes marcar varios a la vez. **Postman va marcado por defecto.**

| Formato | Qué es | Lo importa Postman |
|---|---|---|
| `postman` | La colección de Postman | **Sí** (es su formato) |
| `openapi` | OpenAPI 3.1 en YAML | Sí (con matices; ver abajo) |
| `insomnia` | El formato de Insomnia | Sí (v4) |
| `har` | HTTP Archive | Sí (vía *Import* → *Raw text*) |
| `curl` | Líneas `curl` listas para terminal | Sí (vía *Import* → *Raw text*) |
| `bruno` | El formato de Bruno | **No** — es de otra aplicación |

La columna de la derecha es lo que dice la propia interfaz: los formatos
que Postman no reimporta van marcados **junto a su casilla**, no
enterrados en esta documentación. `bruno` genera sus ficheros igualmente
—es un formato legítimo— solo que para abrirlos ahí, en Bruno, no en
Postman.

#### El OpenAPI que emitimos y Postman

Emitimos `openapi: 3.1.0`. Comprobado con el parser que el propio
importador de Postman usa (`@apidevtools/swagger-parser`):

- El documento **parsea y valida** sin errores.
- El mismo documento, con la versión cambiada a `3.0.3`, **también
  valida**.

La colección **Postman** —que es lo que la mayoría necesita— se genera
siempre y no depende de esto. Si el importador de tu versión de Postman
se atragantara con el 3.1, el resultado visible es que el import de
`openapi` no produce nada ahí; el camino alternativo es importar esa
misma especificación con un conversor a 3.0 o regenerar y quedarse con
la colección nativa, que nunca falla.

### Framework

**Detectar automáticamente** es el valor por defecto, y acierta en la
gran mayoría de proyectos. El desplegable tiene su razón de ser, con la
lista que sale del catálogo de frameworks soportados:

- Monorepos con varias APIs: la detección puede elegir la primera que
  encuentra.
- Dependencias con alias o wrappers: el framework real no aparece donde
  la detección lo busca.

Al forzarlo, la lista viene del catálogo, el valor se valida antes de
generar (un valor inventado da error **con la lista válida**, sin
escribir nada a medias), y la generación usa el mismo camino que el CLI:
`--framework <id>`. No hay una segunda implementación.

### Carpeta de salida

Vacía por defecto: se escribe en `<proyecto>/tanit/`. Si
eliges otra carpeta —recoger varias colecciones en un sitio, por
ejemplo— se acepta, y el resultado te dice **la ruta exacta** donde
quedó la colección.

### Generar

Crea lo que hay marcado y enseña: dónde quedó la colección, cuántas
requests y carpetas salieron, los ficheros extra (environments, otros
formatos) y los avisos. Con la colección generada, sigue
[POSTMAN.md](POSTMAN.md) para importarla.

---

## Ajustes (la tuerca)

Arriba a la derecha, el icono de tuerca. Abre los ajustes **sin
recargar la página**: lo que hubieras escrito en el formulario sigue
ahí al volver, y el foco vuelve a la tuerca para quien navega con
teclado.

### Idioma

Quince idiomas, más los que dejes en la carpeta de idiomas de tu
usuario (van marcados con ★: ganan al que viene de fábrica con el mismo
código). El cambio se ve **al momento**, sin recargar, incluidos los
textos y el sentido de lectura para los idiomas de derecha a izquierda.

Si nunca has elegido, se usa el idioma de tu navegador; si no está entre
los disponibles, inglés.

### Tema

**Sigue al sistema**, claro u oscuro. Elegir claro u oscuro fija el tema
a mano y gana sobre lo que pida el sistema.

### Se guarda solo

No hay botón de guardar: **cada cambio se guarda al tocarlo**, en la
carpeta de configuración de tu usuario. Cierras y vuelves a abrir: tu
idioma y tu tema siguen ahí. Un fichero de ajustes dañado no impide
abrir la herramienta: se avisa en la pantalla y se usan los valores por
defecto.

En Linux la carpeta es `~/.config/tanit/`, en macOS
`~/Library/Application Support/tanit/` y en Windows
`%APPDATA%\tanit\`. Ahí también viven los idiomas: puedes editar
una traducción o añadir tu propio `<código>.json` y la interfaz lo
cargará en el próximo arranque.

---

## Preguntas cortas

**¿La interfaz puede usar mi API por la red?** Solo abre páginas en tu
navegador; las peticiones de red las hace el generador en tu máquina.

**¿Dónde está el botón de guardar de los ajustes?** No existe: se
guarda al tocar. Guardar sin querer es imposible; olvidar guardar
también.

**¿Por qué `bruno` aparece marcado distinto?** Porque Postman no lo
importa: es el formato de otra herramienta. Lo generamos igualmente
porque hay quien usa los dos productos.
