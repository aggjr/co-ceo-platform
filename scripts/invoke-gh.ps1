# Executa gh usando o mesmo token do Git Credential Manager (git push).
# Uso: .\scripts\invoke-gh.ps1 repo view
#      .\scripts\invoke-gh.ps1 pr list

$ErrorActionPreference = "Stop"
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
  Write-Error "gh nao encontrado. Instale: winget install GitHub.cli"
}

$credText = @"
protocol=https
host=github.com
"@ | git credential fill 2>$null

$token = ($credText -split "`n" | Where-Object { $_ -like 'password=*' } | Select-Object -First 1) -replace '^password=',''
if (-not $token) {
  Write-Error "Sem credencial GitHub no Credential Manager. Faca um git fetch ou git push uma vez."
}

$env:GH_TOKEN = $token
if ($args.Count -eq 0) {
  & gh
} else {
  & gh @args
}
exit $LASTEXITCODE
