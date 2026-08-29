---
id: p00034
title: "p00034 — inferencia inteligente de payloads: TypeScript DTOs, Pydantic, FormRequests, Zod, Joi, Marshmallow y JSON Schema"
kind: feat
status: done
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00024
    - p00030
---

> **Cerrada el 2026-08-07.** La tabla de "estado actual" que traía era
> optimista en un sentido y pesimista en otro: el parser de DTOs de
> NestJS no funcionaba **en absoluto** (marcado 🔴, pero por motivos
> distintos de los que decía), y varios "✅ Parcial" ya estaban
> completos. Todo lo de abajo sale de medir, no de leer el código.

# p00034 — inferencia inteligente de payloads

## lo que se midió

Cobertura de body en los 19 ejemplos, contando endpoints POST/PUT/PATCH
con un body no vacío:

| | endpoints con body |
| --- | --: |
| Antes | 64/74 (86%) |
| Después | **70/74 (95%)** |

Los **4 que quedan son endpoints de logout**, y no llevan body porque un
logout no recibe nada. O sea: 100% de los que deben tenerlo.

## los tres bugs de NestJS

Estaban a la vez y ninguno hacía ruido — el endpoint salía sin body, que
es indistinguible de "este endpoint no recibe nada".

**1. El regex de campo pedía dos puntos.** Era
`([a-zA-Z_][\w]*)\s*(?:!|:)\s*:` — o sea `field!:` o `field::`. Un
`name: string`, que es como se declara el 99% de los DTO, no casaba
nunca. El parser de DTOs de NestJS no sacaba **un solo campo**, ni de un
fichero importado ni de ningún sitio. El `?` de los opcionales tampoco
estaba contemplado.

**2. Una spec por decorador, en vez de una por campo.**
`@IsString() @MinLength(1) @MaxLength(100) name: string` producía **tres**
campos llamados `name`, cada uno con un trozo de la información y ninguno
con toda. Además `@IsOptional()` traía su propio `type` y podía pisar al
de `@IsInt()`.

**3. `@MinLength(1)` se leía como `min: 1`.** Los argumentos de
class-validator son posicionales; el parser buscaba una forma con nombre
que la librería no tiene y que ni siquiera es TypeScript válido. Las tres
—`@Length`, `@MinLength`, `@MaxLength`— salían siempre sin valor.

Y un cuarto, de resolución: el DTO solo se buscaba en los ficheros
**importados**. Una `class CreateUserDto` declarada en el mismo fichero
que el controlador —lo que enseña media documentación de Nest y lo que
hace cualquiera en un proyecto pequeño— no se encontraba.

## el bug del nombre, que salió de rebote

`deriveName` pasaba el `displayName` del scanner por `toPostmanUri`, que
le pega una barra delante a todo lo que no la lleve. Correcto para una
URI; para un nombre no. En Postman salía `/POST /orders` donde Next.js
había puesto `POST /orders`, y `/create_user` donde FastAPI ponía el
nombre de la función. Afectaba a los **seis** scanners que ponen
`displayName`, y no lo veía nadie porque una barra de más en un nombre no
rompe nada: solo afea.

Ahora la traducción de parámetros (`:id` → `{{id}}`) va aparte de la
normalización de rutas, porque un nombre necesita la primera y no la
segunda.

## los ejemplos que no ejercitaban lo que decían

`examples/README.md` afirmaba que `example-flask` cubría "Blueprints,
Marshmallow". No tenía **ni un esquema de Marshmallow**: los tres
endpoints de escritura hacían `request.get_json()` a pelo. Igual el de
Next.js, sin un zod. Los *fixtures* sí los cubren, así que los scanners
estaban probados — lo que no estaba probado es que `validate:examples`
los viera.

Se han añadido los esquemas que la documentación ya prometía. Los seis
endpoints sin body de flask y Next.js pasaron a tenerlo sin tocar los
scanners: no era un fallo de inferencia, era que no había nada que
inferir.

De paso, `example-nestjs` declaraba su endpoint de actualización con
`@Post(":id")`. Ahora es `@Put(":id")`, que es lo idiomático.

## slices

### S1 — motor de valores de ejemplo por tipo
- **Estado**: ya existía. `example-value.helper.ts` genera emails, uuids
  y fechas según el formato del campo. No hacía falta tocarlo.

### S2 — DTOs de TypeScript (NestJS)
- **Estado**: done (2026-08-07)
- **Ficheros**: `packages/frameworks/scanners/nestjs.scanner.ts`,
  `tests/frameworks/nestjs-dto.spec.ts` (nuevo, 8 tests).
- Los cuatro bugs de arriba. Un DTO da ahora sus campos con tipo,
  formato, obligatoriedad, cotas y enums, esté importado o en el mismo
  fichero.

### S3 — Pydantic v2 (FastAPI)
- **Estado**: ya funcionaba. `example-fastapi` da 5/5 bodies, con
  `Optional[T]`, `List[T]` y `Field(default=...)`.

### S4 — Bean Validation (Spring Boot) y Data Annotations (ASP.NET)
- **Estado**: ya funcionaban, pese al 🔴 de la tabla. Los dos ejemplos
  dan 3/3 bodies.

### S5 — reglas anidadas de Laravel
- **Estado**: no se hace ahora. `example-laravel` da 8/9 (el que falta es
  el logout). Las reglas tipo `'items.*.id'` no aparecen en ningún
  ejemplo ni fixture, así que no hay forma de comprobar que el arreglo
  arregla algo. Cuando haya un caso real, se abre con él delante.

## acceptance

- Cada POST/PUT/PATCH con esquema declarado incluye un body de ejemplo
  derivado del código fuente. ✔ 70/74; los 4 restantes son logouts.
- Los valores de ejemplo son semánticamente correctos. ✔
- `bun run validate` sin regresiones. ✔ 1591 tests, 19/19 ejemplos.
