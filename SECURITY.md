# Seguridad — el modelo de amenazas y el canal de reporte

Este documento dice qué protege Tanit, de quién, con qué controles y
cómo se reporta un problema. No sustituye al [`docs/SBOM.md`](docs/SBOM.md)
ni al [`docs/RELEASE.md`](docs/RELEASE.md):aquí está el **modelo**, allí
están los **mecanismos**.

---

## 1. El modelo de amenazas

### 1.1. Los activos

| # | Activo | Por qué importa |
| --- | --- | --- |
| A1 | **Las claves de firma de la release** | Quien las tiene firma lo que publica. Con la clave de Apple firma instaladores que macOS da por buenos; con la de Microsoft, igual; con la de GPG, los checksums. |
| A2 | **La clave del updater** | Con ella se firman manifests que dicen "instala esto". Sin ella, el updater no instala nada — que es exactamente el diseño. |
| A3 | **Los artefactos publicados** | El `.dmg`, el `.msi`, el `.exe`, el `.deb`, el `.AppImage`. Son lo que el usuario ejecuta con privilegios de su cuenta. |
| A4 | **El sidecar `apisrc`** | El proceso que lee el proyecto del usuario. Ve el código fuente, las variables de entorno y todo lo que el usuario le pida escanear. |
| A5 | **El código fuente del proyecto del usuario** | El sidecar lo lee. No lo manda a ningún sitio —salvo que el usuario use una función que lo haga— pero está en la memoria del proceso. |
| A6 | **La configuración del host** | Los `.env`, los tokens y las credenciales que hay en el proyecto que se escanea. |
| A7 | **El keyring nativo del sistema** | La app guarda su llave de API en el keyring del sistema (`keyring`), no en un fichero. |
| A8 | **La cadena de publicación** | Quién puede publicar, desde dónde y con qué artefactos. |
| A9 | **La identidad del proyecto** | El nombre, la versión y el `serialNumber` del SBOM: lo que dice qué producto es. |

### 1.2. Los adversarios

| # | Adversario | Qué quiere | Cómo lo intenta |
| --- | --- | --- | --- |
| AD1 | **El atacante externo** | Entrar por la puerta de atrás en el equipo del usuario | Binario troyanizado, dependencia con código malicioso, exploit del WebView |
| AD2 | **El atacante de la cadena de suministro** | Cambiar lo que se publica | Dependency confusion, typosquatting, comprometer el registro de npm o de crates.io, publicar una versión manipulada de una dependencia |
| AD3 | **El atacante con acceso al CI** | Que la pipeline publique lo que él quiere | Inyectar un paso, robar los secretos del runner, reescribir el manifest |
| AD4 | **El atacante con acceso al repositorio** | Meter código malicioso en la siguiente release | Pull request, compromiso de una cuenta de colaborador |
| AD5 | **El intermediario** | Servir algo distinto de lo firmado | Servir otro binario, o un manifest del updater manipulado, o un `latest.json` viejo |
| AD6 | **El atacante local sin privilegios** | Leer lo que el usuario tiene | Sustituir el sidecar por otro, leer el proyecto del usuario, leer los tokens |
| AD7 | **El atacante con un proyecto malicioso** | Que Tanit ejecute algo al escanear | Un `package.json`, un `composer.json` o un `requirements.txt` con hooks que el scanner ejecuta |

### 1.3. Las fronteras de confianza

```
┌─ Frontera 0: el repositorio ──────────────────────────────────────────┐
│  El código y los lockfiles. Nadie fuera de aquí debería poder          │
│  cambiar lo que se empaqueta sin que se note.                         │
└───────────────────────────┬───────────────────────────────────────────┘
                            │  el pipeline build+sign+attest
┌─ Frontera 1: el CI ───────────────────────────────────────────────────┐
│  Los runners y los secretos. Un runner comprometido convierte un       │
│  secreto de firma en una firma de un atacante.                         │
└───────────────────────────┬───────────────────────────────────────────┘
                            │  artefactos firmados + SBOM + attestation
┌─ Frontera 2: el canal de publicación ─────────────────────────────────┐
│  Lo que se descarga. Aquí la identidad la dan las firmas y la           │
│  provenance; sin ellas, el canal sólo permite reenviar.                │
└───────────────────────────┬───────────────────────────────────────────┘
                            │  el manifiesto firmado del updater
┌─ Frontera 3: el endpoint del updater ──────────────────────────────────┐
│  HTTPS y un manifest firmado. El cliente no acepta HTTP.               │
└───────────────────────────┬───────────────────────────────────────────┘
                            │  el sidecar
┌─ Frontera 4: el proyecto del usuario ──────────────────────────────────┐
│  El código, los tokens y las credenciales. El sidecar los lee;         │
│  no los manda a ningún sitio, salvo que el usuario lo pida.            │
└────────────────────────────────────────────────────────────────────────┘
```

Cada frontera tiene un control, y cada control tiene un sitio donde
falla cerrado. Un control que deja pasar el caso raro es un control que
no existe.

---

## 2. Los controles, por capa

### 2.1. CI — la pipeline

| Control | Qué hace | Dónde falla |
| --- | --- | --- |
| **Credenciales auditadas antes de construir** | `prepare-artifacts.mjs --check-credentials` mira los **nombres** de las variables que faltan y para antes de producir un artefacto | Al principio del job |
| **Fallo cerrado en cada target** | Un artefacto sin firma, un target de la matriz que falta o un verificador que no acepta el artefacto → el job muere | Antes de subir nada |
| **Un manifest por staging** | El manifest se mide sobre el staging real y el verificador lo **recalcula** | `verify-signature.sh` |
| **Un gate que decide lo que se adjunta** | `publish-gate.mjs` es la única lista; el workflow no tiene globs propios | Antes de publicar |
| **Identidad, no bits** | La firma y el digest publicados describen exactamente los bytes adjuntos | En el manifest |

### 2.2. Credenciales de release

| Credencial | Dónde vive | Qué puede hacer quien la tenga |
| --- | --- | --- |
| `TANIT_SIGN_APPLE_IDENTITY`, `TANIT_SIGN_APPLE_TEAM_ID`, `TANIT_SIGN_NOTARY_PROFILE` | Secretos de GitHub | Firmar y notarizar instaladores de macOS |
| `TANIT_SIGN_WINDOWS_THUMBPRINT`, `TANIT_SIGN_WINDOWS_CERTIFICATE`, `TANIT_SIGN_WINDOWS_TIMESTAMP_URL` | Secretos de GitHub | Firmar instaladores de Windows con Authenticode |
| `TANIT_SIGN_GPG_KEY_ID`, `TANIT_SIGN_GPG_KEYRING`, `TANIT_SIGN_GPG_PASSPHRASE` | Secretos de GitHub | Firmar los checksums y los artefactos de Linux |
| `TANIT_UPDATER_KEY` | Secretos de GitHub | Firmar el manifest que el updater instala |
| `TANIT_ATTESTATION_KEY` | Secretos de GitHub | Firmar la provenance de la release |

- **Ninguna** está en el repositorio, ni en el log, ni en el staging.
- La clave privada del updater **nunca** entra en la app: la app lleva
  la **pública**, versionada en `packages/desktop/keys/`.
- Las claves privadas se piden **por ruta**, nunca por valor: un valor
  en la línea de órdenes lo ve cualquiera que pueda ver `ps`.
- La rotación es un acto explícito: una clave nueva, un identificador
  nuevo y las dos públicas conviviendo hasta que la vieja caduca.

### 2.3. Firma

- **macOS**: `codesign` con hardened runtime, entitlements **mínimos**
  (`allow-jit` y `allow-unsigned-executable-memory`, los dos que Tauri
  documenta), timestamp de Apple, notarización con `notarytool` y el
  ticket **grapado** dentro del artefacto. Una comprobación de
  Gatekeeper corre en el runner antes de publicar.
- **Windows**: Authenticode SHA-256 con certificado EV o Azure Trusted
  Signing, y timestamp RFC 3161 de un TSA.
- **Linux**: `SHA256SUMS` generado con `sha256sum` y firma detached GPG
  por artefacto y por el fichero de checksums. El keyring publicado
  acompaña a la release: sin él, la firma no se puede verificar.
- **La attestation**: Ed25519 sobre el PAE de DSSE, con la clave
  versionada. Es lo que ata la provenance al SBOM y a los artefactos.

### 2.4. El updater

- El manifest viaja **firmado** con Ed25519; la clave pública está en
  la app.
- El cliente aborta —con un mensaje visible y un evento de seguridad—
  si la firma no cuadra, si el hash no cuadra, si el `keyid` no es el
  esperado, si la versión no es más nueva, si la versión instalada está
  por debajo del mínimo soportado o si no hay destino para la
  plataforma.
- **No hay fallback**: sin firma no se instala, y no hay descarga por
  HTTP.
- El instalador candidato lleva un sidecar de la **misma versión**, y un
  smoke posterior comprueba handshake, scan y export.

### 2.5. El endpoint

- **Solo HTTPS**. El cliente aborta antes de pedir nada si la URL no es
  HTTPS.
- El manifest se puede pedir con reintentos y espera creciente, pero
  **el criterio de aceptación no cambia** al reintentar: un endpoint
  caído no fuerza una descarga sin firmar.
- La versión mínima soportada va **dentro** del manifest firmado: es
  parte de lo que la firma cubre, no un parámetro aparte.

### 2.6. El sidecar

- El sidecar (`apisrc`) es un proceso **local**. Lee el proyecto del
  usuario y no lo manda a ningún sitio.
- Se ejecuta como el usuario, sin privilegios: no tiene acceso al
  keyring del sistema ni a las credenciales de otro proceso.
- Los ficheros temporales que deja (el lock del estado, la copia del
  proyecto que se escanea) se escriben en el directorio temporal del
  sistema, no en el proyecto del usuario.
- El `--project-root` que se le pasa es el que el usuario ha elegido:
  el sidecar no sube por el árbol buscando un proyecto.

### 2.7. El usuario

- La app muestra **qué versión** tiene y si hay una más nueva.
- La instalación de una actualización es **explícita**: el usuario ve qué
  se va a instalar y de dónde.
- El keyring del sistema guarda la llave de API de Tanit. El usuario
  puede quitarla desde la propia app.
- Los logs del cliente **no** contienen tokens, ni rutas con secretos, ni
  el contenido de los ficheros escaneados.

---

## 3. Los riesgos aceptados

Un threat model que no dice lo que **no** va a arreglar es una lista de
wish. Estos son los riesgos que se aceptan, con el motivo:

| Riesgo | Por qué se acepta | Qué lo acota |
| --- | --- | --- |
| **El proyecto escaneado puede traer código ejecutable** (hooks de `npm`, `composer`, etc.) | El propósito de Tanit es leer proyectos de terceros; no se puede leer un `package.json` sin que exista la posibilidad de ejecutar sus hooks | El usuario ve qué directorio se escanea; el sidecar no auto-instala nada |
| **La app usa un WebView del sistema** | Es la base de Tauri; cambiarlo es reescribir la ventana | Se exige `allow-jit`: es el mínimo que WebKit necesita. Las vulnerabilidades del WebView son del sistema operativo, no de Tanit |
| **El binario no es reproducible bit a bit** | Dos compilaciones del mismo commit dan bytes distintos (fechas, ids) | La release es reproducible **en identidad**: la firma y el digest publicados describen los bytes exactos que se adjuntaron |
| **El SBOM no lleva la versión de las bibliotecas nativas** | La versión la pone el sistema operativo, no la release | La lista es explícita y `docs/SBOM.md` lo dice |
| **Una dependencia transitiva podría no aparecer en el grafo** | Las dependencias directas se comprueban contra las fuentes; las transitivas salen del lockfile | El lockfile es la fuente de verdad y se versiona; un cambio en él cambia el SBOM |
| **El almacén de secretos de GitHub es un punto de concentración** | Sustituirlo por una KMS propia es trabajo de plataforma, no de esta release | Las claves de la release son de alcance limitado; la del updater y la de attestation son independientes entre sí |
| **El runner de CI ve las claves durante el paso de firma** | Es inherente a firmar en CI | Las claves son de alcance limitado, la rotación es manual y auditada, y el keyring que se publica es el **público** |

---

## 4. Reportar un problema

### 4.1. El canal: privado y con hora

Las vulnerabilidades se reportan **en privado**, por el advisory
privado de GitHub:

**[github.com/CartagoGit/api-source-tanit/security/advisories/new](https://github.com/CartagoGit/api-source-tanit/security/advisories/new)**

Alternativamente, por correo a **`security@tanit.dev`**.

> **No abras un issue público** para un fallo de seguridad. Un issue
> público es un aviso para todo el mundo, y el que lo lee primero es el
> atacante.

### 4.2. Qué incluir

- Qué hace y qué no hace (el impacto real, no el teórico).
- Versión, sistema operativo y arquitectura.
- Pasos para reproducir.
- El hash del binario (`sha256sum`), si el fallo está en la release:
  con él se puede localizar el SBOM y la attestation exactos.
- Si el informe va de una dependencia, el `purl` que aparece en el SBOM.

### 4.3. El acuse y el plazo

| Gravedad | Acuse | Ventana de corrección | Aviso |
| --- | --- | --- | --- |
| **Crítica** (ejecución remota de código sin interacción, o committed release) | 24 horas | 7 días | Aviso simultáneo a la release corregida y al reporte |
| **Alta** (escalada de privilegios, o inyección de contenido) | 48 horas | 30 días | Aviso en la release corregida |
| **Media** | 5 días hábiles | 90 días | Aviso en las notas de la release |
| **Baja** | 10 días hábiles | próximo ciclo | Anotado en el changelog |

**Crítica** y **Alta** son las que tienen ventana de respuesta
**pública**: en cuanto hay una release corregida, se publica un aviso con
la descripción, el impacto, el hash de las versiones afectadas y el
crédito del que lo reportó — salvo que pida otra cosa.

Las **ventanas son máximos, no objetivos**: una corrección que necesita
más tiempo que la ventana sale igual, con una nota que explique por
qué. Lo que no se negocia es que **la ventana existe**: un informe sin
respuesta es un riesgo que sigue abierto.

### 4.4. Divulgación coordinada

1. Acuse y triaje.
2. Corrección y una release con el número de versión corregido.
3. Publicación del aviso.
4. Actualización de [`docs/SBOM.md`](docs/SBOM.md) y de este documento si
   el fallo era del modelo y no del código.

### 4.5. Las claves criptográficas de la release

Hay **tres** claves distintas, y confundirlas es como se acaba
verificando una cosa con la clave de otra. Cada una tiene su
identificador, y el identificador dice qué firma:

| Clave | Identificador | La privada | La pública | Qué firma |
| --- | --- | --- | --- | --- |
| **GPG de la release** | El `keyid` de la clave GPG (`TANIT_SIGN_GPG_KEY_ID`) y su huella | Secreto `TANIT_SIGN_GPG_KEYRING` | `tanit-release-keyring.gpg`, adjunto a cada release | Los `SHA256SUMS` de Linux y los artefactos de Linux |
| **Ed25519 del updater** | `tanit-updater-public-key-v1` | Secreto `TANIT_UPDATER_KEY` | `packages/desktop/keys/tanit-updater-public-key-v1.pem`, dentro de la app | El manifest que el updater instala |
| **Ed25519 de la attestation** | `tanit-release-attestation-v1` | Secreto `TANIT_ATTESTATION_KEY` | `packages/desktop/keys/tanit-release-attestation-v1.pub.pem`, versionada y adjunta a cada release | La provenance: el statement SLSA que dice de dónde vino la build |

- La clave GPG **no** firma las attestations, y la clave de attestation
  **no** firma los checksums. Cada una verifica lo suyo, y el
  `keyid` de cada attestation es el de la de attestation —no el de la
  GPG—.
- La clave de attestation es la única cuya **pública está versionada en
  el repositorio**: sin ella, la attestation que la release adjunta no
  la puede verificar un tercero, porque el secreto del CI no se publica.
  La CI falla cerrada si el secreto no corresponde a la pública
  versionada.
- Para cifrar el reporte o para verificar la firma de un comunicado se
  usa la **clave GPG de la release**: su huella está en el keyring
  público que acompaña a cada release. La clave **no** firma el reporte
  del usuario: el intercambio va cifrado o por el canal privado del
  advisory.
- La rotación de cada una es explícita: clave nueva, identificador
  nuevo y las dos públicas conviviendo hasta que la vieja caduca. El
  procedimiento está en [`docs/SBOM.md`](docs/SBOM.md), §La rotación de
  la clave de attestation.

---

## 5. Versiones soportadas

| Rama | Estado | Recibe correcciones de seguridad |
| --- | --- | --- |
| `1.0.x` (estable) | Soportada | **Sí** |
| `0.x` | Fin de vida | No |
| `main` / `develop` | Desarrollo | No — es código que todavía no es una release |

Las correcciones de seguridad se publican en la **rama estable** y se
retroportan a la rama estable anterior mientras siga dentro de la
ventana de soporte. La versión mínima que el updater todavía acepta
va **dentro** del manifest firmado, y sube con cada release: un
instalador demasiado viejo deja de poder actualizarse solo y el usuario
tiene que ir a por la release a mano.

---

## 6. Ver también

- [`docs/RELEASE.md`](docs/RELEASE.md) — la pipeline, las credenciales y
  los verificadores.
- [`docs/UPDATER.md`](docs/UPDATER.md) — el updater firmado.
- [`docs/SBOM.md`](docs/SBOM.md) — el SBOM, la provenance y cómo los
  revalida un auditor.
- [`docs/CI.md`](docs/CI.md) — los runners y los gates.
