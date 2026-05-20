# Gera dump 100% do MySQL (schema + dados) em database/dumps/co_ceo_db_full_export.sql
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$mysqldump = @(
  "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe",
  "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $mysqldump) {
  Write-Error "mysqldump não encontrado. Instale MySQL Client ou ajuste o caminho no script."
}

$dbName = "co_ceo_db"
$dbHost = "127.0.0.1"
$dbUser = "root"
$dbPass = ""

if (Test-Path .env) {
  Get-Content .env | ForEach-Object {
    if ($_ -match '^DB_NAME=(.+)$') { $dbName = $matches[1].Trim() }
    if ($_ -match '^DB_HOST=(.+)$') { $dbHost = $matches[1].Trim() }
    if ($_ -match '^DB_USER=(.+)$') { $dbUser = $matches[1].Trim() }
    if ($_ -match '^DB_PASSWORD=(.*)$') { $dbPass = $matches[1].Trim() }
  }
}

$outDir = Join-Path $PWD "database\dumps"
$outFile = Join-Path $outDir "co_ceo_db_full_export.sql"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$dumpArgs = @(
  "-h$dbHost", "-u$dbUser",
  "--single-transaction", "--routines", "--triggers", "--events",
  "--set-gtid-purged=OFF", "--add-drop-database",
  "--databases", $dbName
)
if ($dbPass) { $dumpArgs = @("-h$dbHost", "-u$dbUser", "-p$dbPass") + $dumpArgs[2..($dumpArgs.Length - 1)] }

Write-Host "Exportando $dbName de ${dbHost}..."
& $mysqldump @dumpArgs 2>$null | Set-Content -Path $outFile -Encoding utf8
$mb = [math]::Round((Get-Item $outFile).Length / 1MB, 2)
Write-Host "OK: $outFile ($mb MB)"
