# scripts\run.ps1 - generado por make-run-dispatcher.ps1
# Dispatcher acotado: -Task solo admite los valores del ValidateSet, asi que
# PowerShell rechaza cualquier otro ANTES del switch. Eso permite allowlistar
# "run.ps1 -Task <x>*" de por vida sin habilitar ejecucion de codigo arbitrario.
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("lint", "build", "dev", "start")]
    [string]$Task,
    [string[]]$Rest
)

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    switch ($Task) {
        "lint" { npm run lint @Rest }
        "build" { npm run build @Rest }
        "dev" { npm run dev @Rest }
        "start" { npm run start @Rest }
        default { Write-Error "Unknown task: $Task" }
    }
}
finally {
    Pop-Location
}