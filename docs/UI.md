# La interfaz (`expostman ui`)

La herramienta sin terminal. Apuntas a la carpeta de tu API, ves lo que
se detecta antes de escribir nada, y generas la colección. Aquí está
todo lo que ofrece la pantalla.

Si aún no has instalado la herramienta: [INSTALL.md](INSTALL.md).

---

## Arrancar

```bash
expostman ui
```

Se abre en tu navegador, en `localhost`. Escucha **solo en tu máquina**;
no es alcanzable desde la red. Para cerrarla: **Ctrl-C** en la terminal.

- `--port 5000` — usa ese puerto en vez de buscar uno libre.
- `--no-open` — no abre el navegador; imprime la URL y ya está.

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

Vacía por defecto: se escribe en `<proyecto>/export-to-postman/`. Si
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

En Linux la carpeta es `~/.config/expostman/`, en macOS
`~/Library/Application Support/expostman/` y en Windows
`%APPDATA%\expostman\`. Ahí también viven los idiomas: puedes editar
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
