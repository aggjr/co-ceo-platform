# Purge INVEST da holding em producao — preserva usuarios (IAM) e abertura 01/01/2026.
# Requer senha MySQL do servidor (nao commitar).
#
#   .\scripts\purge-holding-prod.ps1 -DryRun
#   .\scripts\purge-holding-prod.ps1 -Confirm
#
param(
  [switch]$DryRun,
  [switch]$Confirm
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $DryRun -and -not $Confirm) {
  Write-Error 'Use -DryRun ou -Confirm.'
}

if (-not $env:REMOTE_DB_PASSWORD) {
  $secure = Read-Host 'REMOTE_DB_PASSWORD (MySQL producao)' -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $env:REMOTE_DB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

if (-not $env:REMOTE_DB_HOST) { $env:REMOTE_DB_HOST = '69.62.99.34' }
if (-not $env:REMOTE_DB_NAME) { $env:REMOTE_DB_NAME = 'co_ceo_platform' }
if (-not $env:PORTFOLIO_ORG_ID) { $env:PORTFOLIO_ORG_ID = 'org-holding-001' }

$args = @('./node_modules/ts-node/dist/bin.js', 'scripts/purge-holding-keep-opening.ts')
if ($DryRun) { $args += '--dry-run' }
if ($Confirm) { $args += '--confirm' }

Write-Host "Host: $env:REMOTE_DB_HOST  Org: $env:PORTFOLIO_ORG_ID"
& node @args
