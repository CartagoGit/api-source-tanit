//! Bridge IPC entre el webview de Tauri y el sidecar `apisrc serve --stdio`.
//!
//! El sidecar habla JSON-RPC 2.0 newline-delimited sobre stdin/stdout
//! (`packages/core/transport/stdio-bridge.server.ts`); este módulo
//! es el único punto que conoce ese contrato en código nativo.
//!
//! ## Sentidos del tráfico
//!
//! - **Webview → sidecar**: el front-end llama
//!   `invoke('send_to_sidecar', { frame })`; el comando expuesto
//!   aquí serializa la línea y la escribe en `stdin` del sidecar.
//! - **Sidecar → webview**: un hilo propio lee `stdout` línea a
//!   línea y, por cada línea no vacía, emite un evento Tauri
//!   `EVENT_TO_WEBVIEW` con la línea como payload. El front-end
//!   escucha ese evento y parsea la respuesta JSON-RPC.
//!
//! ## Por qué String y no JSON
//!
//! El bridge no sabe nada de JSON-RPC: es un *transporte opaco*.
//! La capa de aplicación (`application-api/handlers.ts`) y el
//! parser (`json-rpc-protocol.ts`) viven en el sidecar y en el
//! webview. Rust solo mueve bytes. Esto mantiene el módulo por
//! debajo de 100 LOC y permite que cualquier cambio en el
//! protocolo se haga sin recompilar el binario nativo.
//!
//! ## Cancelación
//!
//! El webview manda un `$/cancelRequest` como cualquier otra línea
//! JSON-RPC; el sidecar lo despacha por su tabla de in-flight. Este
//! módulo no necesita estado propio de cancelación — el bridge solo
//! mueve líneas.

use std::io::{BufRead, BufReader, Write};
use std::process::ChildStdout;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, State};

use crate::sidecar::SidecarPipes;

/// Nombre del evento Tauri que el webview escucha para recibir
/// respuestas del sidecar.
pub const EVENT_TO_WEBVIEW: &str = "tanit://ipc-message";

/// Nombre del comando Tauri que el webview invoca para enviar
/// mensajes al sidecar.
///
/// Marcado `allow(dead_code)` porque el webview usa el nombre en
/// `invoke('send_to_sidecar', ...)` por su string literal — no se
/// referencia desde Rust. Sigue siendo contrato público y se testea.
#[allow(dead_code)]
pub const COMMAND_FROM_WEBVIEW: &str = "send_to_sidecar";

/// Estado IPC compartido entre el comando `send_to_sidecar` y el
/// bucle de lectura en `spawn`.
///
/// `Mutex<BufWriter<...>>` por dos motivos:
/// - el `Write` trait necesita `&mut self`, y `&self` es lo que el
///   comando Tauri recibe;
/// - `BufWriter` agrupa las escrituras para no pagar una syscall
///   por línea en respuestas rápidas.
pub struct Bridge {
    stdin: Arc<Mutex<std::io::BufWriter<std::process::ChildStdin>>>,
}

impl Bridge {
    /// Construye el bridge y arranca el hilo que bombea stdout del
    /// sidecar al webview.
    ///
    /// El `AppHandle` se clona (es `Arc`-internamente), así que
    /// `emit` desde el hilo es seguro.
    pub fn spawn(app: AppHandle, pipes: SidecarPipes) -> Self {
        let stdin = Arc::new(Mutex::new(std::io::BufWriter::new(pipes.stdin)));
        let app_for_reader = app.clone();
        let stdout = pipes.stdout;

        // Hilo dedicado al pump de stdout. No expone JoinHandle:
        // termina cuando el sidecar cierra stdout (al morir).
        let _ = std::thread::Builder::new()
            .name("sidecar-stdout-pump".into())
            .spawn(move || pump_stdout(app_for_reader, stdout));

        Self { stdin }
    }

    /// Envía una línea JSON-RPC al sidecar.
    ///
    /// El `Mutex` devuelve error solo si el sidecar ya cerró el
    /// pipe — en ese caso el bridge está muerto y la siguiente
    /// operación va a fallar de la misma forma. Reportamos el
    /// mensaje al webview para que el front-end pueda mostrar
    /// "conexión perdida".
    pub fn send(&self, frame: &str) -> Result<(), String> {
        let mut guard = self
            .stdin
            .lock()
            .map_err(|_| "el bridge está en estado de pánico".to_string())?;
        guard
            .write_all(frame.as_bytes())
            .map_err(|e| format!("no se pudo escribir al sidecar: {e}"))?;
        guard
            .write_all(b"\n")
            .map_err(|e| format!("no se pudo escribir el newline: {e}"))?;
        guard
            .flush()
            .map_err(|e| format!("no se pudo vaciar el buffer al sidecar: {e}"))?;
        Ok(())
    }
}

/// Hilo que lee `stdout` del sidecar y emite cada línea como evento
/// Tauri al webview.
///
/// Líneas vacías se descartan: el parser del lado Bun las ignora
/// también, así que omitirlas evita ruido en el front-end.
///
/// Un fallo de `read_line` rompe el bucle: el sidecar cerró stdout,
/// el bridge está muerto. El webview descubrirá el problema cuando
/// el próximo `send` falle.
fn pump_stdout(app: AppHandle, stdout: ChildStdout) {
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        match line {
            Ok(line) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if app.emit(EVENT_TO_WEBVIEW, trimmed).is_err() {
                    // El handle ya no es válido (la app se está
                    // cerrando). Salimos silenciosamente.
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

/// Comando Tauri que el webview invoca para mandar un frame al sidecar.
///
/// El parámetro `frame` es la línea JSON-RPC completa **sin** el
/// `\n` final — el bridge lo añade. Esto evita que un front-end
/// con prisa concatene un newline extra y rompa el parser del lado
/// Bun.
#[tauri::command]
pub fn send_to_sidecar(bridge: State<'_, Bridge>, frame: String) -> Result<(), String> {
    bridge.send(&frame)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El nombre del evento y del comando son contrato público: el
    /// front-end los importa literalmente. Si alguien los renombra,
    /// el webview se queda mudo y este test es la primera señal.
    #[test]
    fn nombres_publicos_son_los_esperados() {
        assert_eq!(EVENT_TO_WEBVIEW, "tanit://ipc-message");
        assert_eq!(COMMAND_FROM_WEBVIEW, "send_to_sidecar");
    }
}
