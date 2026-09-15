<#
  Publica una version nueva de Dicho: sube el numero de version, compila
  firmando el instalador, genera latest.json y crea el Release en GitHub.

  Uso:
    .\publicar.ps1 -Version 0.8.2

  Las notas salen solas de CAMBIOS.md (el apartado "## X.Y.Z"), que es el mismo
  archivo que la app lleva dentro y ensena en Ajustes. Escribe ahi lo que trae la
  version ANTES de publicar. Con -Notas se puede forzar otro texto.

  Requisitos, una sola vez:
    - La clave privada en %USERPROFILE%\.tauri\dicho.key (creada con
      `npm run tauri signer generate`). Si se pierde, NINGUN Dicho ya
      instalado podra volver a actualizarse: habria que reinstalar a mano
      en cada equipo.
    - `gh auth login` hecho y el repo publico: los assets de un repo
      privado exigen token y la app no lleva ninguno.

  Este archivo se guarda en UTF-8 CON BOM. Sin el BOM, PowerShell 5.1 lo lee
  como ANSI y cualquier acento o guion largo rompe el parseo.
#>
param(
  [Parameter(Mandatory)][string]$Version,
  [string]$Notas = ""
)

$ErrorActionPreference = "Stop"
$raiz  = $PSScriptRoot
$repo  = "luisgs096/dicho"
$clave = "$env:USERPROFILE\.tauri\dicho.key"

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "La version debe ser X.Y.Z, llego '$Version'" }
if (-not (Test-Path $clave)) { throw "Falta la clave privada en $clave" }

# Las notas del Release salen de CAMBIOS.md, la misma fuente que lee la app: una
# sola verdad en vez de dos que se desincronizan. Se comprueba AQUI, antes de
# compilar: enterarse a los 40 minutos de que falta el apartado de esta version
# es tirar el build entero a la basura.
if (-not $Notas) {
  $cambios = "$raiz\CAMBIOS.md"
  if (-not (Test-Path $cambios)) { throw "Falta $cambios, de donde salen las notas" }
  $patron = "(?ms)^##\s+" + [regex]::Escape($Version) + "\s*[^\r\n]*\r?\n(.+?)(?=^##\s|\z)"
  $m = [regex]::Match([IO.File]::ReadAllText($cambios), $patron)
  if (-not $m.Success) {
    throw "CAMBIOS.md no tiene apartado '## $Version'. Escribe que trae la version antes de publicarla."
  }
  $Notas = $m.Groups[1].Value.Trim()
  if (-not $Notas) { throw "El apartado '## $Version' de CAMBIOS.md esta vacio" }
  Write-Host "Notas tomadas de CAMBIOS.md" -ForegroundColor DarkGray
}

# gh escribe en stderr aunque le vaya bien; con ErrorActionPreference=Stop eso
# se convierte en NativeCommandError y aborta sin motivo. Se comprueba el
# codigo de salida con la preferencia relajada.
$prev = $ErrorActionPreference
$ErrorActionPreference = "Continue"
gh auth status *> $null
$ghOk = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prev
if (-not $ghOk) { throw "gh no esta autenticado: corre 'gh auth login'" }

Write-Host "1/5  Subiendo version a $Version" -ForegroundColor Cyan
$conf = "$raiz\src-tauri\tauri.conf.json"
$pkg  = "$raiz\package.json"
$carg = "$raiz\src-tauri\Cargo.toml"
# Un solo "version" de primer nivel en cada JSON; en Cargo.toml se ancla a
# principio de linea para no tocar las versiones de las dependencias.
#
# OJO: `Set-Content -Encoding utf8` en PowerShell 5.1 escribe BOM, y ni el
# JSON.parse de Node (package.json) ni serde_json (latest.json) lo toleran.
# Hay que escribir UTF-8 sin BOM a mano.
$sinBom = New-Object System.Text.UTF8Encoding($false)
function Escribir($ruta, $texto) { [IO.File]::WriteAllText($ruta, $texto, $sinBom) }

Escribir $conf ([IO.File]::ReadAllText($conf) -replace '("version":\s*")[^"]+(")', "`${1}$Version`${2}")
Escribir $pkg  ([IO.File]::ReadAllText($pkg)  -replace '("version":\s*")[^"]+(")', "`${1}$Version`${2}")
Escribir $carg ([IO.File]::ReadAllText($carg) -replace '(?m)^version = "[^"]*"', "version = ""$Version""")

Write-Host "2/5  Compilando y firmando (tarda unos minutos)" -ForegroundColor Cyan
# Tauri exige que TAURI_SIGNING_PRIVATE_KEY_PASSWORD *exista*, aunque este vacia
# (que es el caso de esta clave). Si falta, abre un prompt interactivo que un
# script no puede contestar y muere con "Wrong password for that key".
#
# Y PowerShell no sabe crear una variable vacia: `$env:X = ""` la BORRA, no la
# deja en blanco. .NET si puede, via ProcessStartInfo, asi que el build se lanza
# por ahi. Sin redirigir la salida, para que se siga viendo en vivo.
$psi = New-Object System.Diagnostics.ProcessStartInfo
# Via cmd.exe y no "npm.cmd" a secas: lanzado directo, npm resuelve mal su
# propia carpeta y busca npm-cli.js dentro del proyecto.
$psi.FileName         = "cmd.exe"
$psi.Arguments        = "/c npm run tauri build"
$psi.WorkingDirectory = $raiz
$psi.UseShellExecute  = $false
$psi.EnvironmentVariables["TAURI_SIGNING_PRIVATE_KEY"]          = [IO.File]::ReadAllText($clave)
$psi.EnvironmentVariables["TAURI_SIGNING_PRIVATE_KEY_PASSWORD"] = ""
# aws-lc-sys (via reqwest -> rustls) ensambla con NASM, que este equipo no
# tiene. El crate trae objetos pre-ensamblados justo para este caso. Solo hace
# falta cuando aws-lc-sys tiene que recompilarse, pero dejarlo puesto no cuesta
# nada y evita que un 'cargo clean' tumbe la siguiente publicacion.
$psi.EnvironmentVariables["AWS_LC_SYS_PREBUILT_NASM"]           = "1"
$proc = [System.Diagnostics.Process]::Start($psi)
$proc.WaitForExit()
if ($proc.ExitCode -ne 0) { throw "La compilacion fallo (codigo $($proc.ExitCode))" }

$nsis = "$raiz\src-tauri\target\release\bundle\nsis"
$exe  = "$nsis\Dicho_${Version}_x64-setup.exe"
$sig  = "$exe.sig"
if (-not (Test-Path $exe)) { throw "No aparecio el instalador en $exe" }

# Se vuelve a firmar aparte aunque el build ya lo haya hecho: es barato y
# garantiza que el .sig corresponde al instalador que se acaba de construir (un
# .sig viejo de otra compilacion rompe la actualizacion en silencio).
# El `--password=""` va pegado con `=`: separado, clap se traga el argumento
# siguiente y toma la ruta del instalador como si fuera la password.
npm run tauri -- signer sign --private-key-path "$clave" --password="" "$exe"
if ($LASTEXITCODE -ne 0) { throw "La firma fallo. Revisa la clave en $clave" }
if (-not (Test-Path $sig)) { throw "No aparecio la firma en $sig" }

# Copia con nombre fijo para el boton de descarga del README. GitHub solo sirve
# un enlace permanente (releases/latest/download/<archivo>) si el archivo se
# llama siempre igual, y el nuestro lleva la version dentro del nombre.
# El updater NO usa esta copia: latest.json sigue apuntando a la URL con el
# numero de version, para que una descarga a medias no se mezcle con la
# siguiente release. Esta es solo para humanos.
$fijo = "$nsis\Dicho-setup.exe"
Copy-Item $exe $fijo -Force

Write-Host "3/5  Generando latest.json" -ForegroundColor Cyan
# La URL apunta al tag concreto y no a /latest: asi una descarga a medias no
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
Escribir $latest ($manifiesto | ConvertTo-Json -Depth 5)

Write-Host "4/5  Creando el Release v$Version en GitHub" -ForegroundColor Cyan
$cuerpo = if ($Notas) { $Notas } else { "Version $Version" }
# Las notas van por archivo, no como argumento: PowerShell 5.1 no sabe pasarle
# a un .exe una cadena con comillas dentro —parte el argumento en trozos— y gh
# acaba tomando las palabras sueltas como si fueran assets que subir. En la
# 0.7.0 murio con "no matches found for `la`" despues de compilar y firmar.
$notas = "$nsis\notas.md"
Escribir $notas $cuerpo
# --target clava el tag al commit que se esta publicando. Sin el, gh lo crea
# sobre la rama por defecto: publicando desde una rama, el tag apuntaria a un
# main que NO tiene este codigo y el Release mentiria sobre lo que contiene.
$commit = (git -C $raiz rev-parse HEAD).Trim()
gh release create "v$Version" $exe $fijo $latest --repo $repo --title "Dicho $Version" --notes-file $notas --target $commit
if ($LASTEXITCODE -ne 0) { throw "gh release create fallo" }

Write-Host "5/5  Listo." -ForegroundColor Green
Write-Host "Las copias ya instaladas veran la $Version la proxima vez que abran Ajustes."
Write-Host "Falta commitear el cambio de version:"
Write-Host '  git add -A; git commit -m "Version X.Y.Z"'
