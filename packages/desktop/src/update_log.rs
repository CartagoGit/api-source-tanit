//! El log de seguridad del updater.
//!
//! ## Por qué existe
//!
//! El updater emite dos eventos: el de estado (para la interfaz) y el
//! de **seguridad** (para quien tenga que abrir el incidente). El
//! segundo se emitía… y se perdía: nadie lo escuchaba y no se
//! escribía en ningún sitio. Un evento que no se persiste no es un
//! evento: es un mensaje que se pierde en cuanto la app se cierra.
//!
//! Aquí está el consumidor mínimo y honesto: un fichero de **una
//! línea por evento**, en JSON, que la app escribe cuando el updater
//! aborta con un motivo que es un intento de sustitución.
//!
//! ## Por qué JSON y no texto libre
//!
//! Porque lo que se escribe después lo lee una máquina —un colector
//! de logs, un `grep`, un ticket— y un formato que se parsea sin
//! ambigüedad es un formato que se puede contar. El mensaje que ve la
//! persona va **dentro** del registro: el que triaje un incidente no
//! tiene que casar dos vocabularios a mano.
//!
//! ## Por qué no hay nada secreto aquí
//!
//! Lo que se escribe es el **código** del aborto, el mensaje, la
//! versión instalada y el endpoint. Ninguno de los cuatro es un
//! secreto: la clave pública no aparece, la privada nunca ha estado
//! aquí, y el manifiesto firmado no se copia al log.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// El nombre del fichero de log dentro del directorio de logs de la app.
pub const UPDATE_SECURITY_LOG: &str = "update-security.log";

/// Un evento de seguridad del updater, ya explicado.
///
/// Es una copia mínima de lo que el comando devuelve al webview: lo
/// justo para poder triar un incidente sin el contexto de la ventana.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityEvent {
    /// El código estable del motivo (`update.signature.invalid`…).
    pub code: String,
    /// El mensaje que ve la persona.
    pub message: String,
    /// La versión que estaba instalada cuando pasó.
    pub version: String,
    /// El endpoint que se consultó.
    pub endpoint: String,
}

/// El instante actual, en segundos desde la época Unix.
pub fn now_epoch_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}

/// La fecha en ISO-8601 (UTC) de un instante en segundos.
///
/// Sin `chrono`: el crate no lo tiene y meter una dependencia para
/// formatear una fecha es una dependencia de la que hay que
/// acordarse. El algoritmo es el de días civiles de Howard Hinnant,
/// que es exacto para el calendario gregoriano y cabe en veinte
/// líneas.
pub fn iso8601(epoch_seconds: i64) -> String {
    let days = epoch_seconds.div_euclid(86_400);
    let seconds_of_day = epoch_seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        seconds_of_day / 3_600,
        (seconds_of_day % 3_600) / 60,
        seconds_of_day % 60
    )
}

/// La fecha civil (año, mes, día) de un número de días desde la época.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 { shifted } else { shifted - 146_096 } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_prime + 2) / 5 + 1) as u32;
    let month = if month_prime < 10 { month_prime + 3 } else { month_prime - 9 } as u32;
    (year + i64::from(month <= 2), month, day)
}

/// Escribe el evento en una línea de JSON.
///
/// Una línea, un evento: el fichero se puede leer con `grep`, con
/// `jq`, y se puede cortar por la mitad sin perder el sentido.
pub fn format_line(event: &SecurityEvent, timestamp: &str) -> String {
    let payload = serde_json::json!({
        "timestamp": timestamp,
        "event": "update.security",
        "code": event.code,
        "message": event.message,
        "version": event.version,
        "endpoint": event.endpoint,
    });
    format!("{payload}")
}

/// Añade una línea al log, creando el directorio si hace falta.
///
/// Si el log no se puede escribir, el error **no** se propaga: un
/// evento de seguridad que no se puede persistir no puede tumbar la
/// app, porque lo que está en juego es la actualización, no el disco.
pub fn append(path: &Path, line: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut file: File = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{line}").map_err(|error| error.to_string())
}

/// Escribe el evento en el log y devuelve la línea que se escribió.
///
/// Lo que devuelve es la línea **exacta**: un test puede compararla
/// con lo que hay en el fichero sin parsear el JSON.
pub fn record(path: &Path, event: &SecurityEvent) -> Result<String, String> {
    let line = format_line(event, &iso8601(now_epoch_seconds()));
    append(path, &line)?;
    Ok(line)
}
