# Importa database/dumps/co_ceo_db_full_export.sql no MySQL local (ou remoto via .env)
param(
  [string]$SqlFile = ""
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$mysql = @(
  "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe",
  "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $mysql) {
  Write-Error "mysql.exe não encontrado."
}

$dbHost = "127.0.0.1"
$dbUser = "root"
$dbPass = ""

if (Test-Path .env) {
  Get-Content .env | ForEach-Object {
    if ($_ -match '^DB_HOST=(.+)$') { $dbHost = $matches[1].Trim() }
    if ($_ -match '^DB_USER=(.+)$') { $dbUser = $matches[1].Trim() }
    if ($_ -match '^DB_PASSWORD=(.*)$') { $dbPass = $matches[1].Trim() }
  }
}

if (-not $SqlFile) {
  $SqlFile = Join-Path $PWD "database\dumps\co_ceo_db_full_export.sql"
}
if (-not (Test-Path $SqlFile)) {
  Write-Error "Arquivo não encontrado: $SqlFile"
}

Write-Host "Importando $SqlFile em $dbHost (isto substitui co_ceo_db se existir)..."
$mysqlArgs = @("-h$dbHost", "-u$dbUser")
if ($dbPass) { $mysqlArgs += "-p$dbPass" }
Get-Content $SqlFile -Raw | & $mysql @mysqlArgs
Write-Host "Importação concluída."
