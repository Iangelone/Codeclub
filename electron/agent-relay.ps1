param([Parameter(Mandatory=$true)][string]$RelayFile)
$ErrorActionPreference = 'Stop'
$relayPipe = $null
try {
  $relayConfig = Get-Content -LiteralPath $RelayFile -Raw | ConvertFrom-Json
  $relayName = $relayConfig.pipe -replace '^\\\\\.\\pipe\\', ''
  $relayInput = [Console]::In.ReadToEnd()
  if ($relayInput.Length -gt 16384) { exit 0 }
  $relayEvent = $relayInput | ConvertFrom-Json
  # Send only status metadata; never forward prompts, tool input or results.
  $relayStatus = @{session_id=$relayEvent.session_id;hook_event_name=$relayEvent.hook_event_name;cwd=$relayEvent.cwd;tool_name=$relayEvent.tool_name} | ConvertTo-Json -Compress
  $relayPipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', $relayName, [System.IO.Pipes.PipeDirection]::Out)
  $relayPipe.Connect(150)
  $relayWriter = New-Object System.IO.StreamWriter($relayPipe)
  $relayWriter.WriteLine($relayStatus)
  $relayWriter.Flush()
} catch { } finally { if ($relayPipe) { $relayPipe.Dispose() } }
# Fail open. All approvals and questions remain in the agent's terminal.
exit 0
