# apisrc — lanzador para Windows.
#
# Mismo contrato que `bin/apisrc`: cero lógica de dominio, solo
# resolver el motor y pasarle los argumentos.
#
# Orden: binario cacheado → instalado en PATH → bunx/npx → descarga.
$ErrorActionPreference = "Stop"

$CacheDir = if ($env:APISRC_HOME) { $env:APISRC_HOME } else { Join-Path $HOME ".apisrc" }
$Cached = Join-Path $CacheDir "apisrc.exe"
$Repo = "CartagoGit/api-source-tanit"

if (Test-Path $Cached) {
  & $Cached @args
  exit $LASTEXITCODE
}

# `Get-Command` encuentra también este mismo .ps1, así que se filtra por
# tipo: solo vale un ejecutable de verdad.
$Installed = Get-Command apisrc -CommandType Application -ErrorAction SilentlyContinue
if ($Installed) {
  & $Installed.Source @args
  exit $LASTEXITCODE
}

foreach ($runner in @("bunx", "npx")) {
  if (Get-Command $runner -ErrorAction SilentlyContinue) {
    & $runner "api-source-tanit" @args
    exit $LASTEXITCODE
  }
}

$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
$Asset = "apisrc-windows-$Arch.exe"
$Url = "https://github.com/$Repo/releases/latest/download/$Asset"

Write-Host "apisrc: no encontrado; descargando $Asset..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
Invoke-WebRequest -Uri $Url -OutFile $Cached -UseBasicParsing

& $Cached @args
exit $LASTEXITCODE
