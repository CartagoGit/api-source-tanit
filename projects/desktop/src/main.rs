//! La ventana nativa de Export to Postman.
//!
//! Su único trabajo es **arrancar el sidecar y apuntar la ventana a
//! donde escuche**. Nada de lógica de producto: la interfaz es la misma
//! que sirve `expostman ui`, y el pipeline es el mismo binario que usa
//! la terminal.
//!
//! Esto es lo que hace que la propuesta `f00001` no fuera trabajo
//! tirado. La opción de servir la interfaz desde `Bun.serve` se eligió
//! precisamente porque la ventana nativa carga **la misma página**, así
//! que empaquetar es empaquetar y no reescribir.
//!
//! Si este fichero crece, algo se ha duplicado.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Cuánto se espera a que el sidecar diga por dónde escucha.
///
/// El primer arranque incluye descubrir el proyecto, así que cinco
/// segundos es holgado sin llegar a parecer que la app se ha colgado.
const ARRANQUE_MAX: Duration = Duration::from_secs(5);

/// El hijo, para poder matarlo al cerrar.
///
/// Sin esto el sidecar sobrevive a la ventana y se queda con el puerto:
/// cerrar y volver a abrir daría «puerto ocupado» hasta reiniciar. Es
/// exactamente el fallo que el servidor evita buscando otro puerto, y no
/// hay motivo para provocarlo desde aquí.
struct Sidecar(Mutex<Option<Child>>);

/// Arranca `expostman ui` y devuelve la URL que imprime.
///
/// Se lee la URL de su salida en vez de asumir un puerto: el servidor
/// busca uno libre si el suyo está ocupado, así que dar por hecho el
/// 4771 haría que la ventana apuntara a la nada justo cuando hay dos
/// instancias abiertas.
fn arrancar_sidecar(ruta: &std::path::Path) -> Result<(Child, String), String> {
    let mut hijo = Command::new(ruta)
        .args(["ui", "--no-open"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("no se pudo arrancar el sidecar: {e}"))?;

    let salida = hijo
        .stdout
        .take()
        .ok_or_else(|| "el sidecar no expuso su salida".to_string())?;

    let inicio = Instant::now();
    let lector = BufReader::new(salida);
    for linea in lector.lines() {
        if inicio.elapsed() > ARRANQUE_MAX {
            break;
        }
        let linea = linea.map_err(|e| format!("no se pudo leer del sidecar: {e}"))?;
        if let Some(pos) = linea.find("http://127.0.0.1:") {
            let url: String = linea[pos..]
                .chars()
                .take_while(|c| !c.is_whitespace())
                .collect();
            return Ok((hijo, url));
        }
    }

    let _ = hijo.kill();
    Err(format!(
        "el sidecar no dijo por dónde escuchaba en {} s",
        ARRANQUE_MAX.as_secs()
    ))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Sidecar(Mutex::new(None)))
        .setup(|app| {
            // El sidecar es el binario `expostman` que Tauri empaqueta
            // dentro: una sola fuente de verdad para el pipeline, no dos.
            let ruta = app
                .path()
                .resolve("expostman", tauri::path::BaseDirectory::Resource)?;

            let (hijo, url) = arrancar_sidecar(&ruta).map_err(|e| {
                // Un fallo aquí deja la app inservible, así que se dice
                // por qué en vez de abrir una ventana en blanco.
                std::io::Error::other(e)
            })?;

            app.state::<Sidecar>().0.lock().unwrap().replace(hijo);

            WebviewWindowBuilder::new(
                app,
                "principal",
                WebviewUrl::External(url.parse().map_err(std::io::Error::other)?),
            )
            .title("Export to Postman")
            .inner_size(980.0, 760.0)
            .build()?;

            Ok(())
        })
        .on_window_event(|window, evento| {
            if let tauri::WindowEvent::Destroyed = evento {
                if let Some(mut hijo) = window
                    .app_handle()
                    .state::<Sidecar>()
                    .0
                    .lock()
                    .unwrap()
                    .take()
                {
                    let _ = hijo.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar la ventana");
}
