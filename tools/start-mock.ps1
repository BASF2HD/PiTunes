# Start PiTunes mock server (default port 8095; avoids stuck old servers on 8090).
$port = if ($env:PITUNES_MOCK_PORT) { [int]$env:PITUNES_MOCK_PORT } else { 8095 }
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$env:PITUNES_MOCK_PORT = "$port"

$connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
foreach ($connection in $connections) {
    $processId = $connection.OwningProcess
    if ($processId -and $processId -ne 0) {
        Write-Host "Stopping process $processId on port $port..."
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}

Start-Sleep -Seconds 1
Write-Host ""
Write-Host "Open in your browser:  http://127.0.0.1:$port"
Write-Host "(Do not use port 8090 - old stuck servers may still be there.)"
Write-Host ""
py -3 tools\mock-server.py
