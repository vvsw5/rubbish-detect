$backendPath = "F:\New project\backend"
$frontendPath = "F:\New project\frontend"
$localIp = (
  ipconfig |
    Select-String "IPv4" |
    ForEach-Object { ($_ -split ":")[-1].Trim() } |
    Where-Object { $_ -match "^\d{1,3}(\.\d{1,3}){3}$" -and $_ -ne "127.0.0.1" } |
    Select-Object -First 1
)

Write-Host "Starting backend on http://127.0.0.1:8000" -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$backendPath'; `$env:MODEL_PROVIDER='mock'; uvicorn app.server_clean:app --host 0.0.0.0 --port 8000 --reload"

Write-Host "Starting frontend on http://127.0.0.1:5173" -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$frontendPath'; npm run dev"

if ($localIp) {
  Write-Host "LAN preview: http://$localIp`:5173" -ForegroundColor Yellow
  Write-Host "同一网络下的其他手机可以直接访问这个地址。" -ForegroundColor Yellow
}

Write-Host "Both services are starting in new terminal windows." -ForegroundColor Cyan
