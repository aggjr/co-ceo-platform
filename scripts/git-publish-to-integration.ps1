# Publica o trabalho da maquina na branch de integracao (apos commit local).
# Uso:
#   .\scripts\git-publish-to-integration.ps1

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$integration = git config --get coceo.integrationBranch
$machine = git config --get coceo.machineBranch

if (-not $integration -or -not $machine) {
  Write-Error "Configure coceo.integrationBranch e coceo.machineBranch (ver git-sync-before-commit.ps1)"
}

if (git status --porcelain) {
  Write-Error "Working tree suja. Commit ou stash antes de publicar."
}

$current = git branch --show-current
if ($current -ne $machine) {
  git checkout $machine
}

Write-Host "Fetch origin..."
git fetch origin

Write-Host "Atualizar $machine com origin/$integration..."
git merge "origin/$integration" -m "merge($machine): integrar $integration antes de publicar"
if ($LASTEXITCODE -ne 0) {
  Write-Error "Conflito ao integrar. Resolva e rode de novo."
}

Write-Host "Push $machine..."
git push -u origin $machine

Write-Host "Checkout $integration e merge $machine..."
git checkout $integration
git pull origin $integration
git merge $machine -m "merge($integration): integrar trabalho de $machine"

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "CONFLITO na integracao. Resolva, commit, depois:" -ForegroundColor Yellow
  Write-Host "  git push origin $integration"
  Write-Host "  git checkout $machine"
  Write-Host "  git merge $integration"
  Write-Host "  git push origin $machine"
  exit 1
}

Write-Host "Push $integration..."
git push origin $integration

Write-Host "Realinhar $machine com $integration..."
git checkout $machine
git merge $integration -m "merge($machine): alinhar apos publicar em $integration"
git push origin $machine

Write-Host "Concluido. Integracao e maquina publicadas." -ForegroundColor Green
