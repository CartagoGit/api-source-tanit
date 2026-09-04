---
id: p00019
title: "p00019 — documentación de instalación, uso e import en Postman"
kind: docs
status: done
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00010 # binario único
    - p00014 # identidad de colección
    - p00015 # flujo de login
---

> **Cerrada 2026-08-06.** Cuatro documentos escritos (README, INSTALL, FRAMEWORKS, POSTMAN) con todos los comandos ejecutados. Las capturas de Postman son diagramas ASCII: no se pueden hacer capturas reales en este entorno.

# p00019 — documentación de instalación, uso e import en Postman

## Goal

Que alguien que no conoce el proyecto pueda, en menos de cinco minutos:
instalarlo, generar la colección de **su** framework, importarla en
Postman y autenticarse.

## why

El README actual describe el paquete como "generador … a partir de las
rutas y FormRequests de un proyecto **Laravel**", igual que la
`description` del `package.json`. El paquete soporta **12 frameworks**.
Quien llegue buscando Express, Django o Spring Boot concluirá que no le
sirve.

Y falta lo esencial para usarlo:

- No hay instrucciones de instalación global (`bun add -g`) ni por
  proyecto (`devDependencies` + script en `package.json`).
- No hay una sola página que diga, por framework, qué comando ejecutar y
  qué espera encontrar el scanner en el árbol de ficheros.
- No hay **nada** sobre importar en Postman, que es el paso final y el
  que más fricción tiene para quien no usa Postman a diario.
- El flujo de autenticación no está documentado en ningún sitio.

## non-goals

- Traducir a inglés. La documentación del proyecto está en castellano y
  así se queda mientras el track sea interno.
- Documentar la API interna de los servicios. Eso es JSDoc en el código.

## slices

### S1 — README reescrito y honesto sobre el alcance
- **Files**: `README.md`, `package.json` (campo `description`).
- **Gate**: revisión manual.

- Titular: generador agnóstico de framework, con la tabla de los 12
  soportados y qué detecta en cada uno.
- Quickstart de tres comandos.
- **Acceptance**: la palabra "Laravel" no aparece como si fuera el único
  framework soportado.

### S2 — instalación y ejecución, por escenario
- **Files**: `docs/INSTALL.md` (nuevo).
- **Gate**: cada comando del documento se ejecuta y se verifica.

- Tres escenarios cubiertos de punta a punta:
  1. **Global** — `bun add -g @postman-exporter/cli`, luego
     `postman-from-routes generate` desde la raíz del proyecto.
  2. **Por proyecto** — dependencia de desarrollo y script
     `"postman": "postman-from-routes generate"` en el `package.json`
     del host. Incluye el equivalente para proyectos sin `package.json`
     (PHP, Python, Go, Java, .NET): invocación con `bunx` y
     `--project-root`.
  3. **Binario único** — descarga del ejecutable de p00010, sin runtime.
- Tabla de todas las flags y variables de entorno con su precedencia.
- **Acceptance**: los comandos están verificados, no inventados.

### S3 — guía por framework
- **Files**: `docs/FRAMEWORKS.md` (nuevo).
- **Gate**: un bloque por framework, contrastado con su fixture.

- Para cada uno de los 12: qué ficheros busca el scanner, qué sintaxis de
  rutas entiende, de dónde saca los bodies, y las limitaciones conocidas.
- Cada bloque enlaza a su ejemplo en `examples/`.
- **Acceptance**: lo documentado coincide con lo que el scanner hace de
  verdad, verificado contra los fixtures.

### S4 — guía de import en Postman, con capturas
- **Files**: `docs/POSTMAN.md` (nuevo), `docs/img/*.png` (nuevo).
- **Gate**: revisión manual siguiendo los pasos en una instalación limpia.

- Paso a paso con captura en cada punto: Import → Files → seleccionar el
  `.postman_collection.json` → seleccionar el `.postman_environment.json`
  → activar el environment en el selector superior derecho.
- Sección de autenticación: rellenar `authUsername`/`authPassword`,
  lanzar Login, comprobar que `token` se ha poblado (p00015).
- Sección de re-import: qué pasa al regenerar y por qué la colección se
  actualiza en lugar de duplicarse (p00014).
- Solución de problemas: variable sin resolver, environment no
  seleccionado, `{{baseUrl}}` vacío, 401 tras el login.
- **Acceptance**: alguien que no ha usado Postman llega al primer 200
  siguiendo solo este documento.

## acceptance

- Los cuatro documentos existen y están enlazados desde el README.
- Todos los comandos citados se han ejecutado.
- La guía de Postman cubre import, environment, auth y re-import.
