# Agenda o backup diário do banco no Agendador de Tarefas do Windows.
# Uso (PowerShell, dentro de backend\):  .\agendar_backup.ps1
# Remover:  Unregister-ScheduledTask -TaskName "Distribuidora Diane - Backup do banco"
$backend = $PSScriptRoot
$nome = "Distribuidora Diane - Backup do banco"

$action = New-ScheduledTaskAction -Execute "$backend\.venv\Scripts\python.exe" -Argument "`"$backend\backup.py`" --keep 30" -WorkingDirectory $backend
$trigger = New-ScheduledTaskTrigger -Daily -At 12:30
# StartWhenAvailable: se o computador estiver desligado às 12:30, roda assim que ligar.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $nome -Action $action -Trigger $trigger -Settings $settings -Force `
    -Description "Backup diário do MongoDB em backend\backups (mantém os 30 mais recentes)" | Out-Null
Get-ScheduledTaskInfo -TaskName $nome | Select-Object TaskName, NextRunTime | Format-List
