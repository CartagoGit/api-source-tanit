---
id: p00042
title: "p00042 — poder decirle de qué tipo es la API cuando no se autodetecta"
kind: feat
status: in-progress
type: proposal
track: export-to-postman
date: 2026-08-07
related:
    - p00024 # proyectos híbridos: varios detectores a la vez
    - p00029 # cada framework nuevo amplía lo autodetectable, pero nunca lo cubre todo
    - p00030 # el motor de AST reduce los falsos negativos, no los elimina
---

# p00042 — forzar el framework cuando la detección falla

## por qué

La autodetección va por manifiestos: `composer.json` con `laravel`,
`go.mod` con `gofiber`, `Cargo.toml` con `actix-web`. Funciona en la
inmensa mayoría de los casos, y cuando funciona no hay que decir nada.

Pero hay formas de proyecto donde **no puede** funcionar, y hoy la
herramienta se limita a decir que no encontró nada:

- Un **monorepo** donde el manifiesto está en la raíz y la API en
  `services/api/`, así que apuntando a la API no hay manifiesto.
- Una **dependencia con alias** o un fork con otro nombre de paquete.
- Un proyecto con el manifiesto **generado** en el build y ausente en el
  repositorio.
- Un framework que este proyecto reconoce mal por parecido con otro
  (pasó con Fastify, al que reclamaba el scanner de Express).

En todos, quien ejecuta la herramienta **sabe** de qué framework es su
API. No poder decírselo convierte un caso resoluble en un callejón sin
salida, y el mensaje actual —"ningún scanner ha reconocido el
proyecto"— suena a que la herramienta no lo soporta cuando sí lo hace.

## no-objetivos

- Sustituir la autodetección. Sigue siendo el camino por defecto y el
  que no hay que configurar.
- Inventarse rutas si el framework forzado tampoco encuentra nada. Si
  se fuerza `laravel` sobre un proyecto de Django, el resultado correcto
  es cero endpoints y un aviso claro, no ruido.

## slices

### S1 — `--framework <id>` en el CLI y en el pipeline
- **Estado**: done (2026-08-07)
- **Ficheros**: `projects/core/discovery/generation.pipeline.ts`,
  `projects/core/discovery/discovery.orchestrator.ts`,
  `projects/cli/commands/generate.script.ts`.
- **Gate**: un test que fuerza el framework sobre un proyecto sin
  manifiesto y obtiene sus endpoints.

- El orchestrator gana `forceFramework`: cuando viene, se salta la
  puntuación y usa ese scanner directamente.
- Un id que no existe falla **de inmediato** y lista los válidos. Fallar
  tarde con un id mal escrito es peor que no tener el flag.
- El aviso de "no se reconoció nada" pasa a sugerir `--framework`.

### S2 — el asistente interactivo lo ofrece
- **Ficheros**: `projects/ui/interactive.script.ts`.
- **Gate**: revisión manual del flujo.

Cuando el escaneo no detecta nada, en vez de rendirse ofrece la lista de
frameworks para elegir. Es donde más falta hace: quien usa el asistente
es justo quien no quiere memorizar flags.

### S3 — el plugin de mcp-vertex lo expone
- **Ficheros**: `projects/plugins/mcp-vertex_expostman/src/lib/tools/`.
- **Gate**: `bun run test:plugin`.

El tool `generate` acepta `framework` opcional. Un agente que recibe
"no se detectó nada" puede reintentar con el que le diga la persona.

## aceptación

- `expostman generate --project-root . --framework fastify` funciona en
  un proyecto **sin** `package.json`.
- Un id inválido falla al instante y lista los válidos.
- La lista de válidos sale del registro, no de una constante a mano.
- Sin el flag, nada cambia: mismos resultados que hoy.
