---
id: p00043
title: "p00043 — `noUncheckedIndexedAccess` en todas las secciones"
kind: fix
status: done
type: proposal
track: export-to-postman
date: 2026-08-07
related:
    - p00027 # S4: el plugin no puede activar la regla mientras arrastre código del CLI
    - p00030 # el motor de AST reduce el parseo por índices, no lo elimina
---

# p00043 — `noUncheckedIndexedAccess` en todas las secciones

## por qué

`tsconfig.base.json` dice, literalmente:

> Ninguna sección las relaja: si algo no compila con esto, es que hay que
> arreglarlo, no que hay que bajar el listón para esa carpeta.

Y aun así falta la regla que más importa **en este proyecto en
concreto**: `noUncheckedIndexedAccess`. Sin ella, `array[i]` tipa como
`T` aunque el índice esté fuera de rango, y `match[1]` tipa como `string`
aunque el grupo no haya casado.

Este repo es, casi entero, código que indexa: diecinueve scanners que
recorren `matchAll`, parten por `split`, y leen `partes[2]`. Es
exactamente la forma de código donde el `undefined` que TypeScript está
ocultando llega en tiempo de ejecución. Ya ha pasado más de una vez, y
siempre con el mismo perfil: no revienta, devuelve algo raro.

Medido antes de tocar nada, activando el flag:

| Sección | Errores |
| --- | --: |
| core | 22 |
| frameworks | 22 |
| cli | 23 |
| e2e | 1 |

Son **24 sitios únicos** en 8 ficheros — las secciones comparten
ficheros, de ahí que los números se solapen. Diez de los veinticuatro
están en `form-request-parser.service.ts`, que es el parser más antiguo
del repo.

No son errores de tipos inventados: cada uno es un sitio donde el código
asume que un índice existe. La mayoría acierta en la práctica, pero
"acierta en la práctica" es justo lo que deja de ser verdad con una
entrada que nadie probó — y la entrada de un scanner es el código fuente
de otra persona.

## no-objetivos

- Silenciar con `!`. Un `array[i]!` compila y no arregla nada: le dice al
  compilador que se calle sobre lo único que estaba avisando. Solo se
  admite donde el índice esté acotado justo encima y se explique.
- Tocar `tests/fixtures`. Ya están excluidos: son código de otros
  proyectos.
- Activar la regla en el plugin. Eso es p00027 S4, y arrastra el problema
  aparte de que `@delendai/core` entra por `customConditions` y sus
  propios `noUnusedLocals` no son nuestros para arreglar.

## slices

### S1 — arreglar los 24 sitios
- **Estado**: done (2026-08-07)
- **Ficheros**: `packages/frameworks/laravel/form-request-parser.service.ts` (10),
  `packages/frameworks/scanners/django.scanner.ts` (3),
  `packages/core/discovery/project-loader.service.ts` (3),
  `packages/core/discovery/paths.service.ts` (2),
  `packages/core/domain/param-inferrer.service.ts`,
  `packages/core/domain/environment-builder.service.ts`,
  `packages/cli/commands/init.script.ts`,
  `packages/frameworks/scanners/aspnet.scanner.ts`,
  `packages/frameworks/scanners/springboot.scanner.ts`.
- **Gate**: `bunx tsc --noEmit -p tsconfig.<x>.json --noUncheckedIndexedAccess`
  a 0 en las cuatro secciones.

Cada sitio se mira: si el índice puede faltar de verdad, se maneja; si no
puede, se reestructura para que el compilador lo vea. El `!` es el último
recurso y va con su comentario.

### S2 — la regla, en la base
- **Estado**: done (2026-08-07)
- **Ficheros**: `tsconfig.base.json`.
- **Gate**: `bun run typecheck` verde en las 5 secciones.

Con S1 hecho, activar el flag no rompe nada y a partir de ahí el gate lo
sostiene. Va en la base y no sección a sección, que es el punto entero
del fichero.

## aceptación

- `noUncheckedIndexedAccess: true` en `tsconfig.base.json`.
- Las 5 secciones typechequean a 0.
- Los 1562 tests siguen pasando: esto es endurecer tipos, no cambiar
  comportamiento. Donde el arreglo **sí** cambie comportamiento (un
  `undefined` que antes se colaba), lleva su test.
- Ningún `!` nuevo sin un comentario que diga por qué el índice existe.
