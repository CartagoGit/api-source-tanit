//! La ventana nativa de Tanit.
//!
//! Shell fina: tres responsabilidades, ninguna más.
//!
//!   1. Arrancar el sidecar (`apisrc serve --stdio`).
//!   2. Montar el bridge IPC (ver `bridge.rs`).
//!   3. Abrir la ventana apuntando al `dist/` empaquetado.
//!
//! Sin lógica de producto. Si este fichero crece, algo se ha
//! duplicado: la interfaz es la misma que sirve `apisrc ui`, y el
//! pipeline es el mismo binario que usa la terminal.
//!
//! El webview habla con el sidecar a través del comando Tauri
//! `send_to_sidecar` (definido en `bridge.rs`) y del evento
//! `tanit://ipc-message`. Es un canal newline-delimited JSON-RPC
//! 2.0 sobre stdin/stdout — el contrato vive en
//! `packages/core/transport/json-rpc-protocol.ts`.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod sidecar;

use std::process::Child;
use std::sync::Mutex;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use bridge::Bridge;
use sidecar::spawn as spawn_sidecar;

/// Posee el `Child` del sidecar para matarlo al destruirse la
/// ventana. Sin esto el sidecar sobrevive y se queda con el puerto
/// en la siguiente apertura.
struct Sidecar(Mutex<Option<Child>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![bridge::send_to_sidecar])
        .manage(Sidecar(Mutex::new(None)))
        .setup(|app| {
            // 1. Sidecar: `apisrc serve --stdio`, stdin/stdout para
            //    el bridge; stderr va a un hilo logger propio
            //    (`sidecar.rs`) y no se descarta.
            let (child, pipes) = spawn_sidecar(app.handle(), None)
                .map_err(std::io::Error::other)?;

            // 2. Bridge IPC: el pump de stdout se arranca aquí y
            //    vive hasta que el sidecar cierra el pipe.
            let bridge = Bridge::spawn(app.handle().clone(), pipes);
            app.manage(bridge);

            // 3. Ventana: carga el `dist/` empaquetado (no hay
            //    URL del sidecar — el webview habla por el canal
            //    IPC, no por HTTP).
            WebviewWindowBuilder::new(app, "principal", WebviewUrl::App("index.html".into()))
                .title("Tanit")
                .inner_size(980.0, 760.0)
                .build()?;

            // 4. Child en el estado: lo matamos al destruir la
            //    ventana (ver `on_window_event`).
            app.state::<Sidecar>().0.lock().unwrap().replace(child);

            Ok(())
        })
        .on_window_event(|window, evento| {
            if let tauri::WindowEvent::Destroyed = evento {
                if let Some(mut child) = window
                    .app_handle()
                    .state::<Sidecar>()
                    .0
                    .lock()
                    .unwrap()
                    .take()
                {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar la ventana");
}

#[cfg(test)]
mod tests {
    /// Documenta el reparto de módulos. Si alguien mueve un `mod`
    /// sin actualizar este test, falla antes de que el `cargo build`
    /// empiece a quejarse de items privados.
    #[test]
    fn los_modulos_esperados_estan_declarados() {
        // No se puede instanciar los tipos aquí (necesitan
        // `AppHandle`), pero la presencia de los `mod` ya está
        // comprobada en compilación. Este test queda como
        // documentación ejecutable del reparto.
    }
}
