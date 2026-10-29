# SBOM y provenance — qué se publica con cada release

Cada release de Tanit publica tres documentos de transparencia:

| Documento | Fichero | Para qué |
| --- | --- | --- |
| **SBOM** | `Tanit_<versión>-<os>-<arch>.cdx.json` | Decir **qué lleva** el binario: componentes, versiones, hashes y el grafo de dependencias. |
| **Provenance** | `Tanit_<versión>-<os>-<arch>.provenance.json` | Decir **de dónde vino** la build: el statement SLSA, en claro. |
| **Attestation** | `Tanit_<versión>-<os>-<arch>.intoto.jsonl` | Lo mismo, **firmado**: el envelope DSSE con la firma Ed25519 sobre el payload. |

Hay un juego por plataforma, porque los binarios son distintos. Los tres
se publican **junto a los instaladores**, en la misma release, y la
publicación **falla cerrada** si falta alguno.

---

## Quién consume esto

| Consumidor | Qué necesita | Dónde lo encuentra |
| --- | --- | --- |
| El equipo de seguridad de quien despliega Tanit | Saber qué hay dentro del binario que va a producción | El `.cdx.json` de su plataforma |
| Un scanner de vulnerabilidades (Dependency-Track, Grype, Trivy, OpenSCAP) | Un inventario con purls y hashes | El `.cdx.json`: se puede subir tal cual |
| Un auditor de supply chain | Evidencia de que el binario es el que se construyó desde el commit que dice | El `.intoto.jsonl` más el `release-manifest.json` |
| El updater | Saber que el instalador que ofrece es el que describe el SBOM | La validación mutua entre el manifest del updater y el SBOM |
| El equipo que responde a un incidente | "¿esto lleva la versión vulnerable de X?" | Una consulta al SBOM, sin descarga |

El SBOM se publica **en la release**, no en un servicio aparte: es un
activo versionado junto a los binarios que describe, y por eso se puede
descargar, archivar y auditar años después.

---

## El formato: CycloneDX 1.6

El documento es [CycloneDX](https://cyclonedx.org/) JSON en la versión
**1.6**. Los campos que un verificador tiene que encontrar:

| Campo | Qué es |
| --- | --- |
| `bomFormat` | `"CycloneDX"`. |
| `specVersion` | `"1.6"`. |
| `serialNumber` | `urn:uuid:<uuid>`, único por documento. |
| `version` | La versión del **documento**, no la del producto. |
| `metadata.timestamp` | Cuándo se generó. |
| `metadata.component` | El componente raíz: la ventana de escritorio. |
| `metadata.supplier` | Quién es responsable del software, cuando se sabe. |
| `metadata.lifecycles` | `build`: el documento describe el resultado de una build. |
| `components[]` | Todo lo que lleva el binario. |
| `dependencies[]` | El grafo: quién depende de quién. |

Cada componente lleva un `bom-ref`, que es su identidad estable dentro
del documento, y un `purl` cuando tiene uno. Los `bom-ref` son:

| Clase | Forma | Ejemplo |
| --- | --- | --- |
| Artefacto de la release | `file:<ruta>` | `file:linux/x64/deb/Tanit_1.0.0_x64.deb` |
| Crate de Rust | `pkg:cargo/<nombre>@<versión>` | `pkg:cargo/ring@0.17.14` |
| Paquete de npm | `pkg:npm/<nombre>@<versión>` | `pkg:npm/zod@4.6.7` |
| Producto | `pkg:generic/tanit-<pieza>@<versión>` | `pkg:generic/tanit-apisrc@1.0.0` |
| Biblioteca nativa | `pkg:generic/<nombre>` | `pkg:generic/libwebkit2gtk-4.1` |

### Qué contiene

- **Tanit Desktop**: el componente raíz, con su versión.
- **El sidecar `apisrc`**: el binario que va dentro del instalador y
  habla con el proyecto del usuario. Es la mitad del producto.
- **El grafo de Rust**: las crates que entran de verdad en el binario de
  la ventana, sacadas de `packages/desktop/Cargo.lock`, con su versión
  resuelta y el checksum del `.crate`. Las de `[build-dependencies]` y
  `[dev-dependencies]` —`tauri-build` y compañía— **no** se declaran:
  se resuelven en el lockfile como cualquier otra, pero no viajan
  dentro del producto, y declararlas sería decir que el binario lleva
  dentro un compilador de crates.
- **Las herramientas de build**, declaradas como lo que son: `patchelf`
  la usa el runner de Linux para reescribir el ELF del binario, no va
  dentro del producto, y el SBOM lo dice con la propiedad
  `tanit:build-tool: not packaged`.
- **El grafo de Bun**: los paquetes que entran de verdad en el sidecar.
  `bun build --compile` mete dentro el cierre transitivo de las
  dependencias de runtime del CLI —`zod`, `@babel/parser` y
  `@babel/types`—, y eso es lo que el SBOM lista. Las 1070 entradas del
  lockfile incluyen el compilador de Angular y el runner de tests, que
  no viajan en el binario: un SBOM que las listara diría que se
  distribuye un compilador de TypeScript.
- **Las bibliotecas nativas** que la app enlaza contra el sistema, por
  plataforma.

### Qué no contiene, nunca

Secretos, claves privadas, certificados privados, credenciales y
ficheros temporales. No es una cortesía: si uno de esos ficheros está
en el staging, **la release se para**. Un staging con una clave privada
dentro es un staging que publica una clave privada, y un SBOM que no la
menciona no lo evita: sólo esconde la prueba.

Los patrones están en
[`packages/contracts/constants/release/sbom.constant.ts`](../packages/contracts/constants/release/sbom.constant.ts)
y cubren claves (`.pem`, `.key`, `.p12`, `.pfx`, `id_ed25519`), credenciales
(`.env`, `.netrc`, `*credential*`, `*secret*`, `*token*`) y temporales
(`.tmp`, `.partial`, `*~`, `.swp`).

### La límite honesta

Las bibliotecas nativas son la parte menos precisa del documento: la
lista sale de lo que la app **enlaza** contra el sistema, no de un
escaneo del binario firmado, y su versión es `system` porque el número
lo pone el sistema operativo. Un escaneo del binario daría el mismo
conjunto con peor resolución, y no distinguiría una biblioteca del
sistema de una que va empaquetada. Las crates y los paquetes de npm, en
cambio, salen de los lockfiles: son exactos.

---

## Consultas comunes

El documento es JSON: `jq` basta, y no hace falta instalar nada.

**¿Qué lleva el binario?**

````bash
jq -r '.components[] | "\(.name)@\(.version)"' Tanit_1.0.0-linux-x64.cdx.json
````

**¿Qué versión de una dependencia concreta lleva?**

````bash
jq -r '.components[] | select(.name == "ring") | .version' Tanit_1.0.0-linux-x64.cdx.json
````

**¿Hay alguna dependencia con una versión concreta?** (para cruzar con
un aviso de CVE)

````bash
jq -r --arg v "0.17.14" '.components[] | select(.version == $v) | .name' Tanit_1.0.0-linux-x64.cdx.json
````

**¿De qué depende el sidecar?**

````bash
jq -r --arg ref "pkg:generic/tanit-apisrc@1.0.0" \
  '.dependencies[] | select(.ref == $ref) | .dependsOn[]' Tanit_1.0.0-linux-x64.cdx.json
````

**¿Qué dependencias tiene tal componente?**

````bash
jq -r --arg ref "pkg:cargo/ring@0.17.14" \
  '.dependencies[] | select(.ref == $ref) | .dependsOn[]' Tanit_1.0.0-linux-x64.cdx.json
````

**¿Los hashes del SBOM cuadran con los del manifest de la release?**

````bash
jq -r '.artifacts[] | "\(.sha256)  \(.path)"' release-manifest.json
jq -r '.components[] | select(."bom-ref" | startswith("file:")) |
  "\(.hashes[0].content)  \(."bom-ref" | ltrimstr("file:"))"' Tanit_1.0.0-linux-x64.cdx.json
````

Las dos listas tienen que coincidir **fichero a fichero**. El
verificador lo comprueba, y falla si no.

---

## La correlación con el manifest y con los checksums

Los tres documentos de una release hablan de los mismos bytes, y cada
uno los ancla a su manera:

| Documento | Qué ancla | Cómo se ancla |
| --- | --- | --- |
| `release-manifest.json` | El artefacto final | SHA-256 recalculado, más la firma de su plataforma |
| `SHA256SUMS` (Linux) | Los artefactos de la plataforma | `sha256sum`, y el fichero va firmado con GPG |
| El SBOM | Los componentes | SHA-256 de los artefactos, SHA-512 de los tarballs de npm, el checksum del lockfile en las crates |
| La attestation | El SBOM y los artefactos | El statement SLSA los declara como *subjects*, con su digest |

La regla es que **el hash se recalcula, no se copia**: el manifest lo
mide sobre el fichero, el verificador del SBOM lo vuelve a medir, y la
attestation lo declara como sujeto firmado. Si dos de los tres no
coinciden, hay un fichero que cambió después de firmarse, y la release
no sale.

### La validación mutua con el updater

El manifest que ofrece el updater (`latest.json`, firmado con Ed25519)
dice, por destino, el SHA-256 del instalador. El verificador del SBOM
compara ese hash con el del artifact del manifest de la release y con
el del componente del SBOM:

```
latest.json (S3) ──sha256──► release-manifest.json (S2) ──sha256──► SBOM (S4)
```

Si los tres no dicen lo mismo, el updater está ofreciendo algo que el
SBOM no describe, y el cliente instalaría un binario que nadie ha
auditado.

### La attestation y la provenance

La **provenance** es el statement SLSA en claro: se lee, se indexa y se
compara sin herramientas. La **attestation** es el mismo statement
dentro de un envelope DSSE, con la firma encima.

La firma es Ed25519 sobre el PAE de DSSE (`DSSEv1 <len> <tipo> <len>
<payload>`), que es lo que firman `actions/attest-build-provenance` y
`cosign`. La clave privada vive en el almacén de secretos del CI y sale
de él un momento; la clave pública es la que verifica.

Los *subjects* del statement son el **SBOM** y los **artefactos**. Por
eso una attestation de otra build no sirve aquí: su subject es otro
SBOM, con otro digest, y el verificador lo dice.

---

## Retención

| Documento | Retención | Por qué |
| --- | --- | --- |
| SBOM, provenance y attestation | **De por vida**, junto a la release | Son la evidencia de qué se publicó. Una release sin SBOM no se puede auditar cinco años después. |
| `release-manifest.json` | De por vida | Es la medición de lo que se adjuntó. |
| `SHA256SUMS` y su firma | De por vida | Son la prueba de los checksums de Linux. |
| Clave pública de attestation | De por vida, versionada | Sin la clave pública, una attestation de hace tres años no se puede verificar. |

La release de la que forman parte es la que se conserva. Mientras la
release exista en el hosting, el SBOM existe con ella.

La clave de attestation se **rota con versión**: la nueva tiene otro
identificador (`tanit-release-attestation-v1` → `-v2`) y las dos claves
públicas conviven hasta que la primera deja de servir para verificar.

---

## Revalidación: el procedimiento del auditor

Este es el camino que sigue quien recibe un `Tanit_1.0.0-linux-x64.deb`
y quiere saber qué es y de dónde viene. Todo es local: sin red y sin
cuentas.

### 1. Reúne los cuatro documentos

De la release: el instalador, el `release-manifest.json`, el
`Tanit_1.0.0-linux-x64.cdx.json` y el
`Tanit_1.0.0-linux-x64.intoto.jsonl`.

### 2. Comprueba el hash del instalador

````bash
sha256sum Tanit_1.0.0_x64.deb
jq -r '.artifacts[] | select(.path | endswith(".deb")) | .sha256' release-manifest.json
````

Los dos valores tienen que ser iguales. Si no lo son, el binario que
tienes no es el que se publicó: para.

### 3. Verifica el SBOM entero

````bash
bun scripts/release/verify-sbom.mjs \
  --sbom Tanit_1.0.0-linux-x64.cdx.json \
  --attestation Tanit_1.0.0-linux-x64.intoto.jsonl \
  --stage <el staging con los ficheros de la release> \
  --manifest release-manifest.json \
  --public-key tanit-release-attestation-v1.pub.pem \
  --key-id tanit-release-attestation-v1
````

El verificador **recalcula** los hashes desde el staging, comprueba el
schema, que estén los componentes obligatorios, que el grafo esté
completo, que la firma de la attestation verifique, que el `keyid` sea el
esperado y que la provenance sea de esta build. Sale con código 0 si
todo cuadra y con código 1, explicando qué no, si no.

### 4. Comprueba la firma de la plataforma

En Linux, la firma GPG del `SHA256SUMS` y la de cada artefacto se
verifican contra el keyring publicado en la propia release:

````bash
gpg --no-default-keyring --keyring tanit-release-keyring.gpg --verify SHA256SUMS.sig SHA256SUMS
````

En macOS, `codesign --verify --strict` y el ticket de notarización
grapado; en Windows, `Get-AuthenticodeSignature`. Lo que importa es que
el `signer` y el `keyId` que dice el manifest son los que aparecen en
el binario.

### 5. Correlaciona con el manifest del updater

Si la release actualizó el instalador, el `latest.json` que el cliente
consume dice el mismo SHA-256 por destino. El verificador del SBOM lo
comprueba solo cuando se le pasa `--update-manifest`.

### 6. Lee el SBOM

Con las consultas de arriba: qué lleva, qué versiones, qué grafo.

### 7. Comprueba la cobertura

Un SBOM que no declara una dependencia que el binario sí lleva es un
SBOM incompleto. El verificador lo comprueba contra las fuentes —el
`Cargo.toml` del escritorio y las raíces de runtime del sidecar—, así
que un SBOM al que le falte una dependencia directa no pasa. Un SBOM
puede estar incompleto en la cola del grafo (una dependencia transitiva
que nadie declara), y eso no lo detecta ninguna herramienta sin
analizar el binario.

---

## Lo que este SBOM **no** dice

- **No dice que el código sea seguro.** Dice qué hay. El juicio es de
  quien audita.
- **No es una firma.** La firma va en la attestation, y el SBOM es lo
  que la attestation firma.
- **No sustituye a la verificación de la plataforma.** El SBOM no
  comprueba que el `.msi` esté firmado por Microsoft; eso lo dice el
  manifest y lo comprueba `verify-signature.sh`.
- **No cubre las bibliotecas nativas con su versión.** Las del sistema
  las versiona el sistema operativo, no la release.

---

## Lo que este SBOM **sí** hace

Un binario de una release de Tanit lleva delante un inventario
verificable de su contenido, una provenance firmada que dice de dónde
vino, y un verificador que **falla cerrado** cuando algo de eso no
cuadra. La publicación de la release depende de que los tres estén y de
que el verificador los acepte: no es un documento adjunto, es una
condición para publicar.

---

## Ver también

- [`docs/RELEASE.md`](RELEASE.md) — la pipeline de release, las firmas y
  las credenciales.
- [`docs/UPDATER.md`](UPDATER.md) — el updater firmado y el manifest que
  consume.
- [`SECURITY.md`](../SECURITY.md) — el threat model, el reporte privado
  y las versiones soportadas.
