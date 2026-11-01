<#
.SYNOPSIS
    Signs the Windows installers with Authenticode, or verifies a signed one.

.DESCRIPTION
    ## Lo que no se negocia

      · `/fd SHA256` — el digest del firma es SHA-256. SHA-1 está
        deprecated y Windows lo rechaza.
      · `/tr <url>` — **timestamp RFC 3161**. Sin timestamp, la firma
        caduca cuando caduca el certificado, y el instalador deja de
        pasar SmartScreen en la máquina que lo instala.
      · `/td SHA256` — el digest del timestamp también.
      · `/pa` al verificar — la cadena de Authenticode se valida contra
        las raíces de confianza del sistema, no contra un certificado
        cualquiera.

    ## Los dos maneras de tener un certificado

      · **EV / Code Signing** en el almacén de Windows: se firma con el
        *thumbprint* (`TANIT_SIGN_WINDOWS_THUMBPRINT`).
      · **Azure Trusted Signing**: se firma contra la cuenta del
        servicio (`TANIT_SIGN_WINDOWS_TRUSTED_SIGNING_ACCOUNT`) con
        `/az`, sin que el certificado llegue a existir en la máquina.

    ## El recibo

    Tras **firmar**, el script escribe `<artefacto>.signature.json` con
    el signer, el thumbprint y el digest **del artefacto ya firmado**.
    Es lo que ata la firma a los bytes que se publican: si el fichero
    cambia después, el digest deja de cuadrar y el verificador lo nota
    sin necesitar el certificado.

    ## Verificar no escribe nada

    `-Verify` **sólo lee**. Un verificador que reescribe el recibo que
    está verificando deja de estar verificando: después de pasar, el
    recibo describe los bytes de ahora, no los que se firmaron, y la
    comprobación que el recibo existe se vuelve tautológica. Por eso
    la escritura del recibo es cosa de quien firma, y el verificador
    no deja ni un fichero detrás.

    ## Los valores no se imprimen

    Ni la contraseña del PFX ni ningún secreto: un log de CI es un
    sitio público.

.PARAMETER Artifact
    The installers to sign (or to verify).

.PARAMETER Verify
    Verify instead of sign. The verification reads the signer, the
    timestamp and the status from the artifact itself, and writes
    nothing.

.EXAMPLE
    scripts/release/sign-windows.ps1 Tanit_0.2.0_x64_en-US.msi

.EXAMPLE
    scripts/release/sign-windows.ps1 -Verify Tanit_0.2.0_x64_en-US.msi
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string[]] $Artifact,

    [Parameter(Mandatory = $false)]
    [switch] $Verify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail([string] $Message) {
    Write-Error "✗ $Message"
    exit 1
}

function Write-Note([string] $Message) {
    Write-Output "→ $Message"
}

function Get-Sha256([string] $Path) {
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-SignerName($Signature) {
    if ($null -eq $Signature.SignerCertificate) { return "" }
    return $Signature.SignerCertificate.Subject
}

function Get-KeyId($Signature) {
    if ($null -eq $Signature.SignerCertificate) { return "" }
    return $Signature.SignerCertificate.Thumbprint
}

# --- signing ----------------------------------------------------------------

function Invoke-Sign([string] $Path) {
    $thumbprint = $env:TANIT_SIGN_WINDOWS_THUMBPRINT
    $timestamp = $env:TANIT_SIGN_WINDOWS_TIMESTAMP_URL
    $account = $env:TANIT_SIGN_WINDOWS_TRUSTED_SIGNING_ACCOUNT
    $pfx = $env:TANIT_SIGN_WINDOWS_CERTIFICATE

    if ([string]::IsNullOrWhiteSpace($timestamp)) {
        Fail "TANIT_SIGN_WINDOWS_TIMESTAMP_URL is not set: a signature without an RFC 3161 timestamp expires with the certificate"
    }

    if (-not [string]::IsNullOrWhiteSpace($pfx)) {
        if (-not (Test-Path -LiteralPath $pfx)) { Fail "The certificate file does not exist: $pfx" }
        $password = $env:TANIT_SIGN_WINDOWS_CERTIFICATE_PASSWORD
        if ([string]::IsNullOrWhiteSpace($password)) { Fail "TANIT_SIGN_WINDOWS_CERTIFICATE_PASSWORD is not set" }
        $secure = ConvertTo-SecureString -String $password -AsPlainText -Force
        $imported = Import-PfxCertificate -FilePath $pfx -CertStoreLocation Cert:\CurrentUser\My -Password $secure
        Write-Note "Imported certificate $($imported.Thumbprint)"
        if ([string]::IsNullOrWhiteSpace($thumbprint)) { $thumbprint = $imported.Thumbprint }
    }

    $arguments = @("sign", "/fd", "SHA256", "/td", "SHA256", "/tr", $timestamp)

    if (-not [string]::IsNullOrWhiteSpace($account)) {
        # Azure Trusted Signing: el certificado no vive en la máquina.
        $arguments += @("/az", $account)
    }
    elseif (-not [string]::IsNullOrWhiteSpace($thumbprint)) {
        $arguments += @("/sha1", $thumbprint)
    }
    else {
        Fail "No signing identity: set TANIT_SIGN_WINDOWS_THUMBPRINT or TANIT_SIGN_WINDOWS_TRUSTED_SIGNING_ACCOUNT"
    }

    $arguments += $Path

    Write-Note "Signing: $Path"
    & signtool @arguments
    if ($LASTEXITCODE -ne 0) { Fail "signtool failed with exit code $LASTEXITCODE" }
}

# --- verification -----------------------------------------------------------

function Invoke-Verify([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path)) { Fail "The artifact does not exist: $Path" }

    $signature = Get-AuthenticodeSignature -FilePath $Path
    $status = $signature.Status.ToString()

    & signtool verify /pa /all /v $Path | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "signtool could not verify $Path (exit code $LASTEXITCODE)" }

    if ($status -ne "Valid") { Fail "The Authenticode signature of $Path is $status" }
    if ($null -eq $signature.TimeStamperCertificate) {
        Fail "The signature of $Path has no RFC 3161 timestamp"
    }

    $signer = Get-SignerName $signature
    if ([string]::IsNullOrWhiteSpace($signer)) { Fail "The signature of $Path does not name a signer" }

    Write-Note "Verified: $Path (signer: $signer, timestamped: $($signature.TimeStamperCertificate.Subject))"
}

# --- el recibo --------------------------------------------------------------
#
# Escribir el recibo es cosa de quien **firma**, no de quien verifica.
# Un verificador que reescribe el recibo que está verificando deja de
# estar verificando: después de pasar, el recibo describe los bytes de
# ahora, no los que se firmaron, y la comprobación de que el recibo
# existe se vuelve tautológica.

function Write-Receipt([string] $Path, [string] $ReceiptPath) {
    $signature = Get-AuthenticodeSignature -FilePath $Path

    $receipt = @{
        kind         = "authenticode"
        signer       = (Get-SignerName $signature)
        keyId        = (Get-KeyId $signature)
        timestamped  = $true
        sha256       = (Get-Sha256 $Path)
    }
    $receipt | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ReceiptPath -Encoding utf8
    Write-Note "Receipt: $ReceiptPath"
}

# --- entry point ------------------------------------------------------------

foreach ($path in $Artifact) {
    if (-not (Test-Path -LiteralPath $path)) { Fail "The artifact does not exist: $path" }

    if ($Verify) {
        # Verificar no escribe nada: ni en el staging ni en ningún
        # sitio. Lo único que hace es leer.
        Invoke-Verify $path
    }
    else {
        Invoke-Sign $path
        Invoke-Verify $path
        # El recibo se escribe **después** de firmar, con el digest de
        # los bytes ya firmados: es esos bytes los que se publican.
        Write-Receipt $path "$path.signature.json"
    }
}

Write-Output "✔ Done."
