---
id: p00023
title: "p00023 — ejemplo de Laravel y paridad real entre los 12 frameworks"
kind: fix
status: done
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00016 # el contrato de test que hace visible la paridad
---

> **Cerrada 2026-08-06.** `examples/example-laravel` creado (18 endpoints,
> 6 carpetas, login detectado) y `examples/README.md` con las dos tablas.
> El gate pasa de 11/11 a 12/12. La paridad se arregló en el sitio que
> importaba: `detectProjectName()` solo leía `composer.json`, así que
> Laravel se identificaba por su paquete y los otros once por su
> carpeta; ahora hay `project-name.service` con un manifiesto por
> ecosistema.


# p00023 — ejemplo de Laravel y paridad real entre los 12 frameworks

## Goal

Que Laravel sea **uno más** de los doce, sin trato especial ni por exceso
ni por defecto. Y auditar dónde más quedan restos de cuando el proyecto
era solo-Laravel.

## why

El proyecto nació como generador para Laravel y se amplió a doce
frameworks, pero quedan asimetrías en las dos direcciones.

**Por defecto** — `examples/` tiene un proyecto por framework… **menos
Laravel**:

```
example-aspnet  example-django  example-express  example-fastapi
example-flask   example-gin     example-nestjs   example-nextjs
example-openapi-headers  example-springboot  example-symfony
```

Once ejemplos, doce frameworks. Falta justo el original. Consecuencia
medible: `bun run validate:examples` valida 11 de 12, y Laravel es el
único cuyo pipeline completo no se ejercita en el gate.

**Por exceso** — restos de Laravel en sitios agnósticos:

| Sitio | Resto |
|---|---|
| `paths.service.ts` | `routesDir()`, `appDir()`, `requestsDir()` son rutas de Laravel en un servicio común, y los mensajes de error dicen "raíz del proyecto Laravel" |
| `project-context.service.ts` | `projectDirs()` arrastra las mismas tres |
| `endpoint-discovery.service.ts` | el camino "legacy zero-config" es una heurística de `routes/*.php` para cualquier proyecto sin match |
| `catalog-enricher.service.ts` | habla de FormRequests, que solo existen en Laravel |
| `generation.pipeline.ts` | llama a `detectLaravelTokenPath()` para todos los frameworks |
| `IGenerationMetrics` | los campos se llamaban `conFR`/`sinFR` (ya renombrados a `withValidation`) |

Ninguno rompe nada hoy —los scanners no-Laravel simplemente no los
usan—, pero hacen creer que el núcleo sabe de Laravel, y el siguiente
scanner que se añada copiará ese patrón.

## non-goals

- Quitar soporte de Laravel ni degradarlo. Es un framework de primera
  igual que los otros once.
- Reescribir el camino legacy zero-config. Sigue siendo útil como red
  cuando ningún scanner reconoce el proyecto; solo hay que dejar claro
  en su nombre y documentación que es una heurística de último recurso.

## slices

### S1 — `examples/example-laravel`
- **Files**: `examples/example-laravel/**` (nuevo).
- **Gate**: `bun run validate:examples` pasa a 12/12.

- Proyecto Laravel realista: `artisan`, `composer.json`, `routes/api.php`
  con `apiResource` y grupos, controladores y FormRequests.
- **Acceptance**: el gate valida 12 ejemplos y Laravel sale con sus
  bodies desde FormRequests.

### S2 — `examples/README.md`
- **Files**: `examples/README.md` (nuevo).
- **Gate**: revisión manual.

- Qué es cada ejemplo, qué demuestra, y cómo lanzarlo:
  `postman-from-routes generate --project-root examples/example-<x>`.
- **Acceptance**: la tabla cubre los 12 y dice qué construcción del
  framework ejercita cada uno.

### S3 — sacar lo específico de Laravel del núcleo
- **Files**: `project-context.service.ts`, `paths.service.ts`,
  `catalog-enricher.service.ts`, `generation.pipeline.ts`.
- **Gate**: `bun run validate`.

- `projectDirs()` deja de exponer `routes/app/requests` genéricos; esas
  rutas pasan al scanner de Laravel, que es quien las necesita.
- El enricher de FormRequests se invoca solo cuando el framework
  detectado es `laravel`, en lugar de para todos.
- `detectLaravelTokenPath` se invoca desde el scanner de Laravel, no
  desde el pipeline.
- Los mensajes de error dejan de decir "proyecto Laravel".
- **Acceptance**: `grep -rin "laravel" projects/core/` solo devuelve
  resultados dentro del scanner de Laravel y de sus tests.

### S4 — auditar el resto de asimetrías
- **Files**: los que salgan.
- **Gate**: `bun run validate`.

- Repasar `docs/`, `.github/agents.md`, `AGENTS.md` y las descripciones
  de los tools del plugin buscando "Laravel" donde debería decir
  "cualquier framework". El `describe` del plugin todavía dice "desde las
  rutas de cualquier proyecto Laravel".
- **Acceptance**: ninguna cadena de cara al usuario presenta el paquete
  como específico de Laravel.

## acceptance

- 12 ejemplos, uno por framework, todos en el gate.
- `examples/README.md` los explica.
- Fuera del scanner de Laravel y sus tests, el núcleo no menciona
  Laravel.
