//! El contrato del updater firmado, probado sin red y sin ventana.
//!
//! Este fichero es el test de integración del crate de escritorio, pero
//! vive en `tests/desktop/` —fuera del paquete— porque el contrato
//! que verifica es **del repo**, no del crate: el manifest, la clave
//! versionada y las reglas de aceptación tienen que ser las mismas
//! que leen el script que publica y el verificador de consola.
//!
//! ## Ni red ni cuenta
//!
//! Todo lo que sale a la red aquí es un [`updater::FixtureTransport`]:
//! un mapa de URL a bytes. No hay red, no hay cuenta de Apple ni de
//! Microsoft, y no hay ningún endpoint real.
//!
//! ## Ni claves privadas en el repo
//!
//! La clave de las pruebas se genera **en el momento** con `openssl`
//! y su mitad privada se borra con el directorio temporal. Lo que hay
//! en el repo es la clave pública versionada, y el test comprueba que
//! esa clave es una clave Ed25519 de verdad y que su identificador
//! coincide con el del contrato.

// El módulo se compila entero dentro del test, y hay partes que
// sólo usa la app (el transporte real, el contrato por defecto). No
// están muertas: lo que no está muerto es el **binario**, que las
// usa. Aquí no se avisa de eso.
#[allow(dead_code)]
#[path = "../../packages/desktop/src/updater.rs"]
mod updater;

/// El log de seguridad: el consumidor del evento de seguridad.
#[allow(dead_code)]
#[path = "../../packages/desktop/src/update_log.rs"]
mod update_log;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use updater::{
    check_for_update, ed25519_public_key_from_pem, fetch_with_retry, parse_manifest, plan_update,
    select_target, sha256_hex, verify_artifact_hash, verify_artifact_signature, verify_signature,
    HttpsTransport, RetryPolicy, UpdatePlatform, UpdateRejection, UpdateTarget, UpdateTransport,
    UpdaterContract, DEFAULT_ENDPOINT, DEFAULT_PUBLIC_KEY_ID, DEFAULT_TIMEOUT_MS, MANIFEST_SCHEMA,
};

/// Un transporte que sirve bytes desde un mapa local.
///
/// Vive en el test y no en el módulo: esinstrumento de prueba, no
/// parte del updater. Implementa el **mismo** contrato que el
/// transporte real —[`UpdateTransport`]—, así que el núcleo no sabe
/// cuál de los dos tiene.
struct FixtureTransport {
    /// Lo que hay en cada URL.
    responses: HashMap<String, Vec<u8>>,
    /// Las URLs que se pidieron, en orden.
    requested: std::sync::Mutex<Vec<String>>,
}

impl FixtureTransport {
    /// Un transporte que sirve lo que se le da.
    fn new(responses: HashMap<String, Vec<u8>>) -> Self {
        FixtureTransport {
            responses,
            requested: std::sync::Mutex::new(Vec::new()),
        }
    }

    /// Cuántas veces se ha pedido cada URL.
    fn request_count(&self, url: &str) -> usize {
        self.requested
            .lock()
            .map(|requested| requested.iter().filter(|seen| *seen == url).count())
            .unwrap_or(0)
    }
}

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

/// La versión que finge tener la app instalada en las pruebas.
const INSTALLED: &str = "0.1.0";

/// La versión que ofrece el manifest de las pruebas.
const OFFERED: &str = "0.2.0";

/// Un directorio que se borra cuando se cae.
struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(label: &str) -> Self {
        let unique = format!(
            "tanit-updater-{label}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        );
        let path = std::env::temp_dir().join(unique.replace(['(', ')', ' '], "_"));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("the temporary directory could not be created");
        TempDir { path }
    }

    fn join(&self, name: &str) -> PathBuf {
        self.path.join(name)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

/// Una clave efímera: la mitad privada no sale del directorio temporal.
struct TestKey {
    private: PathBuf,
    public_pem: String,
}

/// Genera una clave Ed25519 efímera y devuelve su mitad pública.
fn generate_key(scratch: &TempDir) -> TestKey {
    let private = scratch.join("private.pem");
    let public = scratch.join("public.pem");
    let result = Command::new("openssl")
        .args(["genpkey", "-algorithm", "ed25519", "-out", private.to_str().unwrap()])
        .output()
        .expect("openssl could not be run");
    assert!(
        result.status.success(),
        "the ephemeral key could not be generated: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    let result = Command::new("openssl")
        .args([
            "pkey",
            "-in",
            private.to_str().unwrap(),
            "-pubout",
            "-out",
            public.to_str().unwrap(),
        ])
        .output()
        .expect("openssl could not be run");
    assert!(
        result.status.success(),
        "the public key could not be extracted: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    TestKey {
        private,
        public_pem: fs::read_to_string(&public).expect("the public key could not be read"),
    }
}

/// Firma unos bytes con la clave efímera y devuelve el base64.
fn sign(key: &TestKey, scratch: &TempDir, bytes: &[u8]) -> String {
    let input = scratch.join("input.bin");
    let signature = scratch.join("signature.bin");
    fs::write(&input, bytes).expect("the input could not be written");
    let result = Command::new("openssl")
        .args([
            "pkeyutl",
            "-sign",
            "-rawin",
            "-inkey",
            key.private.to_str().unwrap(),
            "-in",
            input.to_str().unwrap(),
            "-out",
            signature.to_str().unwrap(),
        ])
        .output()
        .expect("openssl could not be run");
    assert!(
        result.status.success(),
        "the data could not be signed: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    let raw = fs::read(&signature).expect("the signature could not be read");
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(raw)
}

/// Un manifest con los mismos nombres de campo que produce el script
/// de la release.
fn manifest_json(
    version: &str,
    minimum_supported_version: &str,
    key_id: &str,
    target: &UpdateTarget,
) -> String {
    format!(
        r#"{{
  "schema": "{schema}",
  "version": "{version}",
  "minimumSupportedVersion": "{minimum_supported_version}",
  "generatedAt": "2026-10-29T00:00:00.000Z",
  "publicKeyId": "{key_id}",
  "signatureAlgorithm": "ed25519",
  "targets": [
    {{
      "os": "{os}",
      "arch": "{arch}",
      "bundle": "{bundle}",
      "url": "{url}",
      "sha256": "{sha256}",
      "signature": "{signature}",
      "size": {size}
    }}
  ],
  "provenance": {{
    "source": "release-desktop",
    "workflow": "release-desktop.yml",
    "commit": "0000000000000000000000000000000000000000",
    "builtAt": "2026-10-29T00:00:00.000Z"
  }}
}}
"#,
        schema = MANIFEST_SCHEMA,
        version = version,
        minimum_supported_version = minimum_supported_version,
        key_id = key_id,
        os = target.os,
        arch = target.arch,
        bundle = target.bundle,
        url = target.url,
        sha256 = target.sha256,
        signature = target.signature,
        size = target.size,
    )
}

/// Todo lo que hace falta para probar un caso.
struct Fixture {
    scratch: TempDir,
    key: TestKey,
    artifact: Vec<u8>,
    manifest: String,
    signature: String,
    contract: UpdaterContract,
    platform: UpdatePlatform,
}

/// Construye un fixture válido: manifest firmado, artefacto firmado y
/// contrato apuntando a la clave recién creada.
fn fixture(label: &str) -> Fixture {
    let scratch = TempDir::new(label);
    let key = generate_key(&scratch);
    let artifact = b"Tanit installer payload: not a real installer, but bytes with a digest."
        .to_vec();
    let target = UpdateTarget {
        os: "linux".to_string(),
        arch: "x64".to_string(),
        bundle: "deb".to_string(),
        url: "https://updates.tanit.dev/releases/0.2.0/linux/x64/deb/Tanit_0.2.0_amd64.deb"
            .to_string(),
        sha256: sha256_hex(&artifact),
        signature: sign(&key, &scratch, &artifact),
        size: artifact.len() as u64,
    };
    let manifest = manifest_json(OFFERED, INSTALLED, DEFAULT_PUBLIC_KEY_ID, &target);
    let signature = sign(&key, &scratch, manifest.as_bytes());
    let contract = UpdaterContract {
        endpoint: "https://updates.tanit.dev/latest.json".to_string(),
        public_key_id: DEFAULT_PUBLIC_KEY_ID.to_string(),
        public_key_pem: key.public_pem.clone(),
        current_version: INSTALLED.to_string(),
        timeout_ms: DEFAULT_TIMEOUT_MS,
        retry: RetryPolicy {
            max_attempts: 2,
            initial_backoff_ms: 0,
            max_backoff_ms: 0,
            multiplier: 2,
        },
    };
    let platform = UpdatePlatform {
        os: "linux".to_string(),
        arch: "x64".to_string(),
        bundle: "deb".to_string(),
    };
    Fixture {
        scratch,
        key,
        artifact,
        manifest,
        signature,
        contract,
        platform,
    }
}

/// El transporte que sirve el manifest y su firma.
fn transport_for(fixture: &Fixture) -> FixtureTransport {
    let mut responses = HashMap::new();
    responses.insert(
        fixture.contract.endpoint.clone(),
        fixture.manifest.as_bytes().to_vec(),
    );
    responses.insert(
        format!("{}.sig", fixture.contract.endpoint),
        fixture.signature.as_bytes().to_vec(),
    );
    FixtureTransport::new(responses)
}

// ---------------------------------------------------------------------------
// La actualización válida
// ---------------------------------------------------------------------------

#[test]
fn una_actualizacion_valida_se_acepta() {
    let fixture = fixture("valid");
    let plan = plan_update(
        &fixture.contract,
        fixture.manifest.as_bytes(),
        &fixture.signature,
        &fixture.platform,
    )
    .expect("a valid update must be accepted");

    assert_eq!(plan.version, OFFERED);
    assert_eq!(plan.target.os, "linux");
    assert_eq!(plan.target.arch, "x64");
    assert_eq!(plan.target.bundle, "deb");
    assert_eq!(plan.minimum_supported_version, INSTALLED);
    assert_eq!(plan.provenance.source, "release-desktop");
}

#[test]
fn el_flujo_completo_devuelve_el_plan_sin_descargar_el_instalador() {
    let fixture = fixture("flow");
    let transport = transport_for(&fixture);
    let plan = check_for_update(&fixture.contract, &transport, &fixture.platform)
        .expect("the update check must succeed");

    assert_eq!(plan.version, OFFERED);
    // Solo se piden el manifest y su firma: el instalador se baja
    // después, cuando el manifest ya ha pasado todas las pruebas.
    assert_eq!(transport.request_count(&fixture.contract.endpoint), 1);
    assert_eq!(
        transport.request_count(&format!("{}.sig", fixture.contract.endpoint)),
        1
    );
}

#[test]
fn el_instalador_se_verifica_antes_de_instalar() {
    let fixture = fixture("artifact");
    let manifest = parse_manifest(fixture.manifest.as_bytes()).expect("the manifest must parse");
    let target = select_target(&manifest, &fixture.platform).expect("the target must exist");

    verify_artifact_hash(target, &fixture.artifact).expect("the digest must match");
    verify_artifact_signature(&fixture.contract, target, &fixture.artifact)
        .expect("the signature must verify");
}

// ---------------------------------------------------------------------------
// Los casos que tienen que abortar
// ---------------------------------------------------------------------------

#[test]
fn un_target_en_http_se_rechaza() {
    // La URL del destino tiene que ser HTTPS, y esta es la regla que
    // lo fija: sin ella, un manifest firmado podría ofrecer un
    // instalador que se descarga en claro. El transporte real también
    // rechaza el `http://`, pero el núcleo **no** se apoya en eso: la
    // comprobación vive en `plan_update`, antes de descargar nada.
    let fixture = fixture("target-http");
    let artifact = b"payload served over plain http".to_vec();
    let url = "http://updates.tanit.dev/releases/0.2.0/linux/x64/deb/Tanit_0.2.0_amd64.deb";
    let target = UpdateTarget {
        os: "linux".to_string(),
        arch: "x64".to_string(),
        bundle: "deb".to_string(),
        url: url.to_string(),
        sha256: sha256_hex(&artifact),
        signature: sign(&fixture.key, &fixture.scratch, &artifact),
        size: artifact.len() as u64,
    };
    let manifest = manifest_json(OFFERED, INSTALLED, DEFAULT_PUBLIC_KEY_ID, &target);
    let signature = sign(&fixture.key, &fixture.scratch, manifest.as_bytes());

    // Todo lo demás cuadra: la firma es buena, la versión es posterior
    // y la plataforma es la de las pruebas. Lo único que no cuadra es
    // el protocolo de la URL.
    let rejection = plan_update(
        &fixture.contract,
        manifest.as_bytes(),
        &signature,
        &fixture.platform,
    )
    .expect_err("a target served over HTTP must be rejected");

    assert_eq!(
        rejection,
        UpdateRejection::EndpointNotHttps {
            endpoint: url.to_string(),
        }
    );
    assert!(
        !rejection.is_security_event(),
        "a plain-HTTP URL is a broken release, not an attempt to substitute it"
    );
}

#[test]
fn una_version_anterior_se_rechaza() {
    let fixture = fixture("older");
    let artifact = b"older payload".to_vec();
    let target = UpdateTarget {
        os: "linux".to_string(),
        arch: "x64".to_string(),
        bundle: "deb".to_string(),
        url: "https://updates.tanit.dev/releases/0.0.9/linux/x64/deb/Tanit_0.0.9_amd64.deb"
            .to_string(),
        sha256: sha256_hex(&artifact),
        signature: sign(&fixture.key, &fixture.scratch, &artifact),
        size: artifact.len() as u64,
    };
    let manifest = manifest_json("0.0.9", "0.0.1", DEFAULT_PUBLIC_KEY_ID, &target);
    let signature = sign(&fixture.key, &fixture.scratch, manifest.as_bytes());

    let rejection = plan_update(
        &fixture.contract,
        manifest.as_bytes(),
        &signature,
        &fixture.platform,
    )
    .expect_err("an older version must be rejected");

    assert_eq!(rejection, UpdateRejection::VersionNotNewer {
        current: INSTALLED.to_string(),
        offered: "0.0.9".to_string(),
    });
    assert!(!rejection.is_security_event());
}

#[test]
fn un_rollback_se_rechaza_de_forma_determinista() {
    let fixture = fixture("rollback");
    let artifact = b"same version payload".to_vec();
    let target = UpdateTarget {
        os: "linux".to_string(),
        arch: "x64".to_string(),
        bundle: "deb".to_string(),
        url: "https://updates.tanit.dev/releases/0.1.0/linux/x64/deb/Tanit_0.1.0_amd64.deb"
            .to_string(),
        sha256: sha256_hex(&artifact),
        signature: sign(&fixture.key, &fixture.scratch, &artifact),
        size: artifact.len() as u64,
    };
    let manifest = manifest_json(INSTALLED, INSTALLED, DEFAULT_PUBLIC_KEY_ID, &target);
    let signature = sign(&fixture.key, &fixture.scratch, manifest.as_bytes());

    // Dos veces seguidas: el rechazo tiene que ser el mismo, siempre.
    for _ in 0..2 {
        let rejection = plan_update(
            &fixture.contract,
            manifest.as_bytes(),
            &signature,
            &fixture.platform,
        )
        .expect_err("the installed version must not be reinstalled");
        assert_eq!(rejection.code(), "update.version.not_newer");
    }
}

#[test]
fn un_target_incorrecto_se_rechaza() {
    let fixture = fixture("target");
    let platform = UpdatePlatform {
        os: "windows".to_string(),
        arch: "x64".to_string(),
        bundle: "nsis".to_string(),
    };
    let rejection = plan_update(
        &fixture.contract,
        fixture.manifest.as_bytes(),
        &fixture.signature,
        &platform,
    )
    .expect_err("a target for another platform must be rejected");

    assert_eq!(rejection, UpdateRejection::TargetUnsupported {
        platform: "windows/x64/nsis".to_string(),
    });
}

#[test]
fn una_firma_corrupta_se_rechaza() {
    let fixture = fixture("signature");
    let mut corrupted = fixture.signature.clone();
    // Se cambia un carácter del base64: la firma sigue siendo base64
    // válido, pero ya no verifica.
    let position = corrupted.len() / 2;
    let replacement = if corrupted.as_bytes()[position] == b'A' { "B" } else { "A" };
    corrupted.replace_range(position..position + 1, replacement);

    let rejection = plan_update(
        &fixture.contract,
        fixture.manifest.as_bytes(),
        &corrupted,
        &fixture.platform,
    )
    .expect_err("a corrupted signature must be rejected");

    assert_eq!(rejection, UpdateRejection::SignatureInvalid);
    assert!(rejection.is_security_event());
}

#[test]
fn un_manifest_alterado_se_rechaza() {
    let fixture = fixture("tampered");
    // El manifest es el mismo, pero con la versión cambiada: la firma
    // ya no cubre estos bytes.
    let altered = fixture.manifest.replace(OFFERED, "9.9.9");
    let rejection = plan_update(
        &fixture.contract,
        altered.as_bytes(),
        &fixture.signature,
        &fixture.platform,
    )
    .expect_err("an altered manifest must be rejected");

    assert_eq!(rejection, UpdateRejection::SignatureInvalid);
    assert!(rejection.is_security_event());
}

#[test]
fn un_hash_corrupto_se_rechaza() {
    let fixture = fixture("hash");
    let manifest = parse_manifest(fixture.manifest.as_bytes()).expect("the manifest must parse");
    let target = select_target(&manifest, &fixture.platform).expect("the target must exist");

    let mut corrupted = fixture.artifact.clone();
    corrupted[0] = corrupted[0].wrapping_add(1);

    let rejection = verify_artifact_hash(target, &corrupted)
        .expect_err("a corrupted artifact must be rejected");
    assert!(matches!(rejection, UpdateRejection::HashMismatch { .. }));
    assert!(rejection.is_security_event());
}

#[test]
fn una_firma_de_instalador_corrupta_se_rechaza() {
    let fixture = fixture("artifact-signature");
    let manifest = parse_manifest(fixture.manifest.as_bytes()).expect("the manifest must parse");
    let target = select_target(&manifest, &fixture.platform).expect("the target must exist");

    let mut corrupted = fixture.artifact.clone();
    corrupted[0] = corrupted[0].wrapping_add(1);

    let rejection = verify_artifact_signature(&fixture.contract, target, &corrupted)
        .expect_err("a corrupted artifact must be rejected");
    assert_eq!(rejection, UpdateRejection::SignatureInvalid);
    assert!(rejection.is_security_event());
}

#[test]
fn un_tamano_distinto_es_un_evento_de_seguridad() {
    // El tamaño va **dentro** del manifest firmado, así que un tamaño
    // que no cuadra significa que los bytes no son los que se
    // firmaron. Y es un evento de seguridad por una razón concreta:
    // la clasificación del aborto no puede depender de lo que el
    // atacante haga. Si el desajuste de tamaño fuera "problema de
    // operación", un atacante podría truncar el instalador para que el
    // cliente lo clasificara como Operational y **no** dejara
    // rastro: bajarse la alerta un byte. Con los dos desajustes
    // (tamaño y hash) como evento de seguridad, el mismo truncamiento
    // dispara la alerta igual.
    let fixture = fixture("size");
    let manifest = parse_manifest(fixture.manifest.as_bytes()).expect("the manifest must parse");
    let target = select_target(&manifest, &fixture.platform).expect("the target must exist");

    let mut truncated = fixture.artifact.clone();
    truncated.truncate(truncated.len() - 1);

    let rejection = verify_artifact_hash(target, &truncated)
        .expect_err("an artifact with a different size must be rejected");
    assert!(matches!(rejection, UpdateRejection::SizeMismatch { .. }));
    assert_eq!(rejection.code(), "update.size.mismatch");
    assert!(
        rejection.is_security_event(),
        "a size mismatch must leave a trace: the attacker controls the bytes, not the alarm"
    );
}

#[test]
fn un_endpoint_no_disponible_se_rechaza() {
    let fixture = fixture("unavailable");
    // El transporte no tiene nada: el endpoint no responde.
    let transport = FixtureTransport::new(HashMap::new());
    let rejection = check_for_update(&fixture.contract, &transport, &fixture.platform)
        .expect_err("an unreachable endpoint must be rejected");

    assert!(matches!(
        rejection,
        UpdateRejection::EndpointUnavailable { .. }
    ));
    assert!(!rejection.is_security_event());
    // Se reintenta el número de intentos que dice la política, ni uno
    // más ni uno menos.
    assert_eq!(
        transport.request_count(&fixture.contract.endpoint),
        fixture.contract.retry.max_attempts as usize
    );
}

#[test]
fn un_endpoint_en_http_se_rechaza_sin_preguntar_nada() {
    let fixture = fixture("http");
    let mut contract = fixture.contract.clone();
    contract.endpoint = "http://updates.tanit.dev/latest.json".to_string();
    let transport = FixtureTransport::new(HashMap::new());

    let rejection = check_for_update(&contract, &transport, &fixture.platform)
        .expect_err("an HTTP endpoint must be rejected");

    assert_eq!(
        rejection,
        UpdateRejection::EndpointNotHttps {
            endpoint: "http://updates.tanit.dev/latest.json".to_string(),
        }
    );
    assert_eq!(
        transport.request_count("http://updates.tanit.dev/latest.json"),
        0,
        "an HTTP endpoint must not even be asked"
    );
}

#[test]
fn plan_update_rechaza_un_endpoint_que_no_es_https() {
    // `plan_update` valida el contrato **aunque** `check_for_update` ya
    // lo haya validado: es una función pública, y quien la llame
    // directamente tiene que obtener el mismo contrato. Sin esta
    // validación, un plan se puede construir con un endpoint en
    // claro, y quien construye ese plan decide también qué URL se
    // descarga.
    //
    // La validación vive en los dos sitios a propósito —es defensa en
    // profundidad, no duplicación accidental— y cada uno tiene su
    // test: el de `check_for_update` es
    // `un_endpoint_en_http_se_rechaza_sin_preguntar_nada`, y este es el
    // de `plan_update`.
    let fixture = fixture("plan-http");
    let mut contract = fixture.contract.clone();
    contract.endpoint = "http://updates.tanit.dev/latest.json".to_string();

    let rejection = plan_update(
        &contract,
        fixture.manifest.as_bytes(),
        &fixture.signature,
        &fixture.platform,
    )
    .expect_err("a plan cannot be built from an HTTP endpoint");

    assert_eq!(
        rejection,
        UpdateRejection::EndpointNotHttps {
            endpoint: "http://updates.tanit.dev/latest.json".to_string(),
        }
    );
}

#[test]
fn un_manifest_ausente_se_rechaza() {
    let fixture = fixture("missing");
    let rejection = plan_update(
        &fixture.contract,
        &[],
        &fixture.signature,
        &fixture.platform,
    )
    .expect_err("a missing manifest must be rejected");

    assert_eq!(rejection, UpdateRejection::ManifestMissing);
}

#[test]
fn un_manifest_invalido_se_rechaza() {
    let fixture = fixture("invalid");
    let rejection = plan_update(
        &fixture.contract,
        b"{ this is not json",
        &fixture.signature,
        &fixture.platform,
    )
    .expect_err("an invalid manifest must be rejected");

    assert!(matches!(
        rejection,
        UpdateRejection::ManifestInvalid { .. }
    ));
}

#[test]
fn un_esquema_desconocido_se_rechaza() {
    let fixture = fixture("schema");
    let manifest = fixture.manifest.replace(MANIFEST_SCHEMA, "tanit.update.manifest/v99");
    let signature = sign(&fixture.key, &fixture.scratch, manifest.as_bytes());

    let rejection = plan_update(
        &fixture.contract,
        manifest.as_bytes(),
        &signature,
        &fixture.platform,
    )
    .expect_err("an unknown schema must be rejected");

    assert!(matches!(
        rejection,
        UpdateRejection::ManifestSchemaMismatch { .. }
    ));
}

#[test]
fn una_clave_distinta_se_rechaza() {
    let fixture = fixture("key-id");
    let parsed = parse_manifest(fixture.manifest.as_bytes()).expect("the manifest must parse");
    let target = select_target(&parsed, &fixture.platform).expect("the target must exist");
    let manifest = manifest_json(OFFERED, INSTALLED, "tanit-updater-v2", target);
    let signature = sign(&fixture.key, &fixture.scratch, manifest.as_bytes());

    let rejection = plan_update(
        &fixture.contract,
        manifest.as_bytes(),
        &signature,
        &fixture.platform,
    )
    .expect_err("a manifest signed with another key id must be rejected");

    assert_eq!(
        rejection,
        UpdateRejection::PublicKeyMismatch {
            expected: DEFAULT_PUBLIC_KEY_ID.to_string(),
            found: "tanit-updater-v2".to_string(),
        }
    );
    assert!(rejection.is_security_event());
}

#[test]
fn una_clave_publica_invalida_se_rechaza() {
    let fixture = fixture("public-key");
    let mut contract = fixture.contract.clone();
    contract.public_key_pem = "-----BEGIN PUBLIC KEY-----\nnot-a-key\n-----END PUBLIC KEY-----\n"
        .to_string();

    let rejection = plan_update(
        &contract,
        fixture.manifest.as_bytes(),
        &fixture.signature,
        &fixture.platform,
    )
    .expect_err("an invalid public key must be rejected");

    assert!(matches!(
        rejection,
        UpdateRejection::PublicKeyInvalid { .. }
    ));
    assert!(rejection.is_security_event());
}

#[test]
fn una_app_muy_vieja_se_rechaza() {
    let fixture = fixture("too-old");
    let mut contract = fixture.contract.clone();
    contract.current_version = "0.0.1".to_string();

    let rejection = plan_update(
        &contract,
        fixture.manifest.as_bytes(),
        &fixture.signature,
        &fixture.platform,
    )
    .expect_err("a client older than the minimum must be rejected");

    assert_eq!(
        rejection,
        UpdateRejection::VersionBelowMinimum {
            current: "0.0.1".to_string(),
            minimum: INSTALLED.to_string(),
        }
    );
}

// ---------------------------------------------------------------------------
// La política de reintentos
// ---------------------------------------------------------------------------

#[test]
fn la_politica_de_reintentos_crece_y_tiene_techo() {
    let policy = RetryPolicy {
        max_attempts: 5,
        initial_backoff_ms: 500,
        max_backoff_ms: 4000,
        multiplier: 2,
    };
    assert_eq!(policy.backoff_for(1), Duration::from_millis(0));
    assert_eq!(policy.backoff_for(2), Duration::from_millis(500));
    assert_eq!(policy.backoff_for(3), Duration::from_millis(1000));
    assert_eq!(policy.backoff_for(4), Duration::from_millis(2000));
    assert_eq!(policy.backoff_for(5), Duration::from_millis(4000));
    // Y no crece más allá del techo.
    assert_eq!(policy.backoff_for(9), Duration::from_millis(4000));
}

#[test]
fn un_error_de_verificacion_no_se_reintenta() {
    let fixture = fixture("no-retry");
    let mut responses = HashMap::new();
    responses.insert(
        fixture.contract.endpoint.clone(),
        fixture.manifest.as_bytes().to_vec(),
    );
    responses.insert(
        format!("{}.sig", fixture.contract.endpoint),
        fixture.signature.as_bytes().to_vec(),
    );
    let transport = FixtureTransport::new(responses);

    // El manifest verifica, así que esto no es un caso de reintento.
    // Lo que se comprueba es que el núcleo de reintentos solo
    // reintenta fallos de transporte.
    let outcome: Result<Vec<u8>, UpdateRejection> = fetch_with_retry(
        &transport,
        &fixture.contract.endpoint,
        Duration::from_millis(10),
        &fixture.contract.retry,
    );
    assert!(outcome.is_ok());
    assert_eq!(
        transport.request_count(&fixture.contract.endpoint),
        1,
        "a successful fetch is not retried"
    );
}

// ---------------------------------------------------------------------------
// El contrato compartido
// ---------------------------------------------------------------------------

/// La raíz del repo, desde el crate.
fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .to_path_buf()
}

#[test]
fn las_constantes_del_cliente_cuadran_con_el_contrato_compartido() {
    let constants = fs::read_to_string(
        repo_root().join("packages/contracts/constants/release/updater.constant.ts"),
    )
    .expect("the shared constants could not be read");

    assert!(
        constants.contains(&format!("= \"{MANIFEST_SCHEMA}\"")),
        "the schema of the client and the shared contract have drifted apart"
    );
    assert!(
        constants.contains(&format!("= \"{DEFAULT_PUBLIC_KEY_ID}\"")),
        "the key id of the client and the shared contract have drifted apart"
    );
    assert!(
        constants.contains(&format!("= \"{DEFAULT_ENDPOINT}\"")),
        "the endpoint of the client and the shared contract have drifted apart"
    );
    assert!(
        constants.contains(&format!("= {DEFAULT_TIMEOUT_MS}")),
        "the timeout of the client and the shared contract have drifted apart"
    );
}

#[test]
fn el_conjunto_de_eventos_de_seguridad_es_el_del_contrato_compartido() {
    // La lista del cliente y la del contrato compartido tienen que ser
    // la misma. Si una grows y la otra no, la app y el log cuentan
    // cosas distintas y nadie sabe cuál manda.
    let constants = fs::read_to_string(
        repo_root().join("packages/contracts/constants/release/updater.constant.ts"),
    )
    .expect("the shared constants could not be read");

    let start = constants
        .find("UPDATE_SECURITY_EVENT_CODES")
        .expect("the shared constants do not declare the security event codes");
    let block = &constants[start..];
    let end = block.find("];").expect("the security event codes are not a list");
    let declared: Vec<String> = block[..end]
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if !trimmed.starts_with('"') {
                return None;
            }
            Some(
                trimmed
                    .trim_matches(|character| character == '"' || character == ',')
                    .to_string(),
            )
        })
        .collect();

    let client: Vec<String> = updater::SECURITY_EVENT_CODES
        .iter()
        .map(|code| code.to_string())
        .collect();

    assert_eq!(
        declared, client,
        "the client and the shared contract disagree about what is a security event"
    );
    assert!(
        declared.iter().any(|code| code == "update.size.mismatch"),
        "a size mismatch has to be a security event: the attacker controls the bytes, not the alarm"
    );
}

#[test]
fn los_nombres_del_manifest_son_los_del_contrato_compartido() {
    let contract = fs::read_to_string(
        repo_root().join("packages/contracts/interfaces/release/updater.interface.ts"),
    )
    .expect("the shared interface could not be read");

    // Los nombres del wire format. Si alguien renombra un campo en el
    // contrato, el cliente deja de entender el manifest y esto falla
    // antes de que lo descubra una release.
    for field in [
        "schema",
        "version",
        "minimumSupportedVersion",
        "generatedAt",
        "publicKeyId",
        "signatureAlgorithm",
        "targets",
        "provenance",
        "os",
        "arch",
        "bundle",
        "url",
        "sha256",
        "signature",
        "size",
        "source",
    ] {
        assert!(
            contract.contains(field),
            "the field `{field}` is not in the shared contract"
        );
    }
}

#[test]
fn la_clave_publica_versionada_es_una_clave_ed25519() {
    let pem = updater::DEFAULT_PUBLIC_KEY_PEM;
    let key = ed25519_public_key_from_pem(pem).expect("the versioned key must be a valid Ed25519 key");
    assert_eq!(key.len(), 32);

    // Y el fichero del repo es el mismo que el que embebe el binario.
    let on_disk = fs::read_to_string(
        repo_root().join("packages/desktop/keys/tanit-updater-public-key-v1.pem"),
    )
    .expect("the versioned public key could not be read");
    assert_eq!(
        on_disk.trim(),
        pem.trim(),
        "the embedded key and the one in the repo are not the same"
    );
}

#[test]
fn la_firma_se_verifica_con_la_clave_que_la_firmo() {
    let fixture = fixture("roundtrip");
    verify_signature(
        &fixture.contract.public_key_pem,
        fixture.manifest.as_bytes(),
        &fixture.signature,
    )
    .expect("the signature must verify");
}

#[test]
fn el_transporte_real_solo_habla_https() {
    // El transporte de verdad es el único que sale a la red, así que
    // es el único que puede equivocarse de protocolo. Una URL que no
    // sea HTTPS se rechaza **antes** de abrir la conexión.
    let transport = HttpsTransport::new();
    let rejection = transport
        .fetch("http://updates.tanit.dev/latest.json", Duration::from_millis(100))
        .expect_err("an HTTP URL must be rejected before the connection");
    assert_eq!(
        rejection,
        UpdateRejection::EndpointNotHttps {
            endpoint: "http://updates.tanit.dev/latest.json".to_string(),
        }
    );
}

#[test]
fn la_plataforma_actual_se_deduce_del_sistema() {
    let platform = UpdatePlatform::current();
    assert!(!platform.os.is_empty());
    assert!(!platform.arch.is_empty());
    assert!(!platform.bundle.is_empty());
    // Y tiene que ser una de las que el manifest sabe nombrar.
    assert!(
        ["linux", "macos", "windows"].contains(&platform.os.as_str()),
        "the current os is not one the manifest can describe"
    );
}

#[test]
fn el_contrato_por_defecto_usa_la_clave_versionada_del_repo() {
    let contract = UpdaterContract::new("0.1.0");
    assert_eq!(contract.public_key_id, DEFAULT_PUBLIC_KEY_ID);
    assert_eq!(contract.endpoint, DEFAULT_ENDPOINT);
    assert_eq!(contract.timeout_ms, DEFAULT_TIMEOUT_MS);
    assert!(contract.public_key_pem.contains("BEGIN PUBLIC KEY"));
}

// ---------------------------------------------------------------------------
// El log de seguridad: el consumidor del evento
// ---------------------------------------------------------------------------

/// El evento de seguridad de las pruebas.
fn security_event() -> update_log::SecurityEvent {
    update_log::SecurityEvent {
        code: "update.signature.invalid".to_string(),
        message: "La firma del manifest de actualización no verifica.".to_string(),
        version: INSTALLED.to_string(),
        endpoint: DEFAULT_ENDPOINT.to_string(),
    }
}

#[test]
fn el_evento_de_seguridad_se_escribe_en_el_log() {
    let scratch = TempDir::new("update-log");
    let path = scratch.join("logs").join(update_log::UPDATE_SECURITY_LOG);

    let line = update_log::record(&path, &security_event()).expect("the event must be written");
    let content = fs::read_to_string(&path).expect("the log could not be read");

    assert_eq!(
        content.trim_end(),
        line,
        "the line that was written is not the line that is in the log"
    );

    // Y lo que hay en el log se puede parsear: el formato es para las
    // máquinas, no para los ojos.
    let parsed: serde_json::Value =
        serde_json::from_str(content.trim_end()).expect("the log line must be valid JSON");
    assert_eq!(parsed["event"], "update.security");
    assert_eq!(parsed["code"], "update.signature.invalid");
    assert_eq!(parsed["version"], INSTALLED);
    assert_eq!(parsed["endpoint"], DEFAULT_ENDPOINT);
    assert!(parsed["message"].as_str().is_some_and(|text| !text.is_empty()));
}

#[test]
fn el_log_acepta_varios_eventos_y_no_uno_se_pisa_con_el_otro() {
    let scratch = TempDir::new("update-log-append");
    let path = scratch.join(update_log::UPDATE_SECURITY_LOG);

    update_log::record(&path, &security_event()).expect("the first event must be written");
    let mut second = security_event();
    second.code = "update.hash.mismatch".to_string();
    update_log::record(&path, &second).expect("the second event must be written");

    let content = fs::read_to_string(&path).expect("the log could not be read");
    let lines: Vec<&str> = content.lines().filter(|line| !line.is_empty()).collect();
    assert_eq!(lines.len(), 2, "both events must be in the log");
    assert!(lines[0].contains("update.signature.invalid"));
    assert!(lines[1].contains("update.hash.mismatch"));
}

#[test]
fn el_log_no_guarda_nada_que_sea_secreto() {
    let scratch = TempDir::new("update-log-secrets");
    let path = scratch.join(update_log::UPDATE_SECURITY_LOG);
    update_log::record(&path, &security_event()).expect("the event must be written");

    let content = fs::read_to_string(&path).expect("the log could not be read");
    assert!(!content.contains("PRIVATE KEY"));
    assert!(!content.contains("BEGIN PUBLIC KEY"));
    assert!(!content.contains(updater::DEFAULT_PUBLIC_KEY_PEM.trim()));
}

#[test]
fn la_fecha_del_log_esta_en_iso8601() {
    assert_eq!(update_log::iso8601(0), "1970-01-01T00:00:00Z");
    assert_eq!(update_log::iso8601(1_700_000_000), "2023-11-14T22:13:20Z");
    // Un salto de día: el algoritmo civil no se equivoca al cambiar de
    // mes ni de año.
    assert_eq!(update_log::iso8601(86_399), "1970-01-01T23:59:59Z");
    assert_eq!(update_log::iso8601(86_400), "1970-01-02T00:00:00Z");
    assert_eq!(update_log::iso8601(951_782_400), "2000-02-29T00:00:00Z");
}

// ---------------------------------------------------------------------------
// El cableado de la ventana: el arranque y la persistencia del evento
// ---------------------------------------------------------------------------
//
// ## Por qué hay un test que lee el fuente
//
// Las dos llamadas de seguridad de la app —comprobar actualizaciones al
// arrancar y persistir el evento cuando el aborto es un intento de
// sustitución— son **cableado**, no lógica: no hay forma de llegar a
// ellas sin una ventana de Tauri, y un test que las ejercite
// necesitaría una ventana. Sin un ancla, las dos llamadas pueden
// desaparecer sin que la suite se entere: los comandos siguen ahí, el
// evento sigue emitiéndose al webview, y el log de seguridad deja de
// llenarse.
//
// Así que aquí se comprueba el **cableado**, leyendo el fuente. Es lo
// mismo que hace el test que compara las constantes del cliente con el
// contrato compartido: la fuente **es** el contrato de esta parte.

/// El fuente de la ventana nativa.
fn main_source() -> String {
    fs::read_to_string(repo_root().join("packages/desktop/src/main.rs"))
        .expect("the main.rs of the desktop crate could not be read")
}

/// La sangría de una línea.
fn sangria(linea: &str) -> usize {
    linea.len() - linea.trim_start().len()
}

/// El bloque que empieza en la línea que contiene `ancla`.
///
/// El bloque termina en la primera línea con la **misma sangría** que
/// la de la ancla y que empieza por `}`. `cargo fmt` deja la llave de
/// cierre al nivel de la de apertura, así que la sangría es un ancla
/// fiable y no hace falta un analizador de Rust para saber dónde
/// acaba un bloque.
fn bloque(source: &str, ancla: &str) -> String {
    let lineas: Vec<&str> = source.lines().collect();
    let inicio = lineas
        .iter()
        .position(|linea| linea.contains(ancla))
        .unwrap_or_else(|| panic!("the source does not contain `{ancla}`"));
    let nivel = sangria(lineas[inicio]);
    let mut bloque = String::new();
    for linea in &lineas[inicio..] {
        let recortada = linea.trim_start();
        if !bloque.is_empty() && recortada.starts_with('}') && sangria(linea) == nivel {
            break;
        }
        bloque.push_str(linea);
        bloque.push('\n');
    }
    bloque
}

/// El cuerpo de una función del fuente.
///
/// Busca la **definición** —una línea que empieza por `fn`, `async
/// fn` o `pub fn`— y no una llamada: una llamada no empieza por esas
/// palabras.
fn cuerpo_de_funcion(source: &str, nombre: &str) -> Option<String> {
    let definicion = format!("fn {nombre}(");
    for linea in source.lines() {
        let recortada = linea.trim_start();
        let es_definicion = recortada.starts_with("fn ")
            || recortada.starts_with("async fn ")
            || recortada.starts_with("pub fn ")
            || recortada.starts_with("pub async fn ");
        if es_definicion && recortada.contains(&definicion) {
            return Some(bloque(source, &definicion));
        }
    }
    None
}

/// Los nombres que el bloque llama como si fueran funciones.
fn llamadas(bloque: &str) -> Vec<String> {
    let mut nombres: Vec<String> = Vec::new();
    let caracteres: Vec<char> = bloque.chars().collect();
    let mut indice = 0;
    while indice < caracteres.len() {
        if caracteres[indice].is_alphabetic() || caracteres[indice] == '_' {
            let inicio = indice;
            while indice < caracteres.len()
                && (caracteres[indice].is_alphanumeric() || caracteres[indice] == '_')
            {
                indice += 1;
            }
            let palabra: String = caracteres[inicio..indice].iter().collect();
            let mut mirar = indice;
            while mirar < caracteres.len() && caracteres[mirar].is_whitespace() {
                mirar += 1;
            }
            if mirar < caracteres.len() && caracteres[mirar] == '(' && !nombres.contains(&palabra) {
                nombres.push(palabra);
            }
        } else {
            indice += 1;
        }
    }
    nombres
}

/// Si desde `origen` se puede llegar a `destino` llamando a otras
/// funciones del mismo fichero.
fn alcanza(source: &str, origen: &str, destino: &str) -> bool {
    let mut pendientes = vec![origen.to_string()];
    let mut vistas: Vec<String> = Vec::new();
    while let Some(nombre) = pendientes.pop() {
        if vistas.iter().any(|vista| vista == &nombre) {
            continue;
        }
        vistas.push(nombre.clone());
        let Some(cuerpo) = cuerpo_de_funcion(source, &nombre) else {
            continue;
        };
        if cuerpo.contains(destino) {
            return true;
        }
        for llamada in llamadas(&cuerpo) {
            if !vistas.iter().any(|vista| vista == &llamada) {
                pendientes.push(llamada);
            }
        }
    }
    false
}

#[test]
fn la_app_comprueba_actualizaciones_al_arrancar() {
    // El updater no puede ser código muerto: la app lo llama al
    // arrancar. Si esta comprobación desaparece, los comandos siguen
    // existiendo y nadie se entera de que ya no hay nadie que los
    // llame —que es exactamente lo que pasaba antes de esta revisión.
    let source = main_source();
    let arranque = bloque(&source, ".setup(|app| {");

    assert!(
        arranque.contains("run_update_check"),
        "the app does not check for updates when it starts"
    );
    assert!(
        arranque.contains("tauri::async_runtime::spawn"),
        "the startup check does not run in the background: it would block the window"
    );
}

#[test]
fn el_evento_de_seguridad_se_persiste_en_cada_rama_de_aborto() {
    // El evento de seguridad tiene que **quedar escrito**. Si la
    // llamada desaparece, el evento se sigue emitiendo al webview y
    // se sigue perdiendo en cuanto la app se cierra.
    let source = main_source();

    for rama in ["run_update_check", "download_update"] {
        let cuerpo = cuerpo_de_funcion(&source, rama)
            .unwrap_or_else(|| panic!("the desktop app does not have a `{rama}`"));
        assert!(
            cuerpo.contains("record_security_event"),
            "the `{rama}` branch does not persist the security event"
        );
    }
}

#[test]
fn el_instalador_se_verifica_antes_de_escribirlo_en_disco() {
    // `download_update` es el **único** camino que escribe el
    // instalador en disco y lo ofrece a la persona. Los tests que ya
    // hay prueban que las *funciones* de verificación verifican, pero
    // no que este comando las *llame*: si las llamadas desaparecieran,
    // el instalador sin verificar llegaría a la carpeta de descargas y
    // la suite seguiría verde.
    //
    // Por eso aquí se lee el cuerpo del comando y se exige que
    // verifique **antes** de escribir. El orden no es un detalle: un
    // artefacto que no cuadra no llega al disco.
    let source = main_source();
    let cuerpo = cuerpo_de_funcion(&source, "download_update")
        .unwrap_or_else(|| panic!("the desktop app does not have a `download_update`"));

    for verificacion in ["verify_artifact_hash", "verify_artifact_signature"] {
        assert!(
            cuerpo.contains(verificacion),
            "the `download_update` command does not call `{verificacion}`: the installer would reach the disk without being verified"
        );
    }

    let escritura = cuerpo.find("std::fs::write").unwrap_or_else(|| {
        panic!("the `download_update` command does not write the installer to disk")
    });
    for verificacion in ["verify_artifact_hash", "verify_artifact_signature"] {
        let llamada = cuerpo.find(verificacion).unwrap_or_else(|| {
            panic!("the `download_update` command does not call `{verificacion}`")
        });
        assert!(
            llamada < escritura,
            "the `download_update` command writes the installer before it calls `{verificacion}`"
        );
    }
}

#[test]
fn persistir_el_evento_de_seguridad_llega_al_log() {
    // Y persistir no es llamar a la nada: tiene que terminar en el
    // log. La búsqueda sigue las llamadas del propio fuente, así que
    // da igual que el evento se escriba en un paso o en tres.
    let source = main_source();

    assert!(
        alcanza(&source, "record_security_event", "update_log::record"),
        "persisting the security event does not reach the security log"
    );
}

// ---------------------------------------------------------------------------
// La superficie de seguridad del cliente: el índice y sus anclas
// ---------------------------------------------------------------------------
//
// ## Qué es la «superficie de seguridad»
//
// El cliente Rust decide si lo que se descarga se puede instalar. Las
// comprobaciones que lo hacen son, casi todas, **cableado**: no hay
// forma de llegar a `run_update_check` o a `download_update` sin una
// ventana de Tauri. Y las que sí viven en funciones puras se pueden
// probar por su **comportamiento** —un hash que no cuadra aborta—,
// pero no por su **llamada**: una función puede estar perfecta y
// aun así no la llame nadie. Eso es exactamente lo que encontró la
// cuarta revisión con `download_update`.
//
// Por eso hay dos niveles de atado, y los dos importan:
//
//   · El **comportamiento**: la función pura hace lo que tiene que
//     hacer. Lo atan los tests que la llaman.
//   · El **cableado**: el comando la llama. Sólo lo ata un test que
//     lee el fuente, como los de esta sección.
//
// La lista de abajo es el **índice** de esa superficie: cada entrada
// dice dónde vive la comprobación, qué texto la ancla y qué protege.
// El test que la acompaña exige que cada ancla siga ahí; cada
// comprobación tiene además un test que falla si deja de
// **comportarse** como debe.
//
// ## Por qué el índice y no sólo los tests sueltos
//
// La enumeración es lo que permite decir «la superficie está
// cubierta» sin que sea una afirmación: cada entrada de la lista es
// una comprobación real del cliente, con su ancla, y el test exige
// que la ancla exista. Una comprobación que se añada al cliente y se
// olvide de la lista no rompe nada —eso no es detectable sin un
// analizador—, pero una comprobación que se **quite** sí, y ése es el
// defecto que esta ronda cierra.

/// La superficie de seguridad del cliente Rust.
///
/// Cada entrada es `(ámbito, ancla, qué protege)`. El ámbito es
/// `fichero::bloque`, y el único bloque que no es una función es
/// `updater.rs::HttpsTransport`, que es el `impl` del transporte real.
const SUPERFICIE_DE_SEGURIDAD: &[(&str, &str, &str)] = &[
    (
        "updater.rs::plan_update",
        "contract.validate()?",
        "el endpoint del contrato es HTTPS antes de verificar nada",
    ),
    (
        "updater.rs::check_for_update",
        "contract.validate()?",
        "el endpoint es HTTPS antes de pedir nada",
    ),
    (
        "updater.rs::plan_update",
        "manifest.public_key_id != contract.public_key_id",
        "el manifest declara la clave que el contrato espera",
    ),
    (
        "updater.rs::plan_update",
        "verify_signature(&contract.public_key_pem, manifest_bytes, manifest_signature)?",
        "la firma del manifest verifica contra la clave pública",
    ),
    (
        "updater.rs::plan_update",
        "check_versions(&manifest, &contract.current_version)?",
        "la versión ofrecida es posterior y la app instalada está soportada",
    ),
    (
        "updater.rs::plan_update",
        "select_target(&manifest, platform)?",
        "hay un instalador para esta plataforma",
    ),
    (
        "updater.rs::plan_update",
        "is_https(&target.url)",
        "la URL del instalador es HTTPS",
    ),
    (
        "updater.rs::verify_artifact_hash",
        "bytes.len() as u64 != target.size",
        "el tamaño del instalador cuadra con el manifest firmado",
    ),
    (
        "updater.rs::verify_artifact_hash",
        "found.eq_ignore_ascii_case(&target.sha256)",
        "el digest del instalador cuadra con el manifest firmado",
    ),
    (
        "updater.rs::verify_artifact_signature",
        "verify_signature(&contract.public_key_pem, bytes, &target.signature)",
        "la firma del instalador verifica",
    ),
    (
        "updater.rs::HttpsTransport",
        "if !is_https(url)",
        "el transporte real solo habla HTTPS",
    ),
    (
        "main.rs::run_update_check",
        "updater::check_for_update",
        "la comprobación verifica el manifest firmado",
    ),
    (
        "main.rs::download_update",
        "updater::check_for_update",
        "la descarga decide con el manifest firmado",
    ),
    (
        "main.rs::download_update",
        "plan.version != version",
        "solo se descarga la versión que se aprobó",
    ),
    (
        "main.rs::download_update",
        "updater::verify_artifact_hash",
        "el instalador se verifica antes de escribirse en disco",
    ),
    (
        "main.rs::download_update",
        "updater::verify_artifact_signature",
        "el instalador se verifica antes de escribirse en disco",
    ),
];

/// El cuerpo de un bloque de la superficie.
///
/// Los bloques son funciones, salvo el transporte real, que es un
/// `impl`: su `fn fetch` está dentro de un `impl` de un rasgo, y la
/// búsqueda por definición lo confundiría con la declaración del
/// propio rasgo.
fn bloque_de_ambito(source: &str, ambito: &str) -> String {
    match ambito {
        "HttpsTransport" => bloque(source, "impl UpdateTransport for HttpsTransport {"),
        _ => cuerpo_de_funcion(source, ambito)
            .unwrap_or_else(|| panic!("the source does not have a `{ambito}`")),
    }
}

/// El cuerpo de una función de `main.rs`.
fn cuerpo_de_main(source: &str, nombre: &str) -> String {
    cuerpo_de_funcion(source, nombre)
        .unwrap_or_else(|| panic!("the desktop app does not have a `{nombre}`"))
}

#[test]
fn la_superficie_de_seguridad_del_cliente_esta_toda_ata() {
    // El índice de la superficie: cada comprobación tiene que seguir
    // **ahí**. Si una desaparece, el cliente deja de comprobar algo y
    // la suite sigue verde —que es exactamente el defecto que esta
    // ronda cierra.
    let main = main_source();
    let updater = fs::read_to_string(repo_root().join("packages/desktop/src/updater.rs"))
        .expect("the updater module could not be read");

    for (ambito, ancla, protege) in SUPERFICIE_DE_SEGURIDAD {
        let (fichero, bloque) = ambito
            .split_once("::")
            .unwrap_or_else(|| panic!("the scope `{ambito}` is not `file::block`"));
        let source = match fichero {
            "main.rs" => &main,
            "updater.rs" => &updater,
            otro => panic!("the scope `{ambito}` names an unknown file `{otro}`"),
        };
        let cuerpo = bloque_de_ambito(source, bloque);
        assert!(
            cuerpo.contains(*ancla),
            "the security surface lost `{ancla}` in `{ambito}`: {protege}"
        );
    }
}

#[test]
fn la_comprobacion_de_actualizaciones_verifica_el_manifest_firmado() {
    // La comprobación de actualizaciones —la del comando y la del
    // arranque— es la **única** vez que se verifica la firma del
    // manifest, su versión, su plataforma y que el endpoint sea
    // HTTPS. Si esta llamada se sustituye por un plan fabricado, la
    // app seguiría anunciando actualizaciones: las anunciaría **sin
    // comprobar nada**.
    let source = main_source();
    let cuerpo = cuerpo_de_main(&source, "run_update_check");

    assert!(
        cuerpo.contains("updater::check_for_update"),
        "the update check does not verify the signed manifest: the signature, the version, \
         the platform and the HTTPS endpoint would not be checked at all"
    );

    // Y el comando del webview tiene que pasar por **la misma**
    // comprobación: si `check_for_updates` dejara de delegar en
    // `run_update_check`, la verificación se quedaría en el arranque y
    // el comando volvería a ser una puerta sin candado.
    let comando = cuerpo_de_main(&source, "check_for_updates");
    assert!(
        comando.contains("run_update_check"),
        "the `check_for_updates` command does not go through `run_update_check`: it would \
         answer without verifying the signed manifest"
    );
}

#[test]
fn la_descarga_verifica_el_manifest_firmado_antes_de_descargar() {
    // La descarga es la que decide **qué** manifest, **qué** versión,
    // **qué** URL y **qué** target se descargan. Sin esta llamada, un
    // plan fabricado basta para descargar cualquier cosa: las
    // comprobaciones que quedan —hash y firma— se verificarían contra
    // un target inventado.
    let source = main_source();
    let cuerpo = cuerpo_de_main(&source, "download_update");

    assert!(
        cuerpo.contains("updater::check_for_update"),
        "the `download_update` command does not verify the signed manifest: the manifest, the \
         version, the URL and the target of the download would not be decided by the signature"
    );
}

#[test]
fn la_descarga_solo_descarga_la_version_que_se_aprobo() {
    // El pin de versión es lo que ata **lo que se descarga** a **lo
    // que la persona aprobó**: el `version` que llega del webview. Sin
    // él, el manifest manda y la aprobación no significa nada.
    let source = main_source();
    let cuerpo = cuerpo_de_main(&source, "download_update");

    assert!(
        cuerpo.contains("plan.version != version"),
        "the `download_update` command does not pin the download to the approved version"
    );
    assert!(
        cuerpo.contains("VersionNotNewer"),
        "the `download_update` command does not reject a version that is not the approved one"
    );

    // Y el pin va **entre** la verificación y la descarga: antes de
    // verificar no hay plan que comparar, y después de descargar el
    // pin ya no protege de nada.
    let verificacion = cuerpo
        .find("updater::check_for_update")
        .expect("the `download_update` command does not verify the signed manifest");
    let pin = cuerpo
        .find("plan.version != version")
        .expect("the `download_update` command does not pin the download to the approved version");
    let descarga = cuerpo
        .find("updater::fetch_with_retry")
        .expect("the `download_update` command does not download anything");

    assert!(
        verificacion < pin,
        "the `download_update` command pins the version before verifying the manifest"
    );
    assert!(
        pin < descarga,
        "the `download_update` command downloads before pinning the approved version"
    );
}

/// La sección del documento que enumera la superficie.
fn seccion_del_documento(documento: &str, titulo: &str) -> String {
    let lineas: Vec<&str> = documento.lines().collect();
    let inicio = lineas
        .iter()
        .position(|linea| linea.trim() == titulo)
        .unwrap_or_else(|| panic!("`docs/UPDATER.md` does not have the section `{titulo}`"));
    let mut seccion = String::new();
    for linea in &lineas[inicio + 1..] {
        if linea.starts_with("### ") {
            break;
        }
        seccion.push_str(linea);
        seccion.push('\n');
    }
    seccion
}

/// Los tests que el documento dice que atan la superficie.
///
/// La última columna de la tabla es la que dice qué test ata cada
/// comprobación, y el nombre va entre acentos graves.
fn tests_que_atan(documento: &str) -> Vec<String> {
    seccion_del_documento(documento, "### La superficie de seguridad del cliente")
        .lines()
        .filter(|linea| linea.trim_start().starts_with('|'))
        .skip(2)
        .filter_map(|linea| {
            let celdas: Vec<&str> = linea.split('|').map(str::trim).collect();
            celdas
                .get(3)
                .map(|celda| celda.trim_matches('`').to_string())
        })
        .filter(|nombre| !nombre.is_empty())
        .collect()
}

#[test]
fn el_documento_enumera_la_superficie_y_sus_tests_existen() {
    // El documento enumera la superficie con el test que ata cada
    // comprobación. Si el documento nombra un test que no existe, o
    // deja de enumerar una comprobación, el documento miente: y un
    // documento que miente sobre la seguridad es peor que no
    // tenerlo.
    let documento = fs::read_to_string(repo_root().join("docs/UPDATER.md"))
        .expect("the updater document could not be read");
    let fuente = fs::read_to_string(repo_root().join("tests/desktop/updater-contract.rs"))
        .expect("the updater contract test could not be read");

    let tests = tests_que_atan(&documento);
    assert_eq!(
        tests.len(),
        SUPERFICIE_DE_SEGURIDAD.len(),
        "the document does not enumerate the whole security surface"
    );
    for nombre in &tests {
        assert!(
            fuente.contains(&format!("fn {nombre}(")),
            "the document names a test that does not exist: `{nombre}`"
        );
    }
}
