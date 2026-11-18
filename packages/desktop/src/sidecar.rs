//! Sidecar management — spawn `apisrc serve --stdio` y capturar sus
//! pipes sin perder el stderr.
//!
//! La ventana solo conoce el contrato IPC (`bridge.rs`); este módulo
//! es lo único que sabe qué binario y qué argumentos se lanzan.
//! Si mañana cambia el sidecar (un wrapper, un script de Python, un
//! `bun` que habla el mismo protocolo), este es el único sitio que
//! se toca.
//!
//! ## Por qué un hilo dedicado para stderr
//!
//! El sidecar imprime logs de diagnóstico en stderr (carga del
//! registry, errores no recuperables, trazas de cancelación). Si se
//! descarta, el operador ve una app "muda" cuando algo va mal. Si se
//! deja en `Stdio::inherit()`, se mezcla con la consola de Tauri y
//! rompe cuando la app está empaquetada (no hay consola). El
//! compromiso: leer stderr línea a línea y emitirlo por
//! `eprintln!`, que Tauri / el binario capturan y muestran en el log
//! de la plataforma (Console.app en macOS, `journalctl` en Linux,
//! Event Log en Windows).

use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};

use tauri::{AppHandle, Manager};

/// Argumentos que se pasan al sidecar para arrancarlo en modo IPC.
const ARG_SERVE: &str = "serve";
const ARG_STDIO: &str = "--stdio";
const ARG_WORKSPACE: &str = "--workspace";

/// Lo que el `Bridge` necesita para hablar con el sidecar.
///
/// El `Child` queda fuera: la ventana lo posee y lo mata al
/// destruirse. Pasar solo las pipes mantiene la responsabilidad
/// clara: `Sidecar` mata, `Bridge` habla.
pub struct SidecarPipes {
    pub stdin: ChildStdin,
    pub stdout: ChildStdout,
}

/// Arranca el sidecar y devuelve `(Child, SidecarPipes)`.
///
/// - `workspace`: si viene `Some`, se pasa como `--workspace` para que
///   el sidecar sepa qué proyecto abrir. `None` deja al sidecar usar
///   su propia resolución (la misma que `apisrc generate`).
///
/// Errores:
/// - No se encuentra el binario empaquetado (Tauri no lo copió).
/// - Falla `spawn()` (permisos, binario incompatible, ...).
/// - Alguna de las dos pipes de comunicación no se pudo capturar
///   (stderr siempre se captura — un hilo lo lee en bucle).
pub fn spawn(
    app: &AppHandle,
    workspace: Option<&str>,
) -> Result<(Child, SidecarPipes), String> {
    let bin = app
        .path()
        .resolve("apisrc", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("no se pudo resolver la ruta del sidecar: {e}"))?;

    let mut cmd = Command::new(&bin);
    cmd.arg(ARG_SERVE)
        .arg(ARG_STDIO)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(workspace) = workspace {
        cmd.arg(ARG_WORKSPACE).arg(workspace);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("no se pudo arrancar el sidecar `{bin:?}`: {e}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "el sidecar no expuso stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "el sidecar no expuso stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "el sidecar no expuso stderr".to_string())?;

    // stderr se consume aquí: el logger lo lee en bucle y nunca lo
    // devuelve. Si la ventana muere, el logger muere con el lado del
    // pipe que el kernel cierra al matar al hijo.
    spawn_stderr_logger(stderr);

    Ok((child, SidecarPipes { stdin, stdout }))
}

/// Hilo dedicado que lee stderr del sidecar línea a línea y lo
/// reenvía al log del proceso nativo.
///
/// `eprintln!` lo recoge:
/// - en `cargo tauri dev` → la consola donde se lanzó,
/// - en un binario empaquetado → el log de la plataforma
///   (macOS: Console.app / `log show`; Linux: `journalctl`; Windows:
///   Event Log).
///
/// Termina solo cuando el sidecar cierra stderr (el kernel lo hace al
/// morir el hijo), así que no hace falta un JoinHandle.
fn spawn_stderr_logger(stderr: ChildStderr) {
    let _ = std::thread::Builder::new()
        .name("sidecar-stderr".into())
        .spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(line) => eprintln!("[sidecar] {line}"),
                    Err(_) => break,
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Documenta el contrato de los flags. Si alguien los cambia sin
    /// actualizar el CLI, este test falla antes que un dev se pregunte
    /// por qué la app arranca en modo HTTP.
    #[test]
    fn flags_del_sidecar_son_los_esperados() {
        assert_eq!(ARG_SERVE, "serve");
        assert_eq!(ARG_STDIO, "--stdio");
        assert_eq!(ARG_WORKSPACE, "--workspace");
    }
}
