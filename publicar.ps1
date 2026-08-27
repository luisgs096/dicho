<#
  Publica una version nueva de Dicho: sube el numero de version, compila
  firmando el instalador, genera latest.json y crea el Release en GitHub.

  Uso:
    .\publicar.ps1 -Version 0.2.0 -Notas "Que trae de nuevo"

  Requisitos, una sola vez:
    - La clave privada en %USERPROFILE%\.tauri\dicho.key (creada con
      `npm run tauri signer generate`). Si se pierde, NINGUN Dicho ya
      instalado podra volver a actualizarse: habria que reinstalar a mano.
    - `gh auth login` hecho y el repo publico (los assets de un repo
      privado exigen token, y el updater no lleva ninguno).
#>
param(
  [Parameter(Mandatory)][string]$Version,
  [string]$Notas = ""
)

$ErrorActionPreference = "Stop"
$raiz  = $PSScriptRoot
$repo  = "luisgs096/dicho"
$clave = "$env:USERPROFILE\.tauri\dicho.key"

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version debe ser X.Y.Z, llego '$Version'" }
if (-not (Test-Path $clave)) { throw "Falta la clave privada en $clave" }
gh auth status | Out-Null; if (-not $?) { throw "gh no esta autenticado: corre 'gh auth login'" }

Write-Host "1/5  Subiendo version a $Version" -ForegroundColor Cyan
$conf = "$raiz\src-tauri\tauri.conf.json"
$pkg  = "$raiz\package.json"
$carg = "$raiz\src-tauri\Cargo.toml"
# Un solo "version" de primer nivel en cada JSON; en Cargo.toml se ancla a
# principio de linea para no tocar las versiones de las dependencias.
[IO.File]::ReadAllText($conf) -replace '("version":\s*")[^"]+(")', "`${1}$Version`${2}" | Set-Content $conf -Encoding utf8 -NoNewline
[IO.File]::ReadAllText($pkg)  -replace '("version":\s*")[^"]+(")', "`${1}$Version`${2}" | Set-Content $pkg  -Encoding utf8 -NoNewline
[IO.File]::ReadAllText($carg) -replace '(?m)^version = "[^"]*"', "version = ""$Version""" | Set-Content $carg -Encoding utf8 -NoNewline

Write-Host "2/5  Compilando y firmando (tarda unos minutos)" -ForegroundColor Cyan
$env:TAURI_SIGNING_PRIVATE_KEY = [IO.File]::ReadAllText($clave)
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run tauri build
if ($LASTEXITCODE -ne 0) { throw "La compilacion fallo" }

$nsis = "$raiz\src-tauri\target\release\bundle\nsis"
$exe  = "$nsis\Dicho_${Version}_x64-setup.exe"
$sig  = "$exe.sig"
if (-not (Test-Path $exe)) { throw "No aparecio el instalador en $exe" }
if (-not (Test-Path $sig)) { throw "No aparecio la firma en $sig — revisa TAURI_SIGNING_PRIVATE_KEY" }

Write-Host "3/5  Generando latest.json" -ForegroundColor Cyan
# La URL apunta al tag concreto, no a /latest: asi una descarga a medias no
# se mezcla con la version siguiente.
$manifiesto = [ordered]@{
  version   = $Version
  notes     = $Notas
  pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = (Get-Content $sig -Raw).Trim()
      url       = "https://github.com/$repo/releases/download/v$Version/Dicho_${Version}_x64-setup.exe"
    }
  }
}
$latest = "$nsis\latest.json"
$manifiesto | ConvertTo-Json -Depth 5 | Set-Content $latest -Encoding utf8

Write-Host "4/5  Creando el Release v$Version en GitHub" -ForegroundColor Cyan
$titulo = "Dicho $Version"
$cuerpo = if ($Notas) { $Notas } else { "Version $Version" }
gh release create "v$Version" $exe $latest --repo $repo --title $titulo --notes $cuerpo
if ($LASTEXITCODE -ne 0) { throw "gh release create fallo" }

Write-Host "5/5  Listo." -ForegroundColor Green
Write-Host "Las copias de Dicho ya instaladas veran la $Version la proxima vez que abran Ajustes."
Write-Host "Recuerda commitear el cambio de version: git add -A; git commit -m ""Version $Version"""
