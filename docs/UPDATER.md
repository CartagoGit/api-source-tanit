# El updater firmado

Cómo se actualiza Tanit Desktop y por qué se puede creer.

El updater no descarga: **decide si lo descargado se puede instalar**.
Todo lo que sigue describe qué se comprueba, en qué orden, y qué
pasa cuando algo no cuadra.

---

## 1. La cadena de confianza

```
  release (CI)                     endpoint (HTTPS)                app instalada
       │                                  │                              │
       │  scripts/release/                │                              │
       │   build-update-manifest.mjs      │                              │
       │        │                         │                              │
       │        ├─ firma el manifest ─────┼──► latest.json  +  .sig      │
       │        └─ firma cada instalador  │                              │
       │                                  │                              │
       │                                  ▼                              ▼
       │                        packages/desktop/src/updater.rs
       │                        (verifica firma, hash, versión y plataforma)
```

Tres implementaciones de las mismas reglas, con herramientas
distintas:

| Sitio | Qué hace | Con qué |
|---|---|---|
| [packages/desktop/src/updater.rs](../packages/desktop/src/updater.rs) | El cliente: decide y aborta | `ring` (Ed25519), `sha2` |
| [scripts/release/build-update-manifest.mjs](../scripts/release/build-update-manifest.mjs) | Construye y firma el manifest | `openssl` |
| [scripts/release/verify-update.sh](../scripts/release/verify-update.sh) | Verifica, sin el cliente | `openssl`, `jq` |

No es duplicación por descuido: es lo que hace que un error en una de
ellas no se esconda detrás de las otras dos, y lo que permite que un
auditor verifique una release **sin la app**.

El contrato compartido —los nombres de los campos, los códigos de
aborto y las constantes— vive en
[packages/contracts/interfaces/release/updater.interface.ts](../packages/contracts/interfaces/release/updater.interface.ts)
y en
[packages/contracts/constants/release/updater.constant.ts](../packages/contracts/constants/release/updater.constant.ts).
El test [tests/desktop/updater-contract.rs](../tests/desktop/updater-contract.rs)
compara el cliente con ese contrato, así que los tres no pueden
separarse sin que el test lo diga.

---

## 2. El contrato de inicialización

El updater se inicializa con un contrato **explícito**. No hay valores
implícitos escondidos en el cliente:

| Campo | Qué es | Por defecto |
|---|---|---|
| `endpoint` | De dónde se lee el manifest | `https://updates.tanit.dev/latest.json` |
| `publicKeyId` | Qué clave pública se espera | `tanit-updater-v1` |
| `publicKeyPath` | Dónde vive la clave versionada | `packages/desktop/keys/tanit-updater-public-key-v1.pem` |
| `currentVersion` | La versión instalada | la del paquete (`tauri.conf.json`) |
| `timeoutMs` | Tiempo máximo de una petición | `15000` |
| `retry` | Intentos, espera inicial, techo y multiplicador | `3`, `500 ms`, `4000 ms`, `2` |

El entorno puede **acotar** el comportamiento, nunca cambiarle la
política:

- `TANIT_UPDATE_ENDPOINT` — otro endpoint (siempre HTTPS: el cliente
  aborta antes de pedir nada si no lo es).
- `TANIT_UPDATE_TIMEOUT_MS` — otro tiempo máximo.
- `TANIT_UPDATE_MAX_ATTEMPTS` — otros intentos.

**La clave privada nunca entra en la app, ni en el repositorio, ni en
los logs de build.** En el repositorio solo está la clave pública, que
no da ningún poder: solo permite verificar.

---

## 3. El manifest

El manifest viaja por HTTPS y **viaja firmado**. Sin firma no hay
manifest.

```json
{
  "schema": "tanit.update.manifest/v1",
  "version": "0.2.0",
  "minimumSupportedVersion": "0.1.0",
  "generatedAt": "2026-10-29T00:00:00.000Z",
  "publicKeyId": "tanit-updater-v1",
  "signatureAlgorithm": "ed25519",
  "targets": [
    {
      "os": "linux",
      "arch": "x64",
      "bundle": "deb",
      "url": "https://updates.tanit.dev/releases/0.2.0/linux/x64/deb/Tanit_0.2.0_amd64.deb",
      "sha256": "…",
      "signature": "…",
      "size": 91523104
    }
  ],
  "provenance": {
    "source": "release-desktop",
    "workflow": "release-desktop.yml",
    "commit": "…",
    "builtAt": "2026-10-29T00:00:00.000Z"
  }
}
```

- La **firma** del manifest va **fuera** (`latest.json.sig`, en
  base64). Si fuera un campo dentro, el cliente tendría que parsear un
  documento que todavía no sabe si es de fiar para decidir si es de
  fiar.
- La **firma** de cada instalador va **dentro** del target: es la que
  acredita los bytes que se van a instalar.
- El **hash** y la **firma** van juntos: un hash sin firma dice "no ha
  cambiado", una firma sin hash dice "lo firmó alguien". Juntos dicen
  "lo firmó alguien y no ha cambiado".
- La **provenance** va dentro del manifest firmado, así que no es una
  nota: es parte de lo que la firma cubre.

### Quién produce el manifest

El manifest no lo escribe nadie a mano: lo escribe el pipeline de la
release, en el job `publish` de
[.github/workflows/release-desktop.yml](../.github/workflows/release-desktop.yml),
después de que los instaladores de las cuatro plataformas están
construidos, firmados y verificados:

1. La clave **privada** sale del secreto del CI (`TANIT_UPDATER_KEY`),
   se materializa en un fichero temporal con permisos `600` y se
   borra al terminar. Nunca está en el repo ni en los logs.
2. `scripts/release/build-update-manifest.mjs` recorre los artefactos
   que el manifest de la release ya describe, **recalcula** su SHA-256
   y su tamaño, firma cada instalador y firma el manifest. La base de
   las URLs es la de los assets de la release.
3. `scripts/release/verify-update.sh` verifica el manifest con la
   clave pública del repo, **sin** el cliente: si la clave del secreto
   no es la del repo, o si un artefacto no cuadra, el job **falla
   cerrado** y no se publica nada.
4. `latest.json` y `latest.json.sig` se adjuntan a la release, al
   lado de los instaladores.

El endpoint que el cliente lee (`https://updates.tanit.dev/latest.json`)
es un nombre de infraestructura que **todavía no existe**: publicarlo
es trabajo de quien monte el CDN que sirva esos adjuntos. Lo que sí
existe y está probado es el ciclo completo de firma y verificación.

---

## 4. Qué se comprueba y en qué orden

**Antes de descargar** (el manifest):

1. El endpoint es HTTPS. Sin HTTPS no se pide nada.
2. El manifest parsea y su `schema` es el esperado.
3. El manifest declara **la misma clave** que el contrato.
4. La **firma** del manifest verifica contra la clave pública.
5. La versión ofrecida es **posterior** a la instalada.
6. La app instalada todavía está soportada por el manifest.
7. Hay un destino para **esta plataforma**, y su URL es HTTPS.

**Después de descargar, antes de instalar** (el instalador):

8. El **hash** del instalador cuadra con el que dice el manifest.
9. La **firma** del instalador verifica.

Si algo falla, el updater **aborta**. No hay modo sin firma, no hay
descarga por HTTP y no hay "instalar igual y avisar después". El
aborto tiene tres cosas: un **código** estable, un **mensaje** que ve
la persona, y un evento de **seguridad** cuando el motivo es un
intento de sustitución.

### Los códigos de aborto

| Código | Qué pasó | ¿Evento de seguridad? |
|---|---|---|
| `update.endpoint.missing` | No hay endpoint configurado | no |
| `update.endpoint.not_https` | El endpoint o la URL del target no es HTTPS | no |
| `update.endpoint.unavailable` | El endpoint no respondió | no |
| `update.manifest.missing` | El manifest no llegó | no |
| `update.manifest.invalid` | El manifest no es válido o le faltan campos | no |
| `update.manifest.schema_mismatch` | El manifest es de otro esquema | no |
| `update.public_key.invalid` | La clave pública no es una clave Ed25519 usable | **sí** |
| `update.public_key.mismatch` | El manifest declara otra clave | **sí** |
| `update.signature.invalid` | La firma no verifica | **sí** |
| `update.version.not_newer` | La versión no es posterior | no |
| `update.version.below_minimum` | La app es más vieja de lo soportado | no |
| `update.target.unsupported` | No hay instalador para esta plataforma | no |
| `update.download.failed` | La descarga falló | no |
| `update.hash.mismatch` | El hash no cuadra | **sí** |
| `update.size.mismatch` | El tamaño no cuadra | **sí** |

#### Por qué `update.size.mismatch` es un evento de seguridad

El tamaño va **dentro** del manifest firmado, así que un tamaño que no
cuadra significa que los bytes descargados no son los que se
firmaron. Podría parecer que ensancha el conjunto de "intentos de
sustitución" —el mismo bytes alterado produce las dos cosas—, pero
sacarlo de ese conjunto sería un **descuento de la alarma que el
atacante controla**:

- `verify_artifact_hash` comprueba el tamaño **antes** que el hash. Si
  el tamaño no cuadra, el hash no llega a comprobarse.
- Si el desajuste de tamaño fuera "problema de operación", un atacante
  que **truncara** el instalador provocaría un aborted clasificado
  como operativo: la app seguiría funcionando, no habría evento de
  seguridad y el log de seguridad no tendría nada.
- Con los dos desajustes como evento de seguridad, el mismo truncamiento
  deja la misma huella que un instalador de otro tamaño.

La regla que se sigue: **la clasificación de un aborted no puede
depender de lo que hizo el atacante**. Por eso el tamaño y el hash son
los dos eventos de seguridad del instalador. La lista vive en
[updater.constant.ts](../packages/contracts/constants/release/updater.constant.ts)
(`UPDATE_SECURITY_EVENT_CODES`) y en
[`UpdateRejection::is_security_event`](../packages/desktop/src/updater.rs),
y
[tests/desktop/updater-contract.rs](../tests/desktop/updater-contract.rs)
fija que los dos lados dicen lo mismo.

### Quién llama al updater y quién ve el evento

Tres piezas, y las tres existen:

| Pieza | Qué hace | Dónde |
|---|---|---|
| La comprobación de arranque | Al arrancar, la app pregunta si hay actualización, en segundo plano y sin bloquear la ventana | [main.rs](../packages/desktop/src/main.rs) (`setup`) |
| El comando | El webview puede pedirla otra vez | `check_for_updates`, `download_update`, `update_status` |
| El consumidor del evento de seguridad | Escribe el evento en el log de la app | [update_log.rs](../packages/desktop/src/update_log.rs) |

La app emite dos eventos de Tauri:

- `tanit://update-status` — el resultado de la comprobación, lo que ve
  la interfaz.
- `tanit://update-security-event` — **solo** cuando el motivo es un
  intento de sustitución.

El evento de seguridad **no se queda en el evento**: se escribe en un
fichero, una línea por evento, en JSON, en el directorio de logs de la
app (`update-security.log`). El formato es JSON porque lo que se lee
después lo lee una máquina:

```json
{"timestamp":"2026-10-29T10:15:00Z","event":"update.security","code":"update.signature.invalid","message":"La firma del manifest de actualización no verifica. No se descarga ni se instala nada.","version":"0.1.0","endpoint":"https://updates.tanit.dev/latest.json"}
```

Lo que **no** hay todavía: una superficie en la interfaz Angular que
muestre el mensaje a la persona. El evento y el mensaje llegan al
webview, y el evento queda persistido en el log; pintarlo en la
ventana es trabajo de la app, no de esta pieza. Está anotado como
tal en la propuesta de la slice.

---

## 5. Rotación de claves

La clave pública está **versionada**: el identificador va en el nombre
del fichero (`tanit-updater-public-key-v1.pem`) y el manifest declara
con qué clave lo firmaron.

### Rotar

> **Lo que el código soporta hoy es una rotación *cortante*.** No hay
> modo compatible: el cliente tiene **una** clave y **un**
> identificador (`UpdaterContract.public_key_id` y
> `UpdaterContract.public_key_pem`), y aborta con
> `update.public_key.mismatch` en cuanto el manifest declara otro
> identificador. Lo que sigue es el procedimiento real, con el orden
> exacto; §5.1 explica por qué el corte es inevitable y cómo se
> minimiza.

1. Generar el par nuevo **fuera del repositorio**:
   ```bash
   openssl genpkey -algorithm ed25519 -out updater-v2.pem
   openssl pkey -in updater-v2.pem -pubout -out tanit-updater-public-key-v2.pem
   ```
2. Publicar la clave nueva en el repo como
   `packages/desktop/keys/tanit-updater-public-key-v2.pem`. Publicar
   la clave **no** cambia nada del cliente: sólo añade un fichero.
3. Meter la clave **privada** en el almacén de secretos del CI
   (`TANIT_UPDATER_KEY`). Nunca en el repositorio.
4. Cambiar el `publicKeyId` por defecto y el `publicKeyPath` en
   [updater.constant.ts](../packages/contracts/constants/release/updater.constant.ts)
   y en `packages/desktop/src/updater.rs`, y publicar una release de
   la app con ese cambio. **Esta release se descarga a mano**: el
   updater de la versión anterior sólo acepta manifests firmados con
   la clave vieja, y esta build nueva sólo acepta la nueva.
5. Esperar a que la flota esté en esa release (el canal automático
   sigue sirviendo el manifest de la clave vieja, y es el que la
   lleva hasta allí).
6. Publicar un manifest nuevo firmado con la clave **nueva** a partir
   de ese momento. Los clientes que aún no se han actualizado dejan de
   poder actualizarse solos y reciben `update.public_key.mismatch`.

La regla que no se puede saltar: **la clave activa no se sobrescribe
en silencio**. Cambiar el fichero de la clave sin cambiar el
identificador rompe las actualizaciones en curso sin que nadie lo
note.

### 5.1 Por qué el corte es inevitable

El manifest se firma con **una** clave y el cliente verifica con
**una** clave. En todo momento las dos tienen que ser la misma, o el
cliente aborta. De ahí sale la aritmética:

| Momento | Manifest firmado con | Cliente v1 | Cliente v2 |
|---|---|---|---|
| Antes de rotar | v1 | funciona | no existe |
| Release con la clave v2, manifest aún en v1 | v1 | funciona | **aborta** (`mismatch`) |
| Manifest en v2 | v2 | **aborta** (`mismatch`) | funciona |

La fila del medio es la que hace el corte inevitable: en algún
momento hay clientes con la clave vieja y clientes con la nueva, y
sólo uno de los dos grupos puede hablar con el canal. Aceptar
las dos claves a la vez —una lista de claves en el contrato, y que el
cliente pruebe con cada una— es lo que haría el cambio transparente,
y **no está implementado**: el contrato tiene un `publicKeyId` y un
`publicKeyPem`, no una lista.

El orden del §5 (publicar la clave, sacar la release con la clave
nueva, **esperar** a la migración, y sólo entonces cambiar el
manifest) es el que minimiza el corte: mientras el manifest siga en
la clave vieja, el grupo viejo sigue actualizándose; cuando cambia,
sólo se quedan sin canal los que no llegaron a la release nueva, y
esos se avisan o se atienden a mano.

> **Aviso de operación:** la clave pública `tanit-updater-v1` que hay
> hoy en el repositorio **no tiene mitad privada en ningún sitio**: la
> que se usó para generarla se destruyó. Con el estado actual del
> repositorio, el primer manifest publicable es el que se firme con
> una clave **nueva** — es decir, la primera rotación de la historia
> — o con la mitad privada de `v1`, que hay que provisionar en el
> almacén de secretos del CI. Ver §3 ("Quién produce el manifest").

### Si la clave se compromete

1. Publicar una clave nueva (v2) y actualizar el cliente.
2. Publicar un manifest nuevo firmado con la v2.
3. Revocar la v2 en cuanto toda la flota haya pasado a la v3.
4. Los manifests firmados con la clave compromised se rechazan a
   partir de ese momento: es exactamente el comportamiento que quiere
   un atacante que no tener.

---

## 6. Compatibilidad de manifests

- El `schema` (`tanit.update.manifest/v1`) cambia **cuando cambia la
  forma**. Un cliente que ve otro esquema aborta con
  `update.manifest.schema_mismatch`: no intenta entenderlo a medias.
- El `signatureAlgorithm` sólo admite `ed25519`. Si algún día se
  añade otro, se añade como valor nuevo y el cliente viejo aborta.
- `minimumSupportedVersion` es la **política del manifest**, no del
  cliente: dice desde qué versión el manifest todavía sabe hablar con
  los clientes. Si la app instalada es más vieja, el updater aborta
  con `update.version.below_minimum` y dice que hay que descargar la
  release a mano.
- Los campos nuevos se **añaden**; los viejos no se quitan dentro de
  un mismo esquema. Quitar un campo es un cambio de esquema.

---

## 7. Verificación independiente

Un auditor no necesita la app. Con `openssl` y `jq`:

```bash
# 1. La firma del manifest
base64 -d latest.json.sig > /tmp/manifest.sig
openssl pkeyutl -verify -pubin -inkey tanit-updater-public-key-v1.pem \
  -rawin -in latest.json -sigfile /tmp/manifest.sig

# 2. El hash del instalador
sha256sum Tanit_0.2.0_amd64.deb
# y comparar con el .sha256 del target del manifest

# 3. La firma del instalador
jq -r '.targets[] | select(.os=="linux" and .arch=="x64" and .bundle=="deb") | .signature' \
  latest.json | base64 -d > /tmp/artifact.sig
openssl pkeyutl -verify -pubin -inkey tanit-updater-public-key-v1.pem \
  -rawin -in Tanit_0.2.0_amd64.deb -sigfile /tmp/artifact.sig
```

O, con el verificador del repo, que hace lo mismo y además comprueba
la versión, la plataforma y que la URL sea HTTPS:

```bash
scripts/release/verify-update.sh \
  --manifest latest.json \
  --signature latest.json.sig \
  --public-key packages/desktop/keys/tanit-updater-public-key-v1.pem \
  --key-id tanit-updater-v1 \
  --platform linux/x64/deb \
  --current-version 0.1.0 \
  --stage <staging>
```

Sale con `0` si todo cuadra y con `1` si algo no cuadra, diciendo **qué**
no cuadró.

---

## 8. Rollback

### Qué significa aquí

El updater **no baja de versión**. Un manifest que ofrece una versión
anterior o igual se rechaza con `update.version.not_newer`, siempre y
de forma determinista. No hay un interruptor de "dejarme atrás": esa
decisión no está en el cliente, porque un cliente que puede volver
atrás es un cliente que un atacante puede usar para volver atrás.

### Si una release sale mal

Un rollback **de la release** se hace publicando otra release, con una
versión **mayor** y el contenido arreglado. El manifest nuevo es el
que se sirve, y los clientes que lo comprueban pasan a esa versión.

Procedimiento:

1. Corregir el problema y construir una release nueva con una
   versión mayor (`0.2.1`, por ejemplo). **No** se republica la misma
   versión: el manifest actual ya está firmado y publicado, y los
   clientes que lo han descargado no lo vuelto a leer.
2. Volver a firmar el manifest con la clave activa.
3. Verificar con `verify-update.sh` antes de publicar.
4. Publicar. Los clientes que comprueban actualizaciones verán la
   versión nueva.

### Si el manifest está mal

- **Firma inválida**: el cliente aborta y no instala nada. Publicar
  un manifest nuevo firmado correctamente; el malo se puede retirar
  del endpoint, pero no hace falta: el cliente ya lo rechaza.
- **Hash que no cuadra**: igual que arriba. Es además un evento de
  seguridad: hay que mirar **qué** se publicó.
- **Clave equivocada**: `update.public_key.mismatch`. O se publica con
  la clave que el cliente espera, o se actualiza el cliente (ver
  §5).

### Si el endpoint se cae

La app se queda con la versión instalada y lo dice. Los reintentos
(3 por defecto, con espera creciente) absorben un fallo pasajero; a
partir de ahí, el mensaje es "no se pudo contactar con el servidor de
actualizaciones" y se puede reintentar a mano. **Nunca** se descarga
sin firma para "ir mientras tanto".

---

## 9. Reproducirlo en local

Sin red, sin cuenta y sin claves privadas en el repositorio:

```bash
# El contrato del cliente, con fixtures locales
cargo test --test updater_contract --manifest-path packages/desktop/Cargo.toml

# El ciclo completo: construir, firmar y verificar
bunx vitest run --project cli tests/release/updater.spec.ts
```

La clave que usan las pruebas se genera en el propio test con
`openssl` y su mitad privada se borra con el directorio temporal. Lo
único versionado es la clave pública.

---

## 10. Lo que este documento no cubre

- **La instalación en sí**: el updater deja el instalador verificado en
  la carpeta de descargas. Que el sistema lo instale, y con qué
  permisos, es cosa del sistema operativo.
- **Los canales**: no hay alpha, ni beta, ni staged rollout. El
  contrato es stable semver.
- **La firma de la release**: la firma por plataforma (codesign,
  Authenticode, GPG) es de [i00003 S2](RELEASE.md) y es
  distinta de la firma del updater. Son dos capas: la del sistema
  operativo y la del canal de actualización.
- **La superficie de la interfaz**: el mensaje del aborted llega al
  webview y el evento de seguridad queda en el log, pero **no hay**
  todavía una pantalla en la app Angular que lo muestre a la persona.
  Ese consumidor es trabajo de la app, no de esta pieza.
- **La publicación del endpoint**: el nombre
  `https://updates.tanit.dev/latest.json` es el destino acordado;
  servirlo (el CDN, el `latest.json` y su `.sig` en la raíz) es
  infraestructura que todavía no está montada.
- **La clave privada de `tanit-updater-v1`**: no existe en ninguna
  parte (ver el aviso de §5). El pipeline está cableado y probado, pero
  el primer manifest real exige provisionar la clave en el almacén de
  secretos del CI o rotar la clave.
