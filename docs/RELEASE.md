# RELEASE — firmar, notarizar y verificar los instaladores

Cómo se publica Tanit de escritorio con **identidad**: cada instalador
que sale de una release dice quién lo firmó, con qué clave y con qué
digest, y hay un comando que lo vuelve a comprobar desde el fichero.

Esto no sustituye a [DESKTOP-PUBLISH.md](DESKTOP-PUBLISH.md), que explica
cómo se saca una versión. Aquí va lo que pasa **después** de compilar:
la firma, la notarización, la verificación y las credenciales que
hacen falta.

---

## La política, en dos frases

1. **Una release es reproducible en identidad, no bit a bit.** Dos
   compilaciones del mismo commit no dan el mismo instalador —cambian
   las fechas, el orden de enlazado, los identificadores comprimidos—,
   pero la **firma** y el **digest** que se publican describen
   exactamente los bytes que se adjuntaron. La identidad es lo que se
   reproduce; los bytes no.
2. **Ningún target sin firmar se publica.** Si falta una credencial,
   si un verificador no acepta el artefacto o si queda un fichero en el
   staging que el manifest no describe, la release no sale. Un
   artefacto sin firmar pegado a una release firmada es peor que no
   publicar.

---

## `release.sign`: la palanca que decide

La política vive en [delendai.config.json](../delendai.config.json), en
`release.sign`:

| `release.sign` | Qué pasa |
|---|---|
| `false` (por defecto) | Los instaladores se construyen y **no** se firman. El workflow sube los artefactos como artefactos de CI y **no publica nada**. Es el modo de desarrollo: no hace falta un certificado de Apple ni de Microsoft para compilar. |
| `true` | Los instaladores se firman, se notarizan y se verifican con la herramienta nativa de su plataforma. La publicación **falla cerrada** si falta una credencial, si un target no está firmado o si un verificador no acepta el artefacto. |

Con `release.sign=true`, el workflow **audita las credenciales antes de
construir**. Si falta una, el job muere ahí: no llega a existir un
artefacto sin firmar que alguien pueda subir por error.

```bash
# ¿Qué falta, si es que falta algo?
bun scripts/release/prepare-artifacts.mjs --check-credentials --os linux
```

La auditoría dice **qué variable falta**, nunca qué vale. Un log de CI es
un sitio público.

---

## La matriz

| Plataforma | Arquitectura | Formato | Cómo se firma |
|---|---|---|---|
| macOS | x64 | `.app` (comprimido) y `.dmg` | `codesign` con hardened runtime + `notarytool` + `stapler`; el `.dmg` se construye **después** de grapar |
| macOS | arm64 | `.app` (comprimido) y `.dmg` | ídem |
| Windows | x64 | `.msi` y `.exe` (NSIS) | Authenticode SHA-256 con timestamp RFC 3161 |
| Linux | x64 | `.deb` y `.AppImage` | `SHA256SUMS` + firmas detached GPG |

Cada instalador se construye **en su propia plataforma**: un `.dmg` no
sale de Linux, y un `.msi` no sale de macOS. No hay cross-build.

---

## Los secretos, por proveedor

Ninguno de estos valores está en el repositorio, y ninguno se imprime
en un log. Lo que el repositorio guarda es el **nombre** de cada
variable, que es lo que hay que auditar.

### Apple (macOS)

| Variable | Para qué |
|---|---|
| `TANIT_SIGN_APPLE_IDENTITY` | El Developer ID Application con el que se firma. |
| `TANIT_SIGN_APPLE_TEAM_ID` | El team id; va en el recibo de la firma. |
| `TANIT_SIGN_NOTARY_PROFILE` | El perfil del keychain con las credenciales de `notarytool`. |
| `TANIT_SIGN_ENTITLEMENTS` | Opcional: ruta al fichero de entitlements. Por defecto, `packages/desktop/entitlements/Tanit.entitlements.plist`. |
| `TANIT_SIGN_KEYCHAIN` | Opcional: el keychain donde está el certificado. |

El perfil de `notarytool` se guarda **una vez** al principio del job:

```bash
xcrun notarytool store-credentials "tanit-notary" \
  --apple-id "$APPLE_ID" --team-id "$TEAM_ID" --password "$APPLE_PASSWORD"
```

### Microsoft (Windows)

| Variable | Para qué |
|---|---|
| `TANIT_SIGN_WINDOWS_THUMBPRINT` | El thumbprint del certificado EV de Code Signing. |
| `TANIT_SIGN_WINDOWS_TIMESTAMP_URL` | La URL del TSA RFC 3161. |
| `TANIT_SIGN_WINDOWS_TRUSTED_SIGNING_ACCOUNT` | Opcional: la cuenta de Azure Trusted Signing, si se usa en vez de un certificado en el almacén. |
| `TANIT_SIGN_WINDOWS_CERTIFICATE` | Opcional: un `.pfx` para importar en el almacén del runner. |
| `TANIT_SIGN_WINDOWS_CERTIFICATE_PASSWORD` | La contraseña de ese `.pfx`. |

### GnuPG (Linux)

| Variable | Para qué |
|---|---|
| `TANIT_SIGN_GPG_KEY_ID` | El identificador (o la huella) de la clave que firma. |
| `TANIT_SIGN_GPG_KEYRING` | La ruta del **keyring público** que se publica con la release. |
| `TANIT_SIGN_GPG_PASSPHRASE` | Opcional: la contraseña de la clave, si la tiene. |

El keyring publicado contiene **sólo claves públicas**, y es lo que
verifica el que descarga. Sin él, una firma no se puede distinguir de
la de un atacante: por eso la verificación nunca usa el keyring de
quien verifica.

---

## Los comandos

### Medir

Escribe el manifest efímero a partir de lo que hay en el staging:

```bash
bun scripts/release/prepare-artifacts.mjs --stage <staging>
```

El manifest dice, por artefacto: versión semver, `os`, `arch`, bundle,
ruta relativa, SHA-256, firma, signer, key id y las referencias de SBOM
y provenance. Es efímero a propósito: se regenera en cada release y lo
verifica un script que **recalcula todo** desde los ficheros.

### Firmar

```bash
# macOS: primero la firma, después la notarización
bash scripts/release/sign-macos.sh <artefacto>...
bash scripts/release/notarize-macos.sh <artefacto>...

# Windows
pwsh scripts/release/sign-windows.ps1 <artefacto>...

# Linux: checksums, firmas detached y keyring publicado
bash scripts/release/sign-linux.sh --stage <staging> --os linux --arch x64
```

### El orden de macOS no es libre

El `.dmg` de macOS se construye **después** de grapar el bundle, y no
es un detalle de estilo:

1. `sign-macos.sh` firma el `.app` —hardened runtime, entitlements
   mínimos, timestamp seguro—.
2. `notarize-macos.sh` lo envía a `notarytool` con `--wait`, comprueba
   que Apple lo acepta, lo grapa y **comprime** el bundle ya grapado.
   Lo que se publica es ese `.app.zip`.
3. `package-dmg.sh` construye la imagen `.dmg` **con el bundle ya
   grapado dentro**.
4. `sign-macos.sh` firma la imagen.
5. `notarize-macos.sh` notariza y grapa la imagen.

El orden inverso no funciona: Tauri construye el `.app` y el `.dmg` en
el mismo paso, así que su `.dmg` lleva dentro un bundle **sin firmar**,
y Apple rechaza esa imagen —la notarización mira dentro del `.dmg`, y un
bundle sin firma dentro es código sin firma.

```bash
# 3. el `.dmg`, con el bundle grapado dentro
bash scripts/release/package-dmg.sh \
  --app <bundle.app> \
  --output <imagen.dmg>
```

> **Lo que este script no reproduce:** el `.dmg` que produce Tauri
> lleva un fondo y un icono propios. `package-dmg.sh` usa `hdiutil` y
> monta una imagen UDZO con el bundle y un enlace a `/Applications`, que
> es lo que el usuario hace al arrastrar, pero sin el fondo. Es una
> diferencia **estética**, no de confianza: el contenido y la firma son
> los mismos. Si el `.dmg` de Tauri hace falta, hay que construirlo
> con el bundle grapado dentro, no con el que sale de `cargo tauri
> build`.

### Verificar

```bash
bash scripts/release/verify-signature.sh \
  --manifest <staging>/release-manifest.json \
  --stage <staging> \
  --mode full
```

`--mode full` ejecuta además la comprobación **nativa** de cada
plataforma: Gatekeeper y `codesign` en macOS, Authenticode en Windows,
`gpg --verify` contra el keyring publicado en Linux. Si la herramienta
nativa no está, **falla**: una verificación que se salta su comprobación
por no tener la herramienta no es una verificación.

`--mode portable` recalcula digests, recibos y cobertura, y dice que la
comprobación nativa se ha saltado. Sirve para inspeccionar un staging
desde otra máquina; **no** para publicar.

Quién quiera comprobar un artefacto ya publicado, en su máquina:

```bash
# Linux: la firma va contra el keyring publicado
gpg --no-default-keyring --keyring tanit-release-keyring.gpg \
  --verify Tanit_0.2.0_x64.deb.sig Tanit_0.2.0_x64.deb

# Y los checksums
cd checksums && sha256sum -c SHA256SUMS

# macOS
codesign --verify --deep --strict --verbose=2 Tanit.app
spctl --assess --type install --verbose=2 Tanit.app
xcrun stapler validate Tanit.app

# Windows
signtool verify /pa /all /v Tanit_0.2.0_x64_en-US.msi
```

---

## Rotación de claves

La rotación **no** se hace sobre la marcha, y no se sobrescribe la clave
activa: una clave que cambia sin dejar rastro deja de poder verificar
las releases antiguas.

| Qué rota | Cuándo | Quién | Qué hay que rehacer |
|---|---|---|---|
| Certificado de Apple | Antes de que caduque, o si se sospecha que está comprometido | Quien administre la cuenta de Apple Developer | Re-notarizar y volver a firmar los instaladores que se sigan distribuyendo, y publicar el keyring nuevo. |
| Certificado de Microsoft (EV) | Antes de que caduque, o ante cualquier sospecha de exposición | Quien administre la cuenta de Azure | Volver a firmar el `.msi` y el `.exe` con el thumbprint nuevo. |
| Clave GPG de la release | Anualmente, o ante cualquier sospecha de exposición | Quien administre el keyring | Exportar la clave pública **nueva** al keyring publicado, volver a firmar los artefactos y publicar el keyring con **las dos** claves durante la ventana de soporte. |

Durante la ventana de rotación, el keyring publicado contiene **las dos**
claves: las releases antiguas siguen verificándose y las nuevas se
verifican con la nueva. La clave vieja se retira cuando ya nadie la
necesita.

Un certificado o una clave **expuestos** se revocan, no se rotan: y las
release firmadas con ellos dejan de ser de fiar. Eso hay que decirlo
en las notas de la release, no esconderlo.

---

## Troubleshooting

**«the credentials are incomplete»**
Falta una variable de las que el proveedor declara obligatorias. El
mensaje dice **cuál**. Se mira en los secretos del repositorio, no en
la máquina: los secretos llegan al job por `secrets.*`, no por el
entorno de quien lo lanza.

**«codesign could not verify what it just signed»**
La firma se ha aplicado y no se verifica. Suele ser el certificado
—vence, o no es el Developer ID—, o un binario de dentro del `.app`
que lleva otra firma. `codesign --verify --deep --strict --verbose=4`
dice cuál de los dos.

**«notarytool did not accept»**
Apple ha rechazado el artefacto. El estado viene en la salida de
`notarytool`: `Invalid` suele ser un binario de dentro sin firmar o sin
el hardened runtime; `Rejected` es un problema de la cuenta.

**«stapler could not staple»**
El ticket no llegó a graparse dentro del artefacto. Se comprueba con
`xcrun stapler validate`. Si el artefacto es un `.app`, hay que
**volver a comprimirlo** después de graparlo: el `.app.zip` que se
publica tiene que ser el que lleva el ticket dentro.

**«the detached signature does not verify against the published keyring»**
La firma no verifica contra el keyring publicado. O el keyring no
contiene la clave que firmó —se publicó el keyring equivocado—, o el
artefacto cambió después de firmarse. En los dos casos, **no** se
publica: se vuelve a firmar y se vuelve a medir.

**«hdiutil could not build the image»**
La imagen de macOS no se pudo construir. Suele ser un `.app` a medio
copiar: `package-dmg.sh` necesita el bundle **completo** y con los
permisos de ejecución intactos, porque `hdiutil -srcfolder` copia los
ficheros tal cual.

**«the staging holds a file the manifest does not describe»**
Sobró un fichero. Casi siempre es un artefacto de una corrida
anterior. Se borra del staging y se vuelve a medir: un fichero que no
está en el manifest no se puede publicar, porque nadie sabe si está
firmado.

**«the digest does not match the manifest»**
El artefacto cambió después de medirse. O se ha tocado a mano, o el
firmado no es el que se va a publicar. Se vuelve a firmar y a medir.

---

## Lo que este documento **no** cubre

- El **updater** firmado: es otra slice ([i00003 S3](delendai/proposals/in-progress/i00003-release-industrial-desktop-ci-por-plataforma-signing-notarization-secure-updater-firmado-sbom-cyclonedx-checksums-firmados.md)), y aquí no se toca.
- El **SBOM** CycloneDX y el *attestation* de provenance: otra slice también.
- Los **canales** (alpha, beta, estable), el *staged rollout* y el
  *downgrade*: el primer contrato es estable semver.
