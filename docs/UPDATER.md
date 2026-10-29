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

La app emite dos eventos de Tauri:

- `tanit://update-status` — el resultado de la comprobación, lo que ve
  la interfaz.
- `tanit://update-security-event` — **solo** cuando el motivo es un
  intento de sustitución. Es lo que deja rastro en el log aunque nadie
  esté mirando la ventana.

---

## 5. Rotación de claves

La clave pública está **versionada**: el identificador va en el nombre
del fichero (`tanit-updater-public-key-v1.pem`) y el manifest declara
con qué clave lo firmaron.

### Rotar

1. Generar el par nuevo **fuera del repositorio**:
   ```bash
   openssl genpkey -algorithm ed25519 -out updater-v2.pem
   openssl pkey -in updater-v2.pem -pubout -out tanit-updater-public-key-v2.pem
   ```
2. Publicar la clave nueva en el repo como
   `packages/desktop/keys/tanit-updater-public-key-v2.pem`.
3. Cambiar el `publicKeyId` por defecto y el `publicKeyPath` en
   [updater.constant.ts](../packages/contracts/constants/release/updater.constant.ts)
   y en `packages/desktop/src/updater.rs`.
4. Meter la clave **privada** en el almacén de secretos del CI
   (`TANIT_UPDATER_KEY`). Nunca en el repositorio.
5. Publicar un manifest nuevo firmado con la clave nueva.

### Qué pasa con los clientes viejos

Un cliente que sólo conoce la clave `v1` **rechaza** un manifest
firmado con la `v2`: es el `update.public_key.mismatch`, y es a
propósito. Eso significa que hay dos formas de rotar:

- **Rotación compatible**: se publican **las dos** claves y el
  manifest se firma con la nueva; los clientes antiguos siguen
  verificando con la vieja mientras siga publicada.
- **Rotación cortante**: se cambia la clave del cliente y se publica
  un manifest con la nueva. Los clientes que no se actualizan antes
  dejan de poder actualizarse solos, y hay que avisar (o publicar una
  versión mínima que fuerce la actualización manual).

La regla que no se puede saltar: **la clave activa no se sobrescribe
en silencio**. Cambiar el fichero de la clave sin cambiar el
identificador rompe las actualizaciones en curso sin que nadie lo
note.

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
