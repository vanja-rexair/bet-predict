# Pokrece servis pri svakoj prijavi na Windows, bez prozora, i vraca ga ako stane.
# Uklanjanje: npm run autostart:remove
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$name = 'NBA predikcije servis'
$root = Split-Path $PSScriptRoot -Parent

if ($Remove) {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $name
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
  }
  Write-Output 'Automatsko pokretanje je uklonjeno.'
  return
}

$node = (Get-Command node).Source
$server = Join-Path $root 'engine\src\server.ts'
$log = Join-Path $root 'data\servis.log'
New-Item -ItemType Directory -Force (Join-Path $root 'data') | Out-Null
$cmd = "& '$node' --disable-warning=ExperimentalWarning '$server' *> '$log'"
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\conhost.exe" -Argument "--headless $env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -WindowStyle Hidden -Command `"$cmd`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $name
Write-Output 'Servis je pokrenut i pokretace se pri svakoj prijavi: http://localhost:8787'
