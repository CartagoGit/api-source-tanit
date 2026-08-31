# Instalar la aplicación de escritorio

Export to Postman se puede usar de tres formas, y esta página cubre la
tercera:

1. **Como CLI**, si ya tienes Bun o Node — ver [INSTALL.md](INSTALL.md).
2. **Como binario suelto**, sin runtime — `bun run build:binary`.
3. **Como aplicación de escritorio**, con su ventana y su icono. Aquí.

La aplicación es la misma interfaz web que levanta `expostman ui`,
metida en una ventana nativa. Dentro lleva el binario del CLI, así que
**no necesitas Bun ni Node instalados**.

---

## Linux

Salen dos formatos y cubren cosas distintas.

### `.deb` — Debian, Ubuntu, Mint, Pop!\_OS…

```bash
sudo apt install ./export-to-postman_0.1.0_amd64.deb
```

Se integra con el gestor de paquetes: aparece en el menú de
aplicaciones, y `sudo apt remove export-to-postman` lo quita entero.

Necesita las librerías de WebKit del sistema. En una instalación de
escritorio normal ya están; si no:

```bash
sudo apt install libwebkit2gtk-4.1-0 libayatana-appindicator3-1
```

### `.AppImage` — cualquier distribución

```bash
chmod +x Export-to-Postman_0.1.0_amd64.AppImage
./Export-to-Postman_0.1.0_amd64.AppImage
```

No se instala: es un fichero que se ejecuta. Útil en Fedora, Arch,
openSUSE o donde no haya `.deb`, y para probarlo sin tocar el sistema.

> **Necesita FUSE.** Si arranca y no pasa nada, prueba
> `sudo apt install libfuse2`. Sin FUSE, un AppImage no puede montarse
> a sí mismo y falla en silencio.

---

## macOS

### `.dmg`

Ábrelo y arrastra la aplicación a `Aplicaciones`. Nada más.

> **La primera vez macOS lo bloqueará.** No está firmada con un
> certificado de Apple Developer, así que Gatekeeper dirá que «no se
> puede comprobar que no contenga malware». Es lo esperado, no un
> síntoma:
>
> ```
> Ajustes del Sistema → Privacidad y seguridad → «Abrir de todos modos»
> ```
>
> O, desde la terminal:
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/Export\ to\ Postman.app
> ```
>
> Firmarla requiere una cuenta de pago de Apple Developer. Mientras no
> la haya, este paso es inevitable y **es mejor decirlo que dejar que
> parezca que la aplicación está rota**.

---

## Windows

### `.msi` — instalación normal

Doble clic. Instala en `Archivos de programa` y añade la entrada al menú
de inicio.

### `.exe` (NSIS) — instalador con opciones

Lo mismo, pero deja elegir carpeta y si crear acceso directo. Útil para
instalar sin permisos de administrador.

> **SmartScreen avisará** de que es de «un editor desconocido», por lo
> mismo que en macOS: no está firmada con un certificado de Authenticode.
> «Más información» → «Ejecutar de todas formas».

---

## Comprobar que funciona

Abre la aplicación. Deberías ver la interfaz con un campo para la carpeta
del proyecto.

1. Pega la ruta absoluta de cualquier API tuya.
2. Pulsa **Inspeccionar**: no escribe nada, solo dice qué ha detectado.
3. Si el framework y el número de endpoints cuadran, pulsa **Generar**.

La colección aparece en `<tu-proyecto>/export-to-postman/`.

Si «Inspeccionar» no reconoce el framework, mira
[FRAMEWORKS.md](FRAMEWORKS.md) para ver qué busca cada scanner: casi
siempre es que la ruta apunta a una subcarpeta y no a la raíz del
proyecto.

---

## Construirla tú

Necesitas Rust y las dependencias de Tauri. Si no las tienes, el
contenedor las trae:

```bash
bun run docker:installers      # produce el .deb sin instalar nada
```

En una máquina con Rust:

```bash
bun run desktop:build:linux    # .deb + .AppImage
bun run desktop:build:mac      # .dmg + .app
bun run desktop:build:windows  # .msi + .exe
```

**Cada plataforma solo puede construir la suya.** No es una limitación
del script: cada instalador exige el SDK de su sistema y su firma, y
Tauri enlaza contra las librerías nativas de la máquina. Pedir otra
falla con el motivo escrito en vez de producir algo que no arranca.

Los tres a la vez salen de CI — ver [DESKTOP-PUBLISH.md](DESKTOP-PUBLISH.md).

La aplicación de escritorio es autónoma: su build no necesita levantar el
host MCP de desarrollo. El checkout local del host solo se usa para las
herramientas MCP durante el desarrollo del repositorio.
