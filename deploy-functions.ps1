# PowerShell script to deploy all updated edge functions
# This uses Supabase CLI which automatically handles shared files

Write-Host "Deploying Edge Functions..." -ForegroundColor Green
Write-Host ""

$functions = @(
    "admin-user-management",
    "admin-password-reset",
    "get-client-data",
    "secure-storage",
    "manage-client-data",
    "get-investment-reports",
    "manage-investment-reports",
    "get-call-logs",
    "manage-call-logs",
    "get-activity-logs"
)

foreach ($func in $functions) {
    Write-Host "Deploying $func..." -ForegroundColor Yellow
    supabase functions deploy $func
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ $func deployed successfully" -ForegroundColor Green
    } else {
        Write-Host "✗ $func deployment failed" -ForegroundColor Red
    }
    Write-Host ""
}

Write-Host "All functions deployed!" -ForegroundColor Green
Write-Host ""
Write-Host "Next step: Enable JWT verification in Supabase Dashboard for all 10 functions" -ForegroundColor Cyan

