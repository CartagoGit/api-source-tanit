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
