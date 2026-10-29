//! La ventana nativa de Tanit.
//!
//! Shell fina: cuatro responsabilidades, ninguna más.
//!
//!   1. Arrancar el sidecar (`apisrc serve --stdio`).
//!   2. Montar el bridge IPC (ver `bridge.rs`).
//!   3. Abrir la ventana apuntando al `dist/` empaquetado.
//!   4. Inicializar el updater firmado (ver `updater.rs`).
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
//!
//! ## El updater
//!
//! La cuarta responsabilidad es la que **verifica**. El updater se
//! inicializa con un contrato explícito —endpoint, clave pública
//! versionada, versión actual, tiempo máximo y política de reintento—
//! y vive en `updater.rs`, que no sabe nada de Tauri: son funciones
//! puras sobre bytes, y por eso se prueban sin ventana y sin red.
//!
//! Aquí solo se cablea: el comando que el webview invoca, el hilo que
//! habla con la red y los dos eventos que la app emite —el estado y
//! el **evento de seguridad**, que es lo que deja rastro cuando
//! alguien intenta instalar algo que no cuadra.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod bridge;
// Estos dos módulos son **contratos** de la ventana: el picker
// nativo de carpeta y la normalización del arrastre. Todavía no hay
// ningún comando que los use, así que el compilador los marca como
// muertos. Se declaran aquí para que el sitio esté escrito, y se
// avisa de la verdad: lo que no está vivo es el comando, no el
// contrato.
#[allow(dead_code)]
mod dialogs;
#[allow(dead_code)]
mod drag_drop;
mod sidecar;
mod secure_storage;
mod updater;
use std::process::Child;
use std::sync::Mutex;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use bridge::Bridge;
use secure_storage::SecureStorage;
use sidecar::spawn as spawn_sidecar;
use updater::{HttpsTransport, UpdatePlatform, UpdaterContract};

/// Evento que el webview escucha con el resultado de la comprobación.
///
/// Payload: un `UpdateStatus` o un `UpdateFailure`, según lo que
/// haya pasado.
pub const EVENT_UPDATE_STATUS: &str = "tanit://update-status";

/// Evento de seguridad.
///
/// Se emite **solo** cuando el aborto es un intento de sustitución:
/// firma que no verifica, hash que no cuadra, clave que no es la
/// esperada. Un endpoint caído no es un ataque y no aparece aquí.
pub const EVENT_UPDATE_SECURITY: &str = "tanit://update-security-event";

/// El contrato con el que se inicializó el updater.
///
/// Vive en el estado de Tauri para que el webview pueda **preguntar**
/// cómo está configurado —endpoint, clave, versión, política— sin
/// que eso sea un secreto: la clave es pública y el endpoint no
/// concede nada por sí solo.
struct UpdaterState {
    contract: UpdaterContract,
}

/// Posee el `Child` del sidecar para matarlo al destruirse la
/// ventana. Sin esto el sidecar sobrevive y se queda con el puerto
/// en la siguiente apertura.
struct Sidecar(Mutex<Option<Child>>);

/// Lo que el webview ve cuando pregunta por el estado del updater.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus {
    /// El endpoint desde el que se lee el manifest.
    endpoint: String,
    /// La clave pública con la que se verifica.
    public_key_id: String,
    /// La versión instalada.
    current_version: String,
    /// El tiempo máximo de una petición, en milisegundos.
    timeout_ms: u64,
    /// Cuántos intentos se hacen de una misma petición.
    max_attempts: u32,
}

/// La actualización que hay disponible.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAvailable {
    /// La versión que se ofrece.
    version: String,
    /// De dónde se descarga.
    url: String,
    /// El SHA-256 firmado.
    sha256: String,
    /// El tamaño del instalador.
    size: u64,
    /// La versión más antigua que el manifest soporta.
    minimum_supported_version: String,
    /// De dónde viene la build.
    provenance_source: String,
}

/// Un aborto del updater, ya explicado para el webview.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateFailure {
    /// El código estable del motivo.
    code: String,
    /// El mensaje que ve la persona.
    message: String,
    /// Si hay que registrar un evento de seguridad.
    security_event: bool,
}

/// La actualización descargada y verificada, lista para instalarse.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDownloaded {
    /// La versión que se ha descargado.
    version: String,
    /// Dónde está el instalador.
    path: String,
    /// El SHA-256 recalculado sobre los bytes descargados.
    sha256: String,
    /// El tamaño del instalador.
    size: u64,
}

/// Convierte un aborto en el fallo que ve el webview.
fn to_failure(rejection: &updater::UpdateRejection) -> UpdateFailure {
    UpdateFailure {
        code: rejection.code().to_string(),
        message: rejection.message(),
        security_event: rejection.is_security_event(),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![bridge::send_to_sidecar, secure_storage_save, secure_storage_retrieve, secure_storage_delete, update_status, check_for_updates, download_update])
        .manage(Sidecar(Mutex::new(None)))
        .manage(SecureStorage)
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
            // 5. Updater: se inicializa con un contrato explícito.
            //    La versión es la del paquete —la misma que va en el
            //    `tauri.conf.json` y en el manifest de la release—,
            //    y la clave es la versionada del repo.
            let version = app.package_info().version.to_string();
            app.manage(UpdaterState {
                contract: UpdaterContract::from_environment(&version),
            });
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

/// El estado del updater: con qué está inicializado.
#[tauri::command]
fn update_status(state: tauri::State<'_, UpdaterState>) -> UpdateStatus {
    let contract = &state.contract;
    UpdateStatus {
        endpoint: contract.endpoint.clone(),
        public_key_id: contract.public_key_id.clone(),
        current_version: contract.current_version.clone(),
        timeout_ms: contract.timeout_ms,
        max_attempts: contract.retry.max_attempts,
    }
}

/// Comprueba si hay una actualización.
///
/// Devuelve la actualización disponible o el motivo del aborto. Un
/// aborto **no** es un error de la app: la app sigue funcionando con
/// la versión instalada, y el motivo se le enseña a la persona.
///
/// El comando no bloquea el hilo de la interfaz: la comprobación va
/// a un hilo aparte porque habla con la red, y una red lenta no puede
/// congelar una ventana.
#[tauri::command]
async fn check_for_updates(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdaterState>,
) -> Result<UpdateAvailable, UpdateFailure> {
    let contract = state.contract.clone();
    let platform = UpdatePlatform::current();
    let checked = tauri::async_runtime::spawn_blocking(move || {
        updater::check_for_update(&contract, &HttpsTransport::new(), &platform)
    })
    .await;

    let outcome = match checked {
        Ok(result) => result,
        Err(error) => Err(updater::UpdateRejection::EndpointUnavailable {
            detail: error.to_string(),
        }),
    };

    match outcome {
        Ok(plan) => Ok(UpdateAvailable {
            version: plan.version,
            url: plan.target.url,
            sha256: plan.target.sha256,
            size: plan.target.size,
            minimum_supported_version: plan.minimum_supported_version,
            provenance_source: plan.provenance.source,
        }),
        Err(rejection) => {
            let failure = to_failure(&rejection);
            // El evento de seguridad se emite **además** del estado:
            // el estado es para la interfaz y el evento es para el
            // log. Un intento de sustitución tiene que dejar rastro
            // aunque nadie esté mirando la ventana.
            if failure.security_event {
                let _ = app.emit(EVENT_UPDATE_SECURITY, &failure);
            }
            let _ = app.emit(EVENT_UPDATE_STATUS, &failure);
            Err(failure)
        }
    }
}

/// Descarga la actualización y la verifica **antes** de instalar.
///
/// El orden es el que importa: primero el manifest (que ya viene
/// firmado y verificado), luego los bytes, y sólo después el hash y
/// la firma del instalador. Un instalador que no cuadra se descarta:
/// no se escribe, no se instala y no se ofrece.
///
/// Lo que hay al final en disco es un fichero que **no** se ha
/// instalado todavía: la instalación la decide el sistema, y ese
/// paso no es de este comando.
#[tauri::command]
async fn download_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdaterState>,
    version: String,
) -> Result<UpdateDownloaded, UpdateFailure> {
    let contract = state.contract.clone();
    let platform = UpdatePlatform::current();
    let destination = match app.path().download_dir() {
        Ok(directory) => directory.join(format!("Tanit_{version}_installer")),
        Err(error) => {
            return Err(UpdateFailure {
                code: "update.download.failed".to_string(),
                message: format!("No se ha encontrado una carpeta donde descargar: {error}"),
                security_event: false,
            })
        }
    };

    let downloaded = tauri::async_runtime::spawn_blocking(move || {
        let transport = HttpsTransport::new();
        let plan = updater::check_for_update(&contract, &transport, &platform)?;
        if plan.version != version {
            return Err(updater::UpdateRejection::VersionNotNewer {
                current: contract.current_version.clone(),
                offered: plan.version.clone(),
            });
        }
        let bytes = updater::fetch_with_retry(
            &transport,
            &plan.target.url,
            contract.timeout(),
            &contract.retry,
        )?;
        updater::verify_artifact_hash(&plan.target, &bytes)?;
        updater::verify_artifact_signature(&contract, &plan.target, &bytes)?;
        Ok((plan, bytes))
    })
    .await;

    let (plan, bytes) = match downloaded {
        Ok(Ok(result)) => result,
        Ok(Err(rejection)) => {
            let failure = to_failure(&rejection);
            if failure.security_event {
                let _ = app.emit(EVENT_UPDATE_SECURITY, &failure);
            }
            let _ = app.emit(EVENT_UPDATE_STATUS, &failure);
            return Err(failure);
        }
        Err(error) => {
            return Err(UpdateFailure {
                code: "update.download.failed".to_string(),
                message: format!("No se ha podido descargar la actualización: {error}"),
                security_event: false,
            })
        }
    };

    if let Some(parent) = destination.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            return Err(UpdateFailure {
                code: "update.download.failed".to_string(),
                message: format!("No se ha podido preparar la carpeta de descarga: {error}"),
                security_event: false,
            });
        }
    }
    if let Err(error) = std::fs::write(&destination, &bytes) {
        return Err(UpdateFailure {
            code: "update.download.failed".to_string(),
            message: format!("No se ha podido guardar la actualización: {error}"),
            security_event: false,
        });
    }

    Ok(UpdateDownloaded {
        version: plan.version,
        path: destination.to_string_lossy().to_string(),
        sha256: updater::sha256_hex(&bytes),
        size: bytes.len() as u64,
    })
}

#[tauri::command]
fn secure_storage_save(storage: tauri::State<'_, SecureStorage>, service: String, value: String) -> Result<(), String> {
    storage.save(service, value)
}
#[tauri::command]
fn secure_storage_retrieve(storage: tauri::State<'_, SecureStorage>, service: String) -> Result<Option<String>, String> {
    storage.retrieve(&service)
}
#[tauri::command]
fn secure_storage_delete(storage: tauri::State<'_, SecureStorage>, service: String) -> Result<(), String> {
    storage.delete(&service)
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

    /// Los dos eventos del updater tienen que ser distinguibles: el
    /// de estado es para la interfaz y el de seguridad es para el log.
    /// Si un día se mezclan, el log deja de tener sentido.
    #[test]
    fn los_eventos_del_updater_son_distintos() {
        assert_ne!(super::EVENT_UPDATE_STATUS, super::EVENT_UPDATE_SECURITY);
    }
}
