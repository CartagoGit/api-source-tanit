# Importar en Postman

De los ficheros generados a la primera respuesta 200. Cinco minutos, sin
saber nada de Postman.

Si aún no has generado nada: [INSTALL.md](INSTALL.md).

---

## Lo que vas a importar

`generate` deja esto en `build/`:

```
build/
├── mi-api.postman_collection.json          ← LA COLECCIÓN (los endpoints)
├── mi-api.local.postman_environment.json   ← ENVIRONMENT (baseUrl, credenciales, token)
├── mi-api.dev.postman_environment.json
├── mi-api.staging.postman_environment.json
└── mi-api.produccion.postman_environment.json
```

Son dos cosas distintas y **necesitas las dos**:

| | Qué es | Qué lleva |
|---|---|---|
| **Colección** | Los endpoints | Carpetas, requests, bodies, headers |
| **Environment** | Dónde y con qué credenciales | `baseUrl`, `authUsername`, `authPassword`, `token` |

La colección usa `{{baseUrl}}` y `{{token}}`. Sin el environment activo
esas variables no valen nada y **todas las requests fallan**. Es el error
número uno.

---

## Paso 1 — Importar

1. Abre Postman.
2. Botón **Import**, arriba a la izquierda, junto a *New*.
3. **Arrastra los dos ficheros a la vez**: el `.postman_collection.json`
   y el environment que vayas a usar (normalmente `.local.`).
   O pulsa **Choose files** y selecciónalos.
4. Postman muestra lo que va a importar: una *Collection* y un
   *Environment*. Pulsa **Import**.

```
┌─────────────────────────────────────────────┐
│  Import                                     │
│  ┌───────────────────────────────────────┐  │
│  │                                       │  │
│  │     Arrastra aquí los ficheros        │  │
│  │              — o —                    │  │
│  │          [ Choose files ]             │  │
│  │                                       │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  ✓ mi-api.postman_collection.json           │
│      Collection · 24 requests               │
│  ✓ mi-api.local.postman_environment.json    │
│      Environment · 5 variables              │
│                                             │
│                        [ Cancel ] [ Import ]│
└─────────────────────────────────────────────┘
```

La colección aparece en la barra lateral izquierda, pestaña
**Collections**.

---

## Paso 2 — Activar el environment

**Este es el paso que todo el mundo se salta.** Importar el environment
no lo activa.

Arriba a la derecha hay un desplegable que pone **No Environment**.
Ábrelo y elige el tuyo (`mi-api.local`).

```
                                    ┌──────────────────────┐
                    ┌───────────────┤  No Environment    ▾ │  ← pulsa aquí
                    │               └──────────────────────┘
                    ▼
        ┌────────────────────────┐
        │ ✓ mi-api.local         │  ← y elige este
        │   mi-api.dev           │
        │   mi-api.staging       │
        │   mi-api.produccion    │
        └────────────────────────┘
```

Para saber si está bien: abre cualquier request y pasa el ratón por
encima de `{{baseUrl}}` en la URL. Debe salir un tooltip con el valor
resuelto.

- **Naranja** con valor → correcto.
- **Rojo** → el environment no está activo, o esa variable no existe.

---

## Paso 3 — Autenticarte

Si tu API tiene login, la colección ya trae el flujo montado. **No hay
que copiar ningún token.**

### 3.1 Pon tus credenciales

Con el environment activo, pulsa el icono del **ojo** (👁) junto al
selector, y luego **Edit**. O ve a **Environments** en la barra lateral.

Verás:

| Variable | Type | Valor |
|---|---|---|
| `baseUrl` | default | `http://localhost:8000/api` |
| `authUsername` | **secret** | *(vacío)* |
| `authPassword` | **secret** | *(vacío)* |
| `token` | **secret** | *(vacío)* |

Rellena `authUsername` y `authPassword` con un usuario real de tu API.
Deja `token` vacío: se rellena solo.

> Van marcadas como **secret**, así que Postman no las incluye al
> exportar ni al compartir el environment.

Guarda con **Ctrl+S** (o **Cmd+S**).

### 3.2 Lanza el Login

Abre la carpeta **Auth** — es la primera de la colección, a propósito —
y lanza la request **Login** con **Send**.

Su body ya apunta a tus variables:

```json
{
  "email": "{{authUsername}}",
  "password": "{{authPassword}}"
}
```

### 3.3 Comprueba que el token se guardó

En el panel de respuesta, pestaña **Test Results**: debe salir en verde

```
PASS   Login devuelve un token
```

Vuelve al environment: `token` ya tiene valor.

**A partir de aquí no tienes que volver a hacer nada.** Todos los demás
endpoints heredan `Authorization: Bearer {{token}}` de la colección.

El token se guarda en el **environment**, no en variables de colección,
así que **sigue ahí cuando cierres y vuelvas a abrir Postman**.

Si tu API tiene endpoint de *refresh*, también captura el token nuevo. Si
tiene *logout*, lo limpia al ejecutarlo.

---

## Paso 4 — Lanzar cualquier endpoint

Abre una carpeta, elige una request, **Send**.

Los endpoints con parámetros en la ruta usan variables (`{{id}}`), que
vienen con un valor de ejemplo. Cámbialo en el environment, o directamente
en la URL de esa request.

Los `POST` y `PUT` traen un body de ejemplo derivado de las reglas de
validación reales de tu código, con los tipos y formatos correctos.
Edítalo antes de enviar.

---

## Regenerar sin duplicar

Cuando cambies endpoints en tu API:

```bash
postman-from-routes generate
```

Y vuelve a importar el `.postman_collection.json`. Postman detecta que ya
tiene esa colección —por su id, que es estable— y **la actualiza en
lugar de crear otra**.

> Si vienes de una versión anterior a esta corrección, puede que tengas
> varias copias de la misma colección. Bórralas todas menos una, o
> bórralas todas y vuelve a importar: desde ahora ya no se duplican.

Lo que **no** se pierde al reimportar: los valores de tu environment. Van
en otro fichero, y si no lo reimportas no se toca.

---

## Cuando algo falla

### `{{baseUrl}}` en rojo, o la URL sale literal

El environment no está activo. [Paso 2](#paso-2--activar-el-environment).

### `Could not send request` / `ECONNREFUSED`

Postman llegó a `{{baseUrl}}` pero no hay nadie escuchando. Comprueba que
tu API está levantada y que el `baseUrl` del environment apunta al puerto
correcto.

### 401 en todo, incluso después del login

Por orden:

1. ¿El **Login** dio 200? Si dio 401, las credenciales del environment
   son incorrectas.
2. ¿La pestaña **Test Results** del login está en verde? Si sale
   `No se encontró el token en la respuesta`, tu API lo devuelve en un
   camino que no está entre los que se prueban. El mensaje de error lista
   cuáles se intentaron; declara el tuyo con `tokenResponsePath` en el
   config y regenera.
3. ¿La variable `token` del environment tiene valor?
4. ¿Tu API espera `Bearer`, o un esquema distinto? La colección usa
   Bearer. Si usas otro, cámbialo en la pestaña **Authorization** de la
   colección (se hereda en todas las requests).

### 404 en endpoints que sí existen

Casi siempre es el prefijo. Mira la URL completa que Postman envía
(pestaña **Console**, abajo a la izquierda) y compárala con la real. Si
sobra o falta un `/api`, ajusta el `baseUrl` del environment.

### Faltan endpoints en la colección

No es un problema de Postman sino del escaneo. Ver
[FRAMEWORKS.md](FRAMEWORKS.md) y la sección de problemas de
[INSTALL.md](INSTALL.md#problemas-frecuentes).

### Quiero apuntar a producción

Importa `mi-api.produccion.postman_environment.json` y cámbialo en el
selector. La colección es la misma; solo cambia `baseUrl` y las
credenciales.

---

## Trabajar en equipo

- **Comparte la colección**, no el environment. El environment lleva
  credenciales.
- Cada persona importa el environment una vez y pone las suyas.
- Si versionáis el `.postman_collection.json` en el repo, los cambios de
  endpoints se ven en los diffs del PR. Su id es estable, así que el
  diff solo muestra lo que ha cambiado de verdad.
