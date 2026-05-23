# Sincroniza a branch da maquina com a branch de integracao ANTES de commitar.
# Uso (na raiz do repo):
#   .\scripts\git-sync-before-commit.ps1
#
# Configuracao local (uma vez por maquina):
#   git config coceo.integrationBranch main
#   git config coceo.machineBranch note-guto
#   # note-gamer: coceo.machineBranch note-gamer

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$integration = git config --get coceo.integrationBranch
$machine = git config --get coceo.machineBranch

if (-not $integration) {
  Write-Error "Defina: git config coceo.integrationBranch <branch-integracao>"
}
if (-not $machine) {
  Write-Error "Defina: git config coceo.machineBranch note-gamer ou note-guto"
}

$current = git branch --show-current
if ($current -ne $machine) {
  Write-Host "Checkout $machine ..."
  git checkout $machine
}

Write-Host "Fetch origin..."
git fetch origin

Write-Host "Merge origin/$integration -> $machine (resolva conflitos agora se houver)..."
git merge "origin/$integration" -m "merge($machine): integrar $integration antes do commit"

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "CONFLITO: resolva os arquivos, depois:" -ForegroundColor Yellow
  Write-Host "  git add <arquivos>"
  Write-Host "  git commit   # conclui o merge"
  Write-Host "  git commit -m 'sua mensagem'   # seus commits em seguida"
  exit 1
}

Write-Host "OK. Maquina alinhada com $integration. Pode commitar." -ForegroundColor Green
