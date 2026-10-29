//! El updater firmado de Tanit: el núcleo de verificación.
//!
//! Este módulo **no descarga y no instala**: decide si lo que se ha
//! descargado se puede instalar. Es la pieza donde vive la seguridad
//! de la actualización, y por eso está aislada de Tauri, de la red y
//! del sistema de ficheros: son funciones puras sobre bytes, que se
//! pueden probar sin cuenta, sin red y sin ventana.
//!
//! ## El orden de las comprobaciones
//!
//! El orden no es un detalle: es la diferencia entre "no he instalado
//! nada raro" y "he instalado algo raro". Antes de **descargar**:
//!
//!   1. El endpoint es HTTPS. Sin HTTPS no se pide nada.
//!   2. El manifest se **parsea** y su esquema es el esperado.
//!   3. El manifest declara la **misma clave** que el contrato.
//!   4. La **firma** del manifest verifica contra la clave pública.
//!   5. La versión ofrecida es **posterior** a la instalada.
//!   6. La app instalada es **compatible** con el manifest.
//!   7. Hay un destino para **esta plataforma**, y su URL es HTTPS.
//!
//! Después de **descargar**, y antes de instalar:
//!
//!   8. El **hash** del instalador cuadra con el que dice el manifest.
//!   9. La **firma** del instalador verifica.
//!
//! ## Por qué no hay modo sin firma
//!
//! No hay. Un manifiesto sin firma, un destino sin firma o una
//! verificación que falla **aborta**. No existe una rama que siga
//! adelante "por si acaso", porque esa rama es exactamente la que un
//! atacante quiere: la que instala el artefacto cuando la prueba
//! criptográfica falla. El error es visible y es un evento de
//! seguridad, no un aviso.
//!
//! ## La clave privada no está aquí
//!
//! Aquí solo hay claves **públicas**. La privada vive en el almacén de
//! secretos del CI, sale de él para firmar el manifest y los
//! instaladores, y no vuelve a entrar. Lo que hay en el repo es
//! `keys/tanit-updater-public-key-v1.pem`, versionada: cambiarla es un
//! acto explícito, no una edición silenciosa.

use std::fmt;
use std::time::Duration;

use base64::Engine as _;
use serde::Deserialize;
use sha2::{Digest, Sha256};

/// El esquema del manifest de actualización.
pub const MANIFEST_SCHEMA: &str = "tanit.update.manifest/v1";

/// El único algoritmo de firma que el updater entiende.
pub const SIGNATURE_ALGORITHM: &str = "ed25519";

/// El identificador de la clave pública versionada que hay en el repo.
pub const DEFAULT_PUBLIC_KEY_ID: &str = "tanit-updater-v1";

/// La clave pública versionada, embebida en el binario.
///
/// Es una clave **pública**: que vaya dentro del binario no da ningún
/// poder, solo permite verificar. La privada no está en el repo, ni en
/// la app, ni en los logs de build.
pub const DEFAULT_PUBLIC_KEY_PEM: &str = include_str!("../keys/tanit-updater-public-key-v1.pem");

/// El endpoint por defecto del manifest. Solo HTTPS.
pub const DEFAULT_ENDPOINT: &str = "https://updates.tanit.dev/latest.json";

/// El tiempo máximo de una petición, en milisegundos.
pub const DEFAULT_TIMEOUT_MS: u64 = 15_000;

/// El prefijo DER de una clave Ed25519 en `SubjectPublicKeyInfo`.
///
/// Son 12 bytes fijos: el identificador del algoritmo (`1.3.101.112`,
/// que es Ed25519) y el BIT STRING que envuelve los 32 bytes de la
/// clave. Se comprueba en vez de asumirlo: una clave PEM que no sea
/// Ed25519 tiene que fallar, no "funcionar" de otra manera.
const ED25519_SPKI_PREFIX: [u8; 12] = [
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];

/// La plataforma donde corre la app instalada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdatePlatform {
    /// El sistema operativo.
    pub os: String,
    /// La arquitectura de CPU.
    pub arch: String,
    /// El formato del instalador.
    pub bundle: String,
}

impl UpdatePlatform {
    /// La plataforma actual, deducida del sistema donde corre la app.
    pub fn current() -> Self {
        UpdatePlatform {
            os: current_os().to_string(),
            arch: current_arch().to_string(),
            bundle: current_bundle().to_string(),
        }
    }
}

/// La política de reintentos del endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetryPolicy {
    /// Cuántos intentos, en total, se hacen de una misma petición.
    pub max_attempts: u32,
    /// La espera del primer reintento, en milisegundos.
    pub initial_backoff_ms: u64,
    /// El techo de la espera, en milisegundos.
    pub max_backoff_ms: u64,
    /// Por qué se multiplica la espera en cada reintento.
    pub multiplier: u32,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        RetryPolicy {
            max_attempts: 3,
            initial_backoff_ms: 500,
            max_backoff_ms: 4_000,
            multiplier: 2,
        }
    }
}

impl RetryPolicy {
    /// La espera antes del intento número `attempt` (1 = el primero).
    ///
    /// El primer intento no espera. Los siguientes multiplican la
    /// espera inicial y se topan en `max_backoff_ms`, para que un
    /// endpoint caído no se convierta en una espera infinita.
    pub fn backoff_for(&self, attempt: u32) -> Duration {
        if attempt <= 1 {
            return Duration::from_millis(0);
        }
        let mut backoff = self.initial_backoff_ms;
        for _ in 2..attempt {
            backoff = backoff.saturating_mul(u64::from(self.multiplier.max(1)));
            if backoff >= self.max_backoff_ms {
                break;
            }
        }
        Duration::from_millis(backoff.min(self.max_backoff_ms))
    }
}

/// El contrato con el que se inicializa el updater.
///
/// Es explícito a propósito: de dónde se lee, con qué clave se
/// verifica, qué versión tiene la app y cuánto se espera son **datos**,
/// no decisiones que se toman al vuelo. Lo único que se decide al vuelo
/// es si lo que llegó es aceptable, y esa decisión está en las
/// funciones de este módulo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdaterContract {
    /// De dónde se lee el manifest. Solo HTTPS.
    pub endpoint: String,
    /// El identificador de la clave pública con la que se verifica.
    pub public_key_id: String,
    /// La clave pública, en PEM.
    pub public_key_pem: String,
    /// La versión semver de la app instalada.
    pub current_version: String,
    /// El tiempo máximo de una petición.
    pub timeout_ms: u64,
    /// La política de reintentos.
    pub retry: RetryPolicy,
}

impl UpdaterContract {
    /// El contrato por defecto: la clave versionada del repo y el
    /// endpoint de producción.
    pub fn new(current_version: &str) -> Self {
        UpdaterContract {
            endpoint: DEFAULT_ENDPOINT.to_string(),
            public_key_id: DEFAULT_PUBLIC_KEY_ID.to_string(),
            public_key_pem: DEFAULT_PUBLIC_KEY_PEM.to_string(),
            current_version: current_version.to_string(),
            timeout_ms: DEFAULT_TIMEOUT_MS,
            retry: RetryPolicy::default(),
        }
    }

    /// El contrato con sus valores ajustados desde el entorno.
    ///
    /// El entorno solo puede **acotar** el comportamiento, nunca
    /// cambiarle la política: el timeout baja, el endpoint cambia,
    /// pero la clave pública sigue siendo la versionada del repo
    /// salvo que se diga lo contrario y con la misma clave publica.
    /// Un binario que acepta una clave privada por variable de
    /// entorno no es un updater firmado, es un updater que firma lo
    /// que le digan.
    pub fn from_environment(current_version: &str) -> Self {
        let mut contract = UpdaterContract::new(current_version);
        if let Ok(endpoint) = std::env::var("TANIT_UPDATE_ENDPOINT") {
            if !endpoint.trim().is_empty() {
                contract.endpoint = endpoint;
            }
        }
        if let Ok(timeout) = std::env::var("TANIT_UPDATE_TIMEOUT_MS") {
            if let Ok(parsed) = timeout.trim().parse::<u64>() {
                contract.timeout_ms = parsed;
            }
        }
        if let Ok(attempts) = std::env::var("TANIT_UPDATE_MAX_ATTEMPTS") {
            if let Ok(parsed) = attempts.trim().parse::<u32>() {
                contract.retry.max_attempts = parsed.max(1);
            }
        }
        contract
    }

    /// El tiempo máximo de una petición.
    pub fn timeout(&self) -> Duration {
        Duration::from_millis(self.timeout_ms)
    }

    /// Comprueba que el endpoint sea HTTPS.
    ///
    /// Se comprueba **antes** de pedir nada. Un endpoint en HTTP no es
    /// un endpoint lento: es un endpoint al que le puedes cambiar el
    /// manifest por el camino.
    pub fn validate(&self) -> Result<(), UpdateRejection> {
        if self.endpoint.trim().is_empty() {
            return Err(UpdateRejection::EndpointMissing);
        }
        if !is_https(&self.endpoint) {
            return Err(UpdateRejection::EndpointNotHttps {
                endpoint: self.endpoint.clone(),
            });
        }
        Ok(())
    }
}

/// Un destino del manifest: un instalador y su identidad.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTarget {
    /// El sistema operativo del instalador.
    pub os: String,
    /// La arquitectura de CPU del instalador.
    pub arch: String,
    /// El formato del instalador.
    pub bundle: String,
    /// De dónde se descarga. Solo HTTPS.
    pub url: String,
    /// El SHA-256 del instalador, en hexadecimal minúsculas.
    pub sha256: String,
    /// La firma Ed25519 del instalador, en base64.
    pub signature: String,
    /// El tamaño del instalador, en bytes.
    pub size: u64,
}

/// De dónde viene la build que se ofrece.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProvenance {
    /// De dónde sale la build.
    pub source: String,
    /// El workflow o el job que la produjo, si aplica.
    #[serde(default)]
    pub workflow: Option<String>,
    /// El commit desde el que se construyó.
    #[serde(default)]
    pub commit: Option<String>,
    /// ISO-8601 de cuándo se construyó.
    #[serde(default)]
    pub built_at: Option<String>,
}

/// El manifest de actualización, firmado.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateManifest {
    /// El discriminante de formato.
    pub schema: String,
    /// La versión semver que se ofrece.
    pub version: String,
    /// La versión más antigua que este manifest todavía soporta.
    pub minimum_supported_version: String,
    /// ISO-8601 de cuándo se generó.
    pub generated_at: String,
    /// Qué clave pública firmó este manifest.
    pub public_key_id: String,
    /// El algoritmo de la firma.
    pub signature_algorithm: String,
    /// Los instaladores que se ofrecen.
    pub targets: Vec<UpdateTarget>,
    /// De dónde viene la build.
    pub provenance: UpdateProvenance,
}

/// El plan de actualización: qué se va a instalar y por qué.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdatePlan {
    /// La versión que se ofrece.
    pub version: String,
    /// El destino que corresponde a esta plataforma.
    pub target: UpdateTarget,
    /// La versión mínima que el manifest soporta.
    pub minimum_supported_version: String,
    /// De dónde viene la build.
    pub provenance: UpdateProvenance,
}

/// Por qué el updater aborta.
///
/// Es un enum y no un `String` porque los motivos se **comparan**: un
/// test afirma que una firma corrupta da `SignatureInvalid` y no
/// "algún error". El mensaje para la persona se construye en
/// [`UpdateRejection::message`]; el código para la máquina, en
/// [`UpdateRejection::code`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateRejection {
    /// El endpoint está vacío.
    EndpointMissing,
    /// El endpoint no es HTTPS.
    EndpointNotHttps { endpoint: String },
    /// El endpoint no respondió.
    EndpointUnavailable { detail: String },
    /// El manifest no llegó o llegó vacío.
    ManifestMissing,
    /// El manifest no es JSON válido o le faltan campos.
    ManifestInvalid { detail: String },
    /// El manifest es de otro esquema.
    ManifestSchemaMismatch { expected: String, found: String },
    /// La clave pública no es una clave Ed25519 usable.
    PublicKeyInvalid { detail: String },
    /// El manifest declara otra clave que la del contrato.
    PublicKeyMismatch { expected: String, found: String },
    /// La firma no verifica.
    SignatureInvalid,
    /// La versión ofrecida no es posterior a la instalada.
    VersionNotNewer { current: String, offered: String },
    /// La app instalada es más vieja de lo que el manifest soporta.
    VersionBelowMinimum { current: String, minimum: String },
    /// No hay destino para esta plataforma.
    TargetUnsupported { platform: String },
    /// La descarga falló.
    DownloadFailed { detail: String },
    /// El hash del instalador no cuadra.
    HashMismatch { expected: String, found: String },
    /// El tamaño del instalador no cuadra.
    SizeMismatch { expected: u64, found: u64 },
}

impl UpdateRejection {
    /// El código estable del motivo.
    ///
    /// Las mismas cadenas que usa el verificador de consola
    /// (`scripts/release/verify-update.sh`) y que declara
    /// `packages/contracts/constants/release/updater.constant.ts`: un
    /// `update.signature.invalid` tiene que decir lo mismo en el log
    /// de la app y en el del verificador.
    pub fn code(&self) -> &'static str {
        match self {
            UpdateRejection::EndpointMissing => "update.endpoint.missing",
            UpdateRejection::EndpointNotHttps { .. } => "update.endpoint.not_https",
            UpdateRejection::EndpointUnavailable { .. } => "update.endpoint.unavailable",
            UpdateRejection::ManifestMissing => "update.manifest.missing",
            UpdateRejection::ManifestInvalid { .. } => "update.manifest.invalid",
            UpdateRejection::ManifestSchemaMismatch { .. } => "update.manifest.schema_mismatch",
            UpdateRejection::PublicKeyInvalid { .. } => "update.public_key.invalid",
            UpdateRejection::PublicKeyMismatch { .. } => "update.public_key.mismatch",
            UpdateRejection::SignatureInvalid => "update.signature.invalid",
            UpdateRejection::VersionNotNewer { .. } => "update.version.not_newer",
            UpdateRejection::VersionBelowMinimum { .. } => "update.version.below_minimum",
            UpdateRejection::TargetUnsupported { .. } => "update.target.unsupported",
            UpdateRejection::DownloadFailed { .. } => "update.download.failed",
            UpdateRejection::HashMismatch { .. } => "update.hash.mismatch",
            UpdateRejection::SizeMismatch { .. } => "update.size.mismatch",
        }
    }

    /// El mensaje que ve la persona.
    ///
    /// Va en español y sin tecnicismos innecesarios, pero **no
    /// suaviza**: dice qué ha pasado y por qué no ha pasado nada.
    pub fn message(&self) -> String {
        match self {
            UpdateRejection::EndpointMissing => {
                "No hay endpoint de actualización configurado.".to_string()
            }
            UpdateRejection::EndpointNotHttps { endpoint } => format!(
                "El endpoint de actualización no es HTTPS: {endpoint}. No se descarga nada por una conexión que se pueda interceptar."
            ),
            UpdateRejection::EndpointUnavailable { detail } => format!(
                "No se pudo contactar con el servidor de actualizaciones: {detail}. Se conserva la versión instalada."
            ),
            UpdateRejection::ManifestMissing => {
                "El servidor de actualizaciones no devolvió el manifest de la versión.".to_string()
            }
            UpdateRejection::ManifestInvalid { detail } => format!(
                "El manifest de actualización no es válido: {detail}. No se instala nada."
            ),
            UpdateRejection::ManifestSchemaMismatch { expected, found } => format!(
                "El manifest de actualización usa el esquema `{found}` y esta versión entiende el `{expected}`. Actualiza Tanit antes de seguir."
            ),
            UpdateRejection::PublicKeyInvalid { detail } => format!(
                "La clave pública de actualización no es válida: {detail}. No se puede verificar nada, así que no se instala nada."
            ),
            UpdateRejection::PublicKeyMismatch { expected, found } => format!(
                "El manifest está firmado con la clave `{found}` y esta versión verifica con la `{expected}`. No se instala nada."
            ),
            UpdateRejection::SignatureInvalid => {
                "La firma del manifest de actualización no verifica. No se descarga ni se instala nada.".to_string()
            }
            UpdateRejection::VersionNotNewer { current, offered } => format!(
                "La versión publicada ({offered}) no es posterior a la instalada ({current}). No se hace nada."
            ),
            UpdateRejection::VersionBelowMinimum { current, minimum } => format!(
                "Esta versión ({current}) es más antigua de lo que el manifest soporta ({minimum}). Descarga la release a mano para actualizar."
            ),
            UpdateRejection::TargetUnsupported { platform } => format!(
                "No hay actualización para esta plataforma ({platform}). No se instala nada."
            ),
            UpdateRejection::DownloadFailed { detail } => format!(
                "No se pudo descargar la actualización: {detail}. Se conserva la versión instalada."
            ),
            UpdateRejection::HashMismatch { expected, found } => format!(
                "El instalador descargado no coincide con el hash firmado ({expected} frente a {found}). Se descarta."
            ),
            UpdateRejection::SizeMismatch { expected, found } => format!(
                "El instalador descargado mide {found} bytes y el manifest firmado dice {expected}. Se descarta."
            ),
        }
    }

    /// Si este aborto es un **evento de seguridad**.
    ///
    /// Un endpoint caído es un problema de operación: se puede
    /// reintentar. Una firma que no verifica, un hash que no cuadra o
    /// una clave que no es la esperada son intentos de sustituir lo
    /// que se instala, y se registran como tales.
    pub fn is_security_event(&self) -> bool {
        matches!(
            self,
            UpdateRejection::PublicKeyInvalid { .. }
                | UpdateRejection::PublicKeyMismatch { .. }
                | UpdateRejection::SignatureInvalid
                | UpdateRejection::HashMismatch { .. }
                | UpdateRejection::SizeMismatch { .. }
        )
    }
}

impl fmt::Display for UpdateRejection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.code(), self.message())
    }
}

impl std::error::Error for UpdateRejection {}

/// Un transporte de bytes.
///
/// Existe para que el núcleo se pueda probar **sin red**: el test
/// injecta un transporte que devuelve fixtures locales, y la app usa
/// uno que habla HTTPS. El núcleo no sabe cuál de los dos tiene.
pub trait UpdateTransport {
    /// Descarga `url` y devuelve los bytes.
    ///
    /// El transporte **no** decide si lo que devuelve es de fiar: eso
    /// es trabajo del núcleo, que verifica lo que sea que llegue.
    fn fetch(&self, url: &str, timeout: Duration) -> Result<Vec<u8>, UpdateRejection>;
}

/// Busca el destino que corresponde a la plataforma.
///
/// Un destino exacto o nada: si el manifest no tiene un instalador
/// para *esta* plataforma, no hay actualización. No se degrada a "el
/// que más se parezca", porque un instalador para otra arquitectura
/// no es una actualización: es una instalación rota.
pub fn select_target<'a>(
    manifest: &'a UpdateManifest,
    platform: &UpdatePlatform,
) -> Result<&'a UpdateTarget, UpdateRejection> {
    manifest
        .targets
        .iter()
        .find(|target| {
            target.os == platform.os
                && target.arch == platform.arch
                && target.bundle == platform.bundle
        })
        .ok_or_else(|| UpdateRejection::TargetUnsupported {
            platform: format!("{}/{}/{}", platform.os, platform.arch, platform.bundle),
        })
}

/// Parsea el manifest y comprueba su esquema.
///
/// Un manifest que no parsea no es un manifest que "todavía no se sabe
/// leer": es un manifest manipulado, o uno de otra versión del
/// protocolo. En los dos casos se aborta.
pub fn parse_manifest(bytes: &[u8]) -> Result<UpdateManifest, UpdateRejection> {
    if bytes.is_empty() {
        return Err(UpdateRejection::ManifestMissing);
    }
    let manifest: UpdateManifest =
        serde_json::from_slice(bytes).map_err(|error| UpdateRejection::ManifestInvalid {
            detail: error.to_string(),
        })?;
    if manifest.schema != MANIFEST_SCHEMA {
        return Err(UpdateRejection::ManifestSchemaMismatch {
            expected: MANIFEST_SCHEMA.to_string(),
            found: manifest.schema,
        });
    }
    if manifest.signature_algorithm != SIGNATURE_ALGORITHM {
        return Err(UpdateRejection::ManifestInvalid {
            detail: format!(
                "algoritmo de firma `{}` no soportado",
                manifest.signature_algorithm
            ),
        });
    }
    Ok(manifest)
}

/// Extrae la clave Ed25519 cruda de un PEM `SubjectPublicKeyInfo`.
///
/// Devuelve los 32 bytes de la clave. Si el PEM no es de Ed25519 o no
/// es un PEM, falla: una clave que no se entiende no se "usa como sea".
pub fn ed25519_public_key_from_pem(pem: &str) -> Result<[u8; 32], UpdateRejection> {
    let begin = pem.find("-----BEGIN PUBLIC KEY-----").ok_or_else(|| {
        UpdateRejection::PublicKeyInvalid {
            detail: "no es un PEM de clave pública".to_string(),
        }
    })?;
    let end = pem.find("-----END PUBLIC KEY-----").ok_or_else(|| {
        UpdateRejection::PublicKeyInvalid {
            detail: "el PEM de clave pública no está cerrado".to_string(),
        }
    })?;
    if end <= begin {
        return Err(UpdateRejection::PublicKeyInvalid {
            detail: "el PEM de clave pública está mal formado".to_string(),
        });
    }
    let body: String = pem[begin + "-----BEGIN PUBLIC KEY-----".len()..end]
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect();
    let der = base64::engine::general_purpose::STANDARD
        .decode(body.as_bytes())
        .map_err(|error| UpdateRejection::PublicKeyInvalid {
            detail: format!("el cuerpo del PEM no es base64: {error}"),
        })?;
    if der.len() != ED25519_SPKI_PREFIX.len() + 32 {
        return Err(UpdateRejection::PublicKeyInvalid {
            detail: format!("una clave Ed25519 en PEM ocupa 44 bytes y este ocupa {}", der.len()),
        });
    }
    if der[..ED25519_SPKI_PREFIX.len()] != ED25519_SPKI_PREFIX {
        return Err(UpdateRejection::PublicKeyInvalid {
            detail: "la clave no es Ed25519".to_string(),
        });
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&der[ED25519_SPKI_PREFIX.len()..]);
    Ok(key)
}

/// Verifica una firma Ed25519 sobre `message`.
///
/// `signature` es base64. La firma va sobre los **bytes exactos** que
/// se verifican: no se normaliza nada, no se reordena nada. Un
/// manifest que se reordena al firmarlo deja de verificar, y eso es lo
/// que tiene que pasar.
pub fn verify_signature(
    public_key_pem: &str,
    message: &[u8],
    signature: &str,
) -> Result<(), UpdateRejection> {
    let key = ed25519_public_key_from_pem(public_key_pem)?;
    let raw = base64::engine::general_purpose::STANDARD
        .decode(signature.trim().as_bytes())
        .map_err(|_| UpdateRejection::SignatureInvalid)?;
    if raw.len() != 64 {
        return Err(UpdateRejection::SignatureInvalid);
    }
    ring::signature::UnparsedPublicKey::new(&ring::signature::ED25519, &key)
        .verify(message, &raw)
        .map_err(|_| UpdateRejection::SignatureInvalid)
}

/// El SHA-256 de unos bytes, en hexadecimal minúsculas.
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Comprueba las versiones del manifest contra la app instalada.
///
/// Dos reglas, y las dos son deterministas:
///
///   · La versión ofrecida tiene que ser **posterior**. Un manifest
///     que ofrece la misma versión o una anterior no es una
///     actualización: es el camino de vuelta, y ese camino no existe.
///   · La app instalada tiene que ser **compatible**: si es más vieja
///     que la versión mínima que el manifest soporta, el manifest está
///     describiendo algo que esta app no puede asimilar.
pub fn check_versions(
    manifest: &UpdateManifest,
    current_version: &str,
) -> Result<(), UpdateRejection> {
    let offered = semver::Version::parse(&manifest.version).map_err(|error| {
        UpdateRejection::ManifestInvalid {
            detail: format!("la versión `{}` no es semver: {error}", manifest.version),
        }
    })?;
    let current = semver::Version::parse(current_version).map_err(|error| {
        UpdateRejection::ManifestInvalid {
            detail: format!("la versión instalada `{current_version}` no es semver: {error}"),
        }
    })?;
    let minimum = semver::Version::parse(&manifest.minimum_supported_version).map_err(|error| {
        UpdateRejection::ManifestInvalid {
            detail: format!(
                "la versión mínima `{}` no es semver: {error}",
                manifest.minimum_supported_version
            ),
        }
    })?;
    if offered <= current {
        return Err(UpdateRejection::VersionNotNewer {
            current: current_version.to_string(),
            offered: manifest.version.clone(),
        });
    }
    if current < minimum {
        return Err(UpdateRejection::VersionBelowMinimum {
            current: current_version.to_string(),
            minimum: manifest.minimum_supported_version.clone(),
        });
    }
    Ok(())
}

/// Verifica el manifest completo: esquema, clave, firma, versión y
/// plataforma.
///
/// Devuelve el plan de actualización cuando todo cuadra. Si algo no
/// cuadra, aborta con el motivo — y el motivo es el primer problema
/// encontrado, no el último: el orden de las comprobaciones es el del
/// módulo.
pub fn plan_update(
    contract: &UpdaterContract,
    manifest_bytes: &[u8],
    manifest_signature: &str,
    platform: &UpdatePlatform,
) -> Result<UpdatePlan, UpdateRejection> {
    contract.validate()?;
    let manifest = parse_manifest(manifest_bytes)?;
    if manifest.public_key_id != contract.public_key_id {
        return Err(UpdateRejection::PublicKeyMismatch {
            expected: contract.public_key_id.clone(),
            found: manifest.public_key_id.clone(),
        });
    }
    verify_signature(&contract.public_key_pem, manifest_bytes, manifest_signature)?;
    check_versions(&manifest, &contract.current_version)?;
    let target = select_target(&manifest, platform)?.clone();
    if !is_https(&target.url) {
        return Err(UpdateRejection::EndpointNotHttps {
            endpoint: target.url.clone(),
        });
    }
    Ok(UpdatePlan {
        version: manifest.version,
        target,
        minimum_supported_version: manifest.minimum_supported_version,
        provenance: manifest.provenance,
    })
}

/// Verifica el instalador descargado: tamaño y hash.
///
/// Se llama **después** de descargar y **antes** de instalar. La
/// firma del instalador se verifica aparte, en
/// [`verify_artifact_signature`], porque necesita la clave y porque
/// falla de otra manera: un hash que no cuadra y una firma que no
/// verifica son dos ataques distintos.
pub fn verify_artifact_hash(
    target: &UpdateTarget,
    bytes: &[u8],
) -> Result<(), UpdateRejection> {
    if bytes.len() as u64 != target.size {
        return Err(UpdateRejection::SizeMismatch {
            expected: target.size,
            found: bytes.len() as u64,
        });
    }
    let found = sha256_hex(bytes);
    if !found.eq_ignore_ascii_case(&target.sha256) {
        return Err(UpdateRejection::HashMismatch {
            expected: target.sha256.clone(),
            found,
        });
    }
    Ok(())
}

/// Verifica la firma del instalador descargado.
pub fn verify_artifact_signature(
    contract: &UpdaterContract,
    target: &UpdateTarget,
    bytes: &[u8],
) -> Result<(), UpdateRejection> {
    verify_signature(&contract.public_key_pem, bytes, &target.signature)
}

/// Descarga con reintentos, esperando entre intentos.
///
/// Los reintentos son para **operación**, nunca para criterio: si una
/// respuesta no es aceptable, no se reintenta, se aborta. Aquí lo que
/// se reintenta es el transporte (el endpoint no respondió), y lo que
/// se aborta es la verificación.
pub fn fetch_with_retry(
    transport: &dyn UpdateTransport,
    url: &str,
    timeout: Duration,
    retry: &RetryPolicy,
) -> Result<Vec<u8>, UpdateRejection> {
    let attempts = retry.max_attempts.max(1);
    let mut last: Option<UpdateRejection> = None;
    for attempt in 1..=attempts {
        let wait = retry.backoff_for(attempt);
        if !wait.is_zero() {
            std::thread::sleep(wait);
        }
        match transport.fetch(url, timeout) {
            Ok(bytes) => return Ok(bytes),
            Err(error) => {
                let retryable = matches!(
                    error,
                    UpdateRejection::EndpointUnavailable { .. } | UpdateRejection::DownloadFailed { .. }
                );
                if !retryable {
                    return Err(error);
                }
                last = Some(error);
            }
        }
    }
    Err(last.unwrap_or(UpdateRejection::EndpointUnavailable {
        detail: "sin intentos disponibles".to_string(),
    }))
}

/// El flujo completo: bajar el manifest, verificarlo y decir si hay
/// actualización.
///
/// Devuelve el plan o el motivo del aborto. No descarga el instalador:
/// esa es una segunda fase, con su propia verificación, para que la
/// descarga grande solo ocurre cuando el manifest ya ha pasado todas
/// las pruebas.
pub fn check_for_update(
    contract: &UpdaterContract,
    transport: &dyn UpdateTransport,
    platform: &UpdatePlatform,
) -> Result<UpdatePlan, UpdateRejection> {
    contract.validate()?;
    let signature_url = format!("{}.sig", contract.endpoint);
    let manifest_bytes =
        fetch_with_retry(transport, &contract.endpoint, contract.timeout(), &contract.retry)?;
    if manifest_bytes.is_empty() {
        return Err(UpdateRejection::ManifestMissing);
    }
    let signature_bytes = fetch_with_retry(
        transport,
        &signature_url,
        contract.timeout(),
        &contract.retry,
    )?;
    let signature = String::from_utf8(signature_bytes).map_err(|error| {
        UpdateRejection::ManifestInvalid {
            detail: format!("la firma no es texto: {error}"),
        }
    })?;
    plan_update(
        contract,
        &manifest_bytes,
        signature.trim(),
        platform,
    )
}

/// Si una URL es HTTPS.
pub fn is_https(url: &str) -> bool {
    url.trim().to_ascii_lowercase().starts_with("https://")
}

/// El sistema operativo donde corre la app.
pub fn current_os() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

/// La arquitectura de CPU donde corre la app.
pub fn current_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    }
}

/// El formato de instalador que usa esta plataforma.
///
/// macOS instala un `.app` empaquetado y un `.dmg`; Windows, un `.msi`
/// o un `.exe` de NSIS; Linux, un `.deb` o un `.AppImage`. La
/// plataforma no dice cuál de los dos: lo dice la build que se
/// empaquetó, y por eso el endpoint puede ofrecer los dos.
pub fn current_bundle() -> &'static str {
    if cfg!(target_os = "macos") {
        "app"
    } else if cfg!(target_os = "windows") {
        "nsis"
    } else {
        "deb"
    }
}

/// El transporte real: HTTPS y nada más.
///
/// ## Por qué no hay un transporte "de lo que sea"
///
/// El transporte es lo único que sale a la red, así que es lo único
/// que puede equivocarse de qué protocolo habla. Este solo habla
/// HTTPS: una URL que no sea `https://` se rechaza **antes** de abrir
/// la conexión, y no hay una variante "por si acaso, prueba en claro".
/// El transporte no decide nada sobre la confianza: entrega bytes y
/// el núcleo decide si son de fiar.
///
/// ## Por qué `ureq` y no el plugin de HTTP de Tauri
///
/// Porque el plugin de HTTP no viene con la app y su API cambia
/// entre versiones de Tauri. `ureq` con `rustls` verifica el
/// certificado contra las raíces del sistema y habla solo lo que hace
/// falta: una GET con un tiempo máximo. Si algún día se quiere
/// cambiar, este es el único trozo que hay que tocar: el núcleo no
/// sabe qué hay debajo de [`UpdateTransport`].
pub struct HttpsTransport {
    agent: ureq::Agent,
}

impl HttpsTransport {
    /// Un transporte con el tiempo máximo por defecto.
    pub fn new() -> Self {
        let timeout = Duration::from_millis(DEFAULT_TIMEOUT_MS);
        HttpsTransport::with_timeout(timeout)
    }

    /// Un transporte con un tiempo máximo concreto.
    pub fn with_timeout(timeout: Duration) -> Self {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(timeout)
            .timeout_read(timeout)
            .build();
        HttpsTransport { agent }
    }
}

impl Default for HttpsTransport {
    fn default() -> Self {
        HttpsTransport::new()
    }
}

impl UpdateTransport for HttpsTransport {
    fn fetch(&self, url: &str, timeout: Duration) -> Result<Vec<u8>, UpdateRejection> {
        if !is_https(url) {
            return Err(UpdateRejection::EndpointNotHttps {
                endpoint: url.to_string(),
            });
        }
        let response = self
            .agent
            .get(url)
            .timeout(timeout)
            .call()
            .map_err(|error| UpdateRejection::EndpointUnavailable {
                detail: error.to_string(),
            })?;
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut response.into_reader(), &mut bytes).map_err(|error| {
            UpdateRejection::DownloadFailed {
                detail: error.to_string(),
            }
        })?;
        Ok(bytes)
    }
}

/// Un transporte que sirve bytes desde un mapa local.
///
/// Solo existe para las pruebas: la app usa [`HttpsTransport`]. Vive
/// aquí, en vez de en el test, porque el test la necesita **como
/// contrato** —la misma firma que usa el transporte real— y duplicar
/// la firma sería copiar el criterio que hay que verificar.
#[cfg(test)]
pub struct FixtureTransport {
    /// Lo que hay en cada URL.
    pub responses: std::collections::HashMap<String, Vec<u8>>,
    /// Las URLs que se pidieron, en orden.
    pub requested: std::sync::Mutex<Vec<String>>,
}

#[cfg(test)]
impl FixtureTransport {
    /// Un transporte que sirve lo que se le da.
    pub fn new(responses: std::collections::HashMap<String, Vec<u8>>) -> Self {
        FixtureTransport {
            responses,
            requested: std::sync::Mutex::new(Vec::new()),
        }
    }

    /// Cuántas veces se ha pedido cada URL.
    pub fn request_count(&self, url: &str) -> usize {
        self.requested
            .lock()
            .map(|requested| requested.iter().filter(|seen| *seen == url).count())
            .unwrap_or(0)
    }
}

#[cfg(test)]
impl UpdateTransport for FixtureTransport {
    fn fetch(&self, url: &str, _timeout: Duration) -> Result<Vec<u8>, UpdateRejection> {
        if let Ok(mut requested) = self.requested.lock() {
            requested.push(url.to_string());
        }
        match self.responses.get(url) {
            Some(bytes) => Ok(bytes.clone()),
            None => Err(UpdateRejection::EndpointUnavailable {
                detail: format!("no hay nada en {url}"),
            }),
        }
    }
}
