# Las herramientas que este proyecto necesita y la máquina puede no tener.
#
# Nace de un bloqueo concreto: `f00001` S4 pide empaquetar la interfaz
# con Tauri, y Tauri necesita Rust. Sin toolchain en la máquina, la
# alternativa era **commitear un scaffold sin compilarlo una sola vez**
# — que es exactamente lo que esta ronda ha demostrado que sale caro:
# tres comandos del CLI estaban rotos precisamente porque nadie los
# había ejecutado nunca.
#
# Un contenedor con las herramientas dentro convierte «no puedo
# verificarlo» en «lo verifico aquí».
#
# ## Por qué una sola imagen y no una por herramienta
#
# Porque el gate es uno: `bun run validate` necesita Bun, y empaquetar
# necesita Rust, y quien arregla un fallo de empaquetado suele tener que
# tocar TypeScript. Dos imágenes obligarían a saltar entre ellas para
# una sola tarea.
#
# ## Por qué las etapas
#
# `toolchain` trae todo y pesa; `runtime` solo lleva el binario ya
# compilado. Quien quiera probar el ejecutable en una máquina limpia
# —que es el escenario que `validate:package` comprueba— no necesita
# arrastrar 2 GB de compiladores.

# --- Etapa 1: las herramientas -----------------------------------------------
FROM debian:bookworm-slim AS toolchain

# `DEBIAN_FRONTEND` para que `apt` no se quede esperando una respuesta
# que nadie va a dar dentro de un build.
ENV DEBIAN_FRONTEND=noninteractive

# Lo que pide Tauri en Linux, y poco más. La lista sale de su
# documentación de requisitos: webkit para la ventana, `libssl` para las
# peticiones, `patchelf` y `libfuse2` para producir el AppImage.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      file \
      git \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      libssl-dev \
      libwebkit2gtk-4.1-dev \
      libfuse2 \
      patchelf \
      pkg-config \
      unzip \
      wget \
      xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# --- Bun ---------------------------------------------------------------------
# La versión se fija a propósito: un `latest` hace que el contenedor
# deje de reproducir el entorno del día que se construyó, que es la
# mitad del motivo de tener un contenedor.
ARG BUN_VERSION=1.3.14
ENV BUN_INSTALL=/usr/local/bun
ENV PATH=$BUN_INSTALL/bin:$PATH
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" \
    && bun --version

# --- Rust --------------------------------------------------------------------
ARG RUST_VERSION=1.83.0
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo
ENV PATH=$CARGO_HOME/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- \
      -y --no-modify-path --profile minimal --default-toolchain "${RUST_VERSION}" \
    && rustc --version && cargo --version

# --- Tauri CLI ---------------------------------------------------------------
# Se instala en la imagen y no en cada build: compilarlo tarda varios
# minutos y no cambia entre ejecuciones.
ARG TAURI_CLI_VERSION=2.1.0
RUN cargo install tauri-cli --version "^${TAURI_CLI_VERSION}" --locked \
    && cargo tauri --version

WORKDIR /work

# Sin `CMD` de producto: esta imagen es un taller, y quién hace qué lo
# dice `docker-compose.yml`. Una shell deja claro que entrar a mirar es
# un uso legítimo.
CMD ["bash"]

# --- Etapa 2: solo el binario ------------------------------------------------
# Para probar el ejecutable en una máquina **sin** Bun ni Node, que es
# la promesa que hace el README y lo que `validate:package` comprueba.
# Si el binario no fuera autocontenido, aquí no arrancaría.
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=toolchain /work/dist/expostman-linux-x64 /usr/local/bin/expostman

# Nada de Bun ni de Node aquí a propósito: si el binario los necesitara,
# este contenedor lo diría en el primer intento.
ENTRYPOINT ["expostman"]
CMD ["--help"]
