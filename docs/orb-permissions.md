# Orb autonomy and computer access

The creation screen exposes a single Maximum autonomy switch. The stored permission fields remain independent:

- **Maximum autonomy** automatically approves tools for the configured objective. When disabled, mutating actions require approval through the existing session mechanism. Step, token, time, and progress limits remain enforced.
- **Computer access** (`allowComputer`) enables local files, commands, applications, and plugins. Without it, the orb retains only its isolated integrated-browser tools.

Maximum autonomy starts disabled for newly created orbs. New conversations enable ordinary local computer access and do not require administrator privileges. Saving an existing conversation through the current connection setup also enables ordinary computer access, replacing the obsolete browser-only creation setting. Administrator requirements remain unchanged. `maximumAutonomy`, `allowComputer`, and `requiresAdministrator` are stored with the orb and copied into its scheduled task, including runs initiated by AI resource tools.

## Windows elevation

The legacy native elevation path requests administrator rights through Windows UAC; the current creation screen does not invoke it. Electron checks the actual process token, not a renderer preference. Windows cancellation leaves the current app open and does not proceed to creation. An already elevated app continues directly.

On approval, Codeclub restarts as administrator and resumes the permission screen with the saved autonomy choice restored. Continuing opens the orb conversation; its right sidebar opens the provider/model/key modal. Unsaved chat text is not transferred across processes; active sessions, commands, task workers, and terminal instances block this restart.

Elevation applies to the **entire Codeclub process**, including its native operations and child processes. This is not an orb-specific sandbox or a promise of unrestricted Windows access. UAC secure desktops, protected processes, and other operating-system boundaries still apply. Disabling maximum autonomy does not remove the administrator token. Closing the elevated application and launching normally removes that process's elevation.

Future scheduled executions recheck the administrator token. An orb configured to require administrator access is blocked and paused with `TASK_ADMIN_REQUIRED` when Codeclub is launched normally; a saved setting never grants privileges. The saved configuration does not elevate the process; these legacy configurations require an elevated application session.

## Native boundary and lifecycle

`codeclub_request_admin` and `codeclub_admin_status` use the existing `native:invoke` bridge. Only trusted application UI renderers can request them; scheduled workers cannot. The native module runs fixed encoded PowerShell scripts, with executable and development-app paths supplied through environment variables rather than renderer command strings.

The single-instance lock is released before launching the elevated process and reacquired if UAC is cancelled. Native shutdown performs the existing resource cleanup. Startup arguments become URL query values solely for restoring the permission screen; they do not prove elevation. Elevation introduces no new dependencies. Orb conversation events and learning lifecycle are documented in [orb-agent.md](orb-agent.md).

## Verification limits

Build and type checks can verify the wiring without requesting administrator rights. Actual UAC approval, denial, elevated relaunch, and desktop-control behavior must be checked manually on Windows. Automated builds must not display a UAC prompt or enable computer access.

The native launch uses Microsoft's documented [Start-Process RunAs behavior](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process?view=powershell-5.1).
