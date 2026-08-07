# expostman — lanzador para Windows.
#
# Mismo contrato que `bin/expostman`: cero lógica de dominio, solo
# resolver el motor y pasarle los argumentos.
#
# Orden: binario cacheado → instalado en PATH → bunx/npx → descarga.
$ErrorActionPreference = "Stop"

$CacheDir = if ($env:EXPOSTMAN_HOME) { $env:EXPOSTMAN_HOME } else { Join-Path $HOME ".expostman" }
$Cached = Join-Path $CacheDir "expostman.exe"
$Repo = "CartagoGit/export-to-postman"

if (Test-Path $Cached) {
  & $Cached @args
  exit $LASTEXITCODE
}

# `Get-Command` encuentra también este mismo .ps1, así que se filtra por
# tipo: solo vale un ejecutable de verdad.
$Installed = Get-Command expostman -CommandType Application -ErrorAction SilentlyContinue
if ($Installed) {
  & $Installed.Source @args
  exit $LASTEXITCODE
}

foreach ($runner in @("bunx", "npx")) {
  if (Get-Command $runner -ErrorAction SilentlyContinue) {
    & $runner "export-to-postman" @args
    exit $LASTEXITCODE
  }
}

$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
$Asset = "expostman-windows-$Arch.exe"
$Url = "https://github.com/$Repo/releases/latest/download/$Asset"

Write-Host "expostman: no encontrado; descargando $Asset..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
Invoke-WebRequest -Uri $Url -OutFile $Cached -UseBasicParsing

& $Cached @args
exit $LASTEXITCODE
