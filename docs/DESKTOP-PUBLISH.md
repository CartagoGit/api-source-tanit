# Publicar la aplicación de escritorio

Cómo sacar una versión de los instaladores y dejarlos donde alguien
pueda descargarlos.

---

## Lo primero: los tres salen de CI, no de tu máquina

No es una preferencia. **Un `.dmg` no se construye desde Linux, ni un
`.msi` desde macOS**: cada instalador exige el SDK de su sistema y su
firma, y Tauri enlaza contra las librerías nativas de la máquina donde
compila.

`.github/workflows/release-desktop.yml` lo resuelve con una matriz de
tres corredores:

| Plataforma | Corredor | Produce |
|---|---|---|
| Linux | `ubuntu-latest` | `.deb`, `.AppImage` |
| macOS | `macos-latest` | `.dmg`, `.app` |
| Windows | `windows-latest` | `.msi`, `.exe` |

Va con `fail-fast: false` a propósito: si Windows falla, los otros dos
tienen que llegar igual. Un fallo de una plataforma no es motivo para
quedarse sin las otras.

---

## Sacar una versión

### 1. Subir el número en los dos sitios

```bash
# package.json  →  "version"
# packages/desktop/tauri.conf.json  →  "version"
```

Tienen que coincidir. El de `package.json` va al paquete npm y al `--help`
del CLI; el de `tauri.conf.json` va al nombre del instalador y a lo que
enseña el sistema en «Programas instalados».

### 2. Comprobar que el gate pasa entero

```bash
bun run validate
```

No es opcional. El instalador **contiene** el binario del CLI, así que
publicar con el gate en rojo es meter el fallo dentro de algo que la
gente instala en su equipo.

### 3. Etiquetar

```bash
git tag v0.2.0
git push origin v0.2.0
```

El workflow se dispara con el tag y adjunta los instaladores a la
release de GitHub.

### 4. Comprobar lo que ha salido

Descarga al menos uno e instálalo de verdad. Un `.deb` de 2 KB es un
`.deb` vacío, y desde la página de releases se ve exactamente igual que
uno bueno.

---

## Firmar, y por qué todavía no

Sin firmar, los instaladores funcionan pero avisan:

- **macOS**: Gatekeeper dice que «no se puede comprobar que no contenga
  malware». Se abre con «Abrir de todos modos».
- **Windows**: SmartScreen dice «editor desconocido». Se ejecuta con
  «Más información → Ejecutar de todas formas».

Quitarlo cuesta dinero y trámite:

| Plataforma | Qué hace falta |
|---|---|
| macOS | Cuenta Apple Developer (99 $/año) + notarización con `notarytool` |
| Windows | Certificado Authenticode de una CA (~200-400 $/año) |

Cuando los haya, van como secretos del repositorio
(`APPLE_CERTIFICATE`, `APPLE_ID`, `WINDOWS_CERTIFICATE`) y Tauri los usa
solo. Hasta entonces, **lo honesto es documentar el aviso**, que es lo
que hace [DESKTOP-INSTALL.md](DESKTOP-INSTALL.md), en vez de dejar que
parezca que la aplicación está rota.

---

## Publicar el CLI en npm

Aparte de la aplicación, el paquete se publica solo:

```bash
bun run validate:package   # npm pack + instalación limpia + smoke
npm publish --access public
```

`validate:package` no es ceremonia: instala el tarball en un directorio
temporal **sin Bun ni Node en el PATH del destino**, enlaza el binario y
genera una colección. Es lo que comprueba la promesa del README —«no
necesitan Bun ni Node instalados»— antes de que la compruebe alguien que
se lo descarga.

---

## Cuando algo falla

**El workflow produce un instalador vacío.** Casi siempre es que el
sidecar no llegó: Tauri busca `binaries/expostman-<target-triple>` y sin
ese sufijo falla con un «no such file» que apunta a una ruta que sí
existe. `desktop:build` lo compila y lo coloca en el mismo paso
justamente por eso.

**El `.AppImage` no sale en el contenedor.** Es esperado: lo monta
`linuxdeploy` con FUSE, y dentro de un contenedor no arranca ni dándole
`/dev/fuse`, `SYS_ADMIN` y AppArmor abierto — se probó. En un corredor
de CI sí sale. Por eso `docker:installers` pide solo `deb`.

**Rust se queja de `edition2024` o de una versión mínima.** El árbol de
dependencias de Tauri la sube cada pocos meses y el error aparece como
un fallo de una dependencia transitiva, sin mencionar a Tauri. La
versión está fijada en `.docker/Dockerfile` con el historial de por qué
se subió cada vez.
