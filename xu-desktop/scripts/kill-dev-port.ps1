# Kill leftover Vite (node) on Tauri dev port 1420. Safe: skips non-node PIDs.
$port = 1420
$procIds = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique
if (-not $procIds) {
  Write-Host "Port $port is free."
  exit 0
}
foreach ($procId in $procIds) {
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq "node") {
    Write-Host "Stopping node PID $procId ($($proc.Path))"
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  } else {
    $name = if ($proc) { $proc.ProcessName } else { "unknown" }
    Write-Host "Port $port held by PID $procId ($name) — not killing (not node)."
  }
}
