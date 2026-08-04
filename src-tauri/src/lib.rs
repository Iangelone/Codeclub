use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, Read, Write},
    path::{Component, Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{webview::{PageLoadEvent, WebviewBuilder}, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewUrl};

#[derive(Serialize)]
struct FileEntry {
    path: String,
    kind: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectIndexSnapshot {
    file_count: usize,
    directory_count: usize,
    total_size: u64,
    files: Vec<String>,
}

#[derive(Serialize)]
struct SearchMatch {
    path: String,
    line: usize,
    preview: String,
}

#[derive(Serialize)]
struct CommandOutput {
    code: Option<i32>,
    stdout: String,
    stderr: String,
    cwd: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillEntry {
    id: String,
    name: String,
    description: String,
    source: String,
    content: String,
}

#[derive(Deserialize)]
struct CommandRequest {
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct HttpHeader {
    name: String,
    value: String,
}

#[derive(Deserialize)]
struct HttpFetchRequest {
    url: String,
    method: String,
    headers: Vec<HttpHeader>,
    body: Option<String>,
}

#[derive(Serialize)]
struct HttpFetchResponse {
    status: u16,
    status_text: String,
    headers: Vec<HttpHeader>,
    body: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserSelection {
    title: String,
    text: String,
    html: String,
    url: String,
    selector: String,
    tag: String,
    is_multi_select: Option<bool>,
}

fn codeclub_browser_webview(app: &AppHandle) -> Result<tauri::Webview, String> {
    app.get_webview("codeclub-browser")
        .or_else(|| {
            app.get_window("main")?.webviews().into_iter().find(|webview| {
                webview.label() == "codeclub-browser"
            })
        })
        .ok_or_else(|| "El WebView del navegador no está disponible.".to_string())
}

#[tauri::command]
fn codeclub_browser_create(app: AppHandle, url: String, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    if let Some(existing) = app.get_webview("codeclub-browser") {
        let _ = existing.close();
    }
    let window = app.get_window("main").ok_or_else(|| "No se encontró la ventana principal.".to_string())?;
    let parsed_url: tauri::Url = url.parse().map_err(|error| format!("URL inválida: {error}"))?;
    if !matches!(parsed_url.scheme(), "http" | "https") || parsed_url.host().is_none() {
        return Err("Solo se permiten URLs http(s) con dominio válido.".to_string());
    }
    let builder = WebviewBuilder::new("codeclub-browser", WebviewUrl::External(parsed_url))
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = webview.emit("codeclub-browser-page-loaded", payload.url().to_string());
            }
        });
    let webview = window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    webview.show().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn codeclub_browser_close(app: AppHandle) -> Result<(), String> {
    if let Ok(webview) = codeclub_browser_webview(&app) {
        webview.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn codeclub_browser_set_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    if let Ok(webview) = codeclub_browser_webview(&app) {
        if visible {
            webview.show().map_err(|error| error.to_string())?;
        } else {
            webview.hide().map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn codeclub_browser_set_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let webview = app
        .get_webview("codeclub-browser")
        .ok_or_else(|| "El WebView del navegador no está disponible.".to_string())?;
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    webview
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())
}

#[derive(Default)]
struct TerminalRegistry {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

#[derive(Default)]
struct WhatsAppRegistry {
    child: Mutex<Option<Child>>,
}

struct TerminalSession {
    info: TerminalInfo,
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    buffer: Arc<Mutex<String>>,
    status: Arc<Mutex<String>>,
}

#[derive(Clone, Serialize)]
struct TerminalInfo {
    id: String,
    name: String,
    shell: String,
    cwd: String,
    #[serde(rename = "projectPath")]
    project_path: Option<String>,
    is_agent: bool,
    created_at: String,
    status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalCreateRequest {
    name: Option<String>,
    shell: Option<String>,
    cwd: Option<String>,
    project_path: Option<String>,
    is_agent: Option<bool>,
}

#[derive(Serialize)]
struct TerminalSnapshot {
    info: TerminalInfo,
    output: String,
}

#[derive(Clone, Serialize)]
struct TerminalOutputEvent {
    id: String,
    stream: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct TerminalExitEvent {
    id: String,
    code: Option<i32>,
}

struct ShellSpec {
    command: String,
    args: Vec<String>,
    label: String,
}

impl TerminalSession {
    fn info(&self) -> TerminalInfo {
        let mut info = self.info.clone();
        info.status = self
            .status
            .lock()
            .map(|status| status.clone())
            .unwrap_or_else(|_| "unknown".into());
        info
    }
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn command_exists(command: &str) -> bool {
    Command::new(command)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok()
}

fn first_existing_path(paths: &[&str]) -> Option<String> {
    paths
        .iter()
        .find(|path| Path::new(path).exists())
        .map(|path| (*path).to_string())
}

fn resolve_shell(kind: Option<&str>) -> Result<ShellSpec, String> {
    let kind = kind.unwrap_or("auto").to_ascii_lowercase();
    match kind.as_str() {
        "powershell" | "pwsh" => {
            if command_exists("pwsh") {
                Ok(ShellSpec {
                    command: "pwsh".into(),
                    args: vec!["-NoLogo".into(), "-NoExit".into()],
                    label: "powershell".into(),
                })
            } else {
                Ok(ShellSpec {
                    command: "powershell.exe".into(),
                    args: vec!["-NoLogo".into(), "-NoProfile".into(), "-NoExit".into()],
                    label: "powershell".into(),
                })
            }
        }
        "git-bash" | "bash" => {
            let command = first_existing_path(&[
                r"C:\Program Files\Git\bin\bash.exe",
                r"C:\Program Files\Git\usr\bin\bash.exe",
                r"C:\Program Files (x86)\Git\bin\bash.exe",
            ])
            .unwrap_or_else(|| "bash.exe".into());

            Ok(ShellSpec {
                command,
                args: vec!["--login".into(), "-i".into()],
                label: "git-bash".into(),
            })
        }
        "wsl" | "wsl2" => Ok(ShellSpec {
            command: "wsl.exe".into(),
            args: Vec::new(),
            label: "wsl".into(),
        }),
        "cmd" => Ok(ShellSpec {
            command: "cmd.exe".into(),
            args: vec!["/Q".into()],
            label: "cmd".into(),
        }),
        "auto" | "" => resolve_shell(Some("powershell")),
        _ => Err("Shell no soportada.".into()),
    }
}

fn resolve_terminal_cwd(request: &TerminalCreateRequest) -> Result<PathBuf, String> {
    if let Some(cwd) = &request.cwd {
        let path = PathBuf::from(cwd);
        if path.exists() {
            return path
                .canonicalize()
                .map_err(|error| format!("No se pudo resolver el cwd: {error}"));
        }
    }

    if let Some(project_path) = &request.project_path {
        return workspace_root(project_path);
    }

    let home = if cfg!(windows) {
        std::env::var("USERPROFILE").or_else(|_| {
            let drive = std::env::var("HOMEDRIVE").map_err(|_| ())?;
            let path = std::env::var("HOMEPATH").map_err(|_| ())?;
            Ok::<String, ()>(format!("{drive}{path}"))
        }).ok()
    } else {
        std::env::var("HOME").ok()
    };

    if let Some(home) = home {
        let path = PathBuf::from(home);
        if path.exists() {
            return path
                .canonicalize()
                .map_err(|error| format!("No se pudo resolver la carpeta personal: {error}"));
        }
    }

    std::env::current_dir().map_err(|error| format!("No se pudo resolver el cwd: {error}"))
}

fn append_terminal_buffer(buffer: &Arc<Mutex<String>>, data: &str) {
    const MAX_BUFFER_CHARS: usize = 240_000;
    if let Ok(mut buffer) = buffer.lock() {
        buffer.push_str(data);
        let char_count = buffer.chars().count();
        if char_count > MAX_BUFFER_CHARS {
            let trimmed: String = buffer
                .chars()
                .rev()
                .take(MAX_BUFFER_CHARS)
                .collect::<String>()
                .chars()
                .rev()
                .collect();
            *buffer = trimmed;
        }
    }
}

fn spawn_terminal_reader<R: Read + Send + 'static>(
    mut reader: R,
    id: String,
    stream: &'static str,
    app: AppHandle,
    buffer: Arc<Mutex<String>>,
) {
    std::thread::spawn(move || {
        let mut bytes = [0_u8; 4096];
        loop {
            match reader.read(&mut bytes) {
                Ok(0) => break,
                Ok(size) => {
                    let data = String::from_utf8_lossy(&bytes[..size]).to_string();
                    append_terminal_buffer(&buffer, &data);
                    let _ = app.emit(
                        "codeclub-terminal-output",
                        TerminalOutputEvent {
                            id: id.clone(),
                            stream: stream.into(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });
}

fn spawn_terminal_monitor(
    id: String,
    child: Arc<Mutex<Child>>,
    status: Arc<Mutex<String>>,
    app: AppHandle,
) {
    std::thread::spawn(move || {
        loop {
            let exit_code = {
                let Ok(mut child) = child.lock() else {
                    return;
                };

                match child.try_wait() {
                    Ok(Some(exit)) => Some(exit.code()),
                    Ok(None) => None,
                    Err(_) => Some(None),
                }
            };

            if let Some(code) = exit_code {
                if let Ok(mut status) = status.lock() {
                    *status = "exited".into();
                }
                let _ = app.emit(
                    "codeclub-terminal-exit",
                    TerminalExitEvent {
                        id: id.clone(),
                        code,
                    },
                );
                break;
            }

            std::thread::sleep(Duration::from_millis(500));
        }
    });
}

fn workspace_root(project_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(project_path);
    if !root.exists() {
        return Err("El workspace no existe.".into());
    }
    root.canonicalize()
        .map_err(|error| format!("No se pudo resolver el workspace: {error}"))
}

fn safe_relative_path(path: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err("La ruta debe ser relativa al workspace.".into());
    }

    let mut clean = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            _ => return Err("La ruta no puede salir del workspace.".into()),
        }
    }

    if clean.as_os_str().is_empty() {
        return Err("La ruta no puede estar vacia.".into());
    }

    Ok(clean)
}

fn safe_workspace_path(project_path: &str, relative_path: &str) -> Result<PathBuf, String> {
    let root = workspace_root(project_path)?;
    let clean = safe_relative_path(relative_path)?;
    let full_path = root.join(clean);

    if let Ok(existing) = full_path.canonicalize() {
        if !existing.starts_with(&root) {
            return Err("La ruta esta fuera del workspace.".into());
        }
    } else {
        let mut probe = full_path.parent();
        while let Some(parent) = probe {
            if parent.exists() {
                let existing_parent = parent
                    .canonicalize()
                    .map_err(|error| format!("No se pudo resolver el directorio padre: {error}"))?;
                if !existing_parent.starts_with(&root) {
                    return Err("La ruta esta fuera del workspace.".into());
                }
                break;
            }
            probe = parent.parent();
        }
    }

    Ok(full_path)
}

fn should_skip_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| {
            matches!(
                name,
                ".git" | ".codeclub" | "dist" | "node_modules" | "target"
            )
        })
        .unwrap_or(false)
}

fn to_workspace_relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn collect_files(
    root: &Path,
    current: &Path,
    entries: &mut Vec<FileEntry>,
    max_files: usize,
) -> Result<(), String> {
    if entries.len() >= max_files {
        return Ok(());
    }

    for item in
        fs::read_dir(current).map_err(|error| format!("No se pudo leer el directorio: {error}"))?
    {
        if entries.len() >= max_files {
            break;
        }

        let item = item.map_err(|error| format!("No se pudo leer una entrada: {error}"))?;
        let path = item.path();
        let metadata = item
            .metadata()
            .map_err(|error| format!("No se pudo leer metadata: {error}"))?;

        if metadata.is_dir() {
            if should_skip_dir(&path) {
                continue;
            }

            entries.push(FileEntry {
                path: to_workspace_relative(root, &path),
                kind: "directory".into(),
                size: 0,
            });
            collect_files(root, &path, entries, max_files)?;
        } else if metadata.is_file() {
            entries.push(FileEntry {
                path: to_workspace_relative(root, &path),
                kind: "file".into(),
                size: metadata.len(),
            });
        }
    }

    Ok(())
}

#[tauri::command]
fn codeclub_list_files(
    project_path: String,
    max_files: Option<usize>,
) -> Result<Vec<FileEntry>, String> {
    let root = workspace_root(&project_path)?;
    let mut entries = Vec::new();
    collect_files(
        &root,
        &root,
        &mut entries,
        max_files.unwrap_or(400).min(1200),
    )?;
    Ok(entries)
}

#[tauri::command]
fn codeclub_index_project(project_path: String) -> Result<ProjectIndexSnapshot, String> {
    let root = workspace_root(&project_path)?;
    let mut entries = Vec::new();
    collect_files(&root, &root, &mut entries, 4000)?;
    let file_count = entries.iter().filter(|entry| entry.kind == "file").count();
    let directory_count = entries.iter().filter(|entry| entry.kind == "directory").count();
    let total_size = entries.iter().filter(|entry| entry.kind == "file").map(|entry| entry.size).sum();
    let files = entries.into_iter().filter(|entry| entry.kind == "file").map(|entry| entry.path).collect();
    Ok(ProjectIndexSnapshot { file_count, directory_count, total_size, files })
}

#[tauri::command]
fn codeclub_get_username() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "Usuario".into())
}

#[tauri::command]
fn codeclub_get_system_root() -> Result<String, String> {
    if cfg!(windows) {
        let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
        Ok(format!("{drive}\\"))
    } else {
        Ok("/".into())
    }
}

#[tauri::command]
fn codeclub_read_file(project_path: String, path: String) -> Result<String, String> {
    let full_path = safe_workspace_path(&project_path, &path)?;
    let metadata =
        fs::metadata(&full_path).map_err(|error| format!("No se pudo leer metadata: {error}"))?;
    if metadata.len() > 180_000 {
        return Err("El archivo es demasiado grande para leerlo completo.".into());
    }
    fs::read_to_string(full_path).map_err(|error| format!("No se pudo leer el archivo: {error}"))
}

#[tauri::command]
fn codeclub_write_file(project_path: String, path: String, content: String) -> Result<(), String> {
    let full_path = safe_workspace_path(&project_path, &path)?;
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("No se pudo crear el directorio: {error}"))?;
    }
    fs::write(full_path, content)
        .map_err(|error| format!("No se pudo escribir el archivo: {error}"))
}

#[tauri::command]
fn codeclub_create_entry(project_path: String, path: String, kind: String) -> Result<(), String> {
    let full_path = safe_workspace_path(&project_path, &path)?;

    match kind.as_str() {
        "folder" => fs::create_dir_all(&full_path)
            .map_err(|error| format!("No se pudo crear la carpeta: {error}")),
        "file" => {
            if let Some(parent) = full_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("No se pudo crear el directorio: {error}"))?;
            }
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&full_path)
                .map(|_| ())
                .map_err(|error| format!("No se pudo crear el archivo: {error}"))
        }
        _ => Err("Tipo de elemento invalido: usa 'file' o 'folder'.".into()),
    }
}

#[tauri::command]
fn codeclub_search_text(
    project_path: String,
    query: String,
    max_matches: Option<usize>,
) -> Result<Vec<SearchMatch>, String> {
    let root = workspace_root(&project_path)?;
    let max_matches = max_matches.unwrap_or(80).min(200);
    let mut matches = Vec::new();
    let mut stack = vec![root.clone()];

    while let Some(current) = stack.pop() {
        if matches.len() >= max_matches {
            break;
        }

        for item in fs::read_dir(&current).map_err(|error| format!("No se pudo buscar: {error}"))? {
            if matches.len() >= max_matches {
                break;
            }

            let item = item.map_err(|error| format!("No se pudo leer una entrada: {error}"))?;
            let path = item.path();
            let metadata = item
                .metadata()
                .map_err(|error| format!("No se pudo leer metadata: {error}"))?;

            if metadata.is_dir() {
                if !should_skip_dir(&path) {
                    stack.push(path);
                }
                continue;
            }

            if !metadata.is_file() || metadata.len() > 180_000 {
                continue;
            }

            let Ok(content) = fs::read_to_string(&path) else {
                continue;
            };

            for (line_index, line) in content.lines().enumerate() {
                if line.contains(&query) {
                    matches.push(SearchMatch {
                        path: to_workspace_relative(&root, &path),
                        line: line_index + 1,
                        preview: line.trim().chars().take(220).collect(),
                    });
                    if matches.len() >= max_matches {
                        break;
                    }
                }
            }
        }
    }

    Ok(matches)
}

#[tauri::command]
fn codeclub_run_command(
    project_path: String,
    request: CommandRequest,
) -> Result<CommandOutput, String> {
    let root = workspace_root(&project_path)?;
    let cwd = match request.cwd.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        None => root.clone(),
        Some(raw) => {
            let candidate = PathBuf::from(raw);
            let candidate = if candidate.is_absolute() { candidate } else { root.join(candidate) };
            let resolved = candidate.canonicalize().map_err(|error| format!("No se pudo resolver el cwd: {error}"))?;
            if !resolved.starts_with(&root) {
                return Err("El cwd debe permanecer dentro del workspace activo.".into());
            }
            resolved
        }
    };
    let mut child = Command::new(&request.command)
        .args(&request.args)
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("No se pudo ejecutar el comando: {error}"))?;

    let started = Instant::now();
    loop {
        if child
            .try_wait()
            .map_err(|error| format!("No se pudo consultar el comando: {error}"))?
            .is_some()
        {
            break;
        }

        if started.elapsed() > Duration::from_secs(25) {
            let _ = child.kill();
            return Err("El comando supero el limite de 25 segundos.".into());
        }

        std::thread::sleep(Duration::from_millis(120));
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("No se pudo leer la salida del comando: {error}"))?;

    Ok(CommandOutput {
        code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout)
            .chars()
            .take(12_000)
            .collect(),
        stderr: String::from_utf8_lossy(&output.stderr)
            .chars()
            .take(12_000)
            .collect(),
        cwd: cwd.to_string_lossy().to_string(),
    })
}

fn skill_roots(project_path: &str) -> Vec<(PathBuf, String)> {
    let mut roots = Vec::new();
    if !project_path.is_empty() {
        let project = PathBuf::from(project_path);
        roots.push((project.join(".codeclub").join("skills"), "project".into()));
    }
    roots
}

fn frontmatter_value(content: &str, key: &str) -> Option<String> {
    content.lines().take(24).find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.trim() == key { Some(value.trim().trim_matches(['"', '\'']).to_string()) } else { None }
    })
}

#[tauri::command]
fn codeclub_list_skills(project_path: String) -> Result<Vec<SkillEntry>, String> {
    let mut skills = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (root, source) in skill_roots(&project_path) {
        if !root.is_dir() { continue; }
        let entries = fs::read_dir(&root).map_err(|error| format!("No se pudieron listar habilidades: {error}"))?;
        for entry in entries {
            let entry = entry.map_err(|error| format!("No se pudo leer una habilidad: {error}"))?;
            let dir = entry.path();
            if !dir.is_dir() { continue; }
            let skill_file = dir.join("SKILL.md");
            if !skill_file.is_file() { continue; }
            let content = fs::read_to_string(&skill_file).map_err(|error| format!("No se pudo leer {}: {error}", skill_file.display()))?;
            let id = dir.file_name().and_then(|name| name.to_str()).unwrap_or_default().to_string();
            if id.is_empty() || !seen.insert(id.clone()) { continue; }
            let name = frontmatter_value(&content, "name").unwrap_or_else(|| id.clone());
            let description = frontmatter_value(&content, "description").unwrap_or_else(|| "Habilidad disponible para esta sesión.".into());
            skills.push(SkillEntry { id, name, description, source: source.clone(), content });
        }
    }
    skills.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(skills)
}

#[tauri::command]
fn codeclub_terminal_list(state: State<'_, TerminalRegistry>) -> Result<Vec<TerminalInfo>, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "No se pudo leer terminales.".to_string())?;
    Ok(sessions.values().map(TerminalSession::info).collect())
}

#[tauri::command]
fn codeclub_terminal_create(
    app: AppHandle,
    state: State<'_, TerminalRegistry>,
    request: TerminalCreateRequest,
) -> Result<TerminalInfo, String> {
    let is_agent = request.is_agent.unwrap_or(false);
    let shell = resolve_shell(request.shell.as_deref())?;
    let cwd = resolve_terminal_cwd(&request)?;
    let id = format!("terminal-{}", now_millis());
    let name = request.name.clone().unwrap_or_else(|| "Terminal".into());

    let mut command = Command::new(&shell.command);
    command
        .args(&shell.args)
        .current_dir(&cwd)
        .env("TERM", "xterm-256color")
        .env("COLORTERM", "truecolor")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("No se pudo iniciar la terminal: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "No se pudo abrir stdin de la terminal.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "No se pudo abrir stdout de la terminal.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "No se pudo abrir stderr de la terminal.".to_string())?;

    let child = Arc::new(Mutex::new(child));
    let stdin = Arc::new(Mutex::new(stdin));
    let buffer = Arc::new(Mutex::new(String::new()));
    let status = Arc::new(Mutex::new("running".to_string()));
    let info = TerminalInfo {
        id: id.clone(),
        name,
        shell: shell.label,
        cwd: cwd.to_string_lossy().to_string(),
        project_path: request.project_path.clone(),
        is_agent,
        created_at: now_millis().to_string(),
        status: "running".into(),
    };

    spawn_terminal_reader(stdout, id.clone(), "stdout", app.clone(), buffer.clone());
    spawn_terminal_reader(stderr, id.clone(), "stderr", app.clone(), buffer.clone());
    spawn_terminal_monitor(id.clone(), child.clone(), status.clone(), app.clone());

    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "No se pudo guardar la terminal.".to_string())?;
        sessions.insert(
            id,
            TerminalSession {
                info: info.clone(),
                child,
                stdin,
                buffer,
                status,
            },
        );
    }

    let _ = app.emit("codeclub-terminal-created", info.clone());
    Ok(info)
}

#[tauri::command]
fn codeclub_terminal_snapshot(
    state: State<'_, TerminalRegistry>,
    id: String,
) -> Result<TerminalSnapshot, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "No se pudo leer terminales.".to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| "Terminal no encontrada.".to_string())?;
    let output = session
        .buffer
        .lock()
        .map(|buffer| buffer.clone())
        .unwrap_or_default();
    Ok(TerminalSnapshot {
        info: session.info(),
        output,
    })
}

#[tauri::command]
fn codeclub_terminal_write(
    state: State<'_, TerminalRegistry>,
    id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "No se pudo leer terminales.".to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| "Terminal no encontrada.".to_string())?;
    if session.info().status != "running" {
        return Err("La terminal no esta corriendo.".into());
    }
    let mut stdin = session
        .stdin
        .lock()
        .map_err(|_| "No se pudo escribir en la terminal.".to_string())?;
    stdin
        .write_all(data.as_bytes())
        .map_err(|error| format!("No se pudo escribir en la terminal: {error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("No se pudo enviar a la terminal: {error}"))
}

#[tauri::command]
fn codeclub_terminal_rename(
    app: AppHandle,
    state: State<'_, TerminalRegistry>,
    id: String,
    name: String,
) -> Result<TerminalInfo, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "No se pudo leer terminales.".to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| "Terminal no encontrada.".to_string())?;
    session.info.name = name.trim().chars().take(40).collect();
    if session.info.name.is_empty() {
        session.info.name = "Terminal".into();
    }
    let info = session.info();
    let _ = app.emit("codeclub-terminal-updated", info.clone());
    Ok(info)
}

#[tauri::command]
fn codeclub_terminal_stop(
    app: AppHandle,
    state: State<'_, TerminalRegistry>,
    id: String,
) -> Result<TerminalInfo, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "No se pudo leer terminales.".to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| "Terminal no encontrada.".to_string())?;
    if let Ok(mut child) = session.child.lock() {
        let _ = child.kill();
    }
    if let Ok(mut status) = session.status.lock() {
        *status = "stopped".into();
    }
    let info = session.info();
    let _ = app.emit("codeclub-terminal-updated", info.clone());
    Ok(info)
}

#[tauri::command]
fn codeclub_terminal_delete(
    app: AppHandle,
    state: State<'_, TerminalRegistry>,
    id: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "No se pudo leer terminales.".to_string())?;
    let session = sessions
        .remove(&id)
        .ok_or_else(|| "Terminal no encontrada.".to_string())?;
    if let Ok(mut child) = session.child.lock() {
        let _ = child.kill();
    }
    let _ = app.emit("codeclub-terminal-deleted", id);
    Ok(())
}

#[tauri::command]
async fn codeclub_http_fetch(request: HttpFetchRequest) -> Result<HttpFetchResponse, String> {
    if !request.url.starts_with("https://") && !request.url.starts_with("http://") {
        return Err("URL HTTP invalida para el fetch del modelo.".into());
    }

    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|error| format!("Metodo HTTP invalido: {error}"))?;
    let mut headers = reqwest::header::HeaderMap::new();

    for header in request.headers {
        let name = header.name.to_ascii_lowercase();
        if matches!(
            name.as_str(),
            "host" | "content-length" | "connection" | "accept-encoding"
        ) {
            continue;
        }

        let header_name = reqwest::header::HeaderName::from_bytes(header.name.as_bytes())
            .map_err(|error| format!("Header invalido {}: {error}", header.name))?;
        let header_value = reqwest::header::HeaderValue::from_str(&header.value)
            .map_err(|error| format!("Valor de header invalido {}: {error}", header.name))?;
        headers.insert(header_name, header_value);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("No se pudo crear el cliente HTTP: {error}"))?;

    let mut builder = client.request(method, &request.url).headers(headers);
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("Fetch del modelo fallo: {error}"))?;
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let response_headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value.to_str().ok().map(|value| HttpHeader {
                name: name.as_str().to_string(),
                value: value.to_string(),
            })
        })
        .collect();
    let body = response
        .text()
        .await
        .map_err(|error| format!("No se pudo leer la respuesta HTTP: {error}"))?;

    Ok(HttpFetchResponse {
        status: status.as_u16(),
        status_text,
        headers: response_headers,
        body,
    })
}

#[tauri::command]
fn codeclub_browser_eval(app: AppHandle, script: String) -> Result<(), String> {
    let webview = codeclub_browser_webview(&app)?;
    webview.eval(script).map_err(|error| error.to_string())
}

#[tauri::command]
fn codeclub_browser_get_url(app: AppHandle) -> Result<String, String> {
    let webview = codeclub_browser_webview(&app)?;
    webview.url().map(|url| url.to_string()).map_err(|error| error.to_string())
}

#[tauri::command]
fn codeclub_browser_selection(app: AppHandle, selection: BrowserSelection) -> Result<(), String> {
    app.emit("codeclub-browser-selection", selection)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn codeclub_whatsapp_start(app: AppHandle, state: State<'_, WhatsAppRegistry>) -> Result<(), String> {
    let mut registry = state.child.lock().map_err(|error| error.to_string())?;
    if let Some(child) = registry.as_mut() {
        if child.try_wait().map_err(|error| error.to_string())?.is_none() {
            if let Some(stdin) = child.stdin.as_mut() {
                let _ = writeln!(stdin, "{}", serde_json::json!({ "type": "list_chats" }));
                let _ = stdin.flush();
            }
            return Ok(());
        }
    }

    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("scripts").join("whatsapp-bridge.mjs");
    let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?.join("whatsapp-baileys-session");
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let mut child = Command::new("node")
        .arg(script)
        .env("CODECLUB_WHATSAPP_DIR", data_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("No se pudo iniciar WhatsApp: {error}"))?;

    if let Some(stdout) = child.stdout.take() {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines().flatten() {
                if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&line) {
                    let _ = app_handle.emit("codeclub:whatsapp-event", payload);
                }
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines().flatten() {
                let _ = app_handle.emit(
                    "codeclub:whatsapp-event",
                    serde_json::json!({ "type": "error", "message": line }),
                );
            }
        });
    }
    *registry = Some(child);
    Ok(())
}

#[tauri::command]
fn codeclub_whatsapp_send(state: State<'_, WhatsAppRegistry>, chat_id: String, body: String) -> Result<(), String> {
    let mut registry = state.child.lock().map_err(|error| error.to_string())?;
    if registry.as_mut().and_then(|child| child.try_wait().ok()).flatten().is_some() {
        *registry = None;
        return Err("WhatsApp bridge finished. Start WhatsApp again.".to_string());
    }
    let child = registry.as_mut().ok_or_else(|| "WhatsApp no está iniciado".to_string())?;
    let stdin = child.stdin.as_mut().ok_or_else(|| "No hay canal de WhatsApp".to_string())?;
    writeln!(stdin, "{}", serde_json::json!({ "type": "send", "chatId": chat_id, "body": body })).map_err(|error| error.to_string())?;
    stdin.flush().map_err(|error| error.to_string())
}

#[tauri::command]
fn codeclub_whatsapp_get_messages(state: State<'_, WhatsAppRegistry>, chat_id: String) -> Result<(), String> {
    let mut registry = state.child.lock().map_err(|error| error.to_string())?;
    if registry.as_mut().and_then(|child| child.try_wait().ok()).flatten().is_some() {
        *registry = None;
        return Err("WhatsApp bridge finished. Start WhatsApp again.".to_string());
    }
    let child = registry.as_mut().ok_or_else(|| "WhatsApp no está iniciado".to_string())?;
    let stdin = child.stdin.as_mut().ok_or_else(|| "No hay canal de WhatsApp".to_string())?;
    writeln!(stdin, "{}", serde_json::json!({ "type": "get_messages", "chatId": chat_id })).map_err(|error| error.to_string())?;
    stdin.flush().map_err(|error| error.to_string())
}

#[tauri::command]
fn codeclub_whatsapp_refresh(state: State<'_, WhatsAppRegistry>) -> Result<(), String> {
    let mut registry = state.child.lock().map_err(|error| error.to_string())?;
    if registry.as_mut().and_then(|child| child.try_wait().ok()).flatten().is_some() {
        *registry = None;
        return Err("WhatsApp bridge finished. Start WhatsApp again.".to_string());
    }
    let child = registry.as_mut().ok_or_else(|| "WhatsApp no está iniciado".to_string())?;
    let stdin = child.stdin.as_mut().ok_or_else(|| "No hay canal de WhatsApp".to_string())?;
    writeln!(stdin, "{}", serde_json::json!({ "type": "refresh" })).map_err(|error| error.to_string())?;
    stdin.flush().map_err(|error| error.to_string())
}

#[tauri::command]
fn codeclub_whatsapp_logout(state: State<'_, WhatsAppRegistry>) -> Result<(), String> {
    let mut registry = state.child.lock().map_err(|error| error.to_string())?;
    if registry.as_mut().and_then(|child| child.try_wait().ok()).flatten().is_some() {
        *registry = None;
        return Err("WhatsApp bridge finished. Start WhatsApp again.".to_string());
    }
    let child = registry.as_mut().ok_or_else(|| "WhatsApp no está iniciado".to_string())?;
    let stdin = child.stdin.as_mut().ok_or_else(|| "No hay canal de WhatsApp".to_string())?;
    writeln!(stdin, "{}", serde_json::json!({ "type": "logout" })).map_err(|error| error.to_string())?;
    stdin.flush().map_err(|error| error.to_string())
}

#[tauri::command]
fn codeclub_whatsapp_stop(state: State<'_, WhatsAppRegistry>) -> Result<(), String> {
    let mut registry = state.child.lock().map_err(|error| error.to_string())?;
    if let Some(mut child) = registry.take() {
        let _ = child.kill();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TerminalRegistry::default())
        .manage(WhatsAppRegistry::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            codeclub_list_files,
            codeclub_index_project,
            codeclub_get_username,
            codeclub_list_skills,
            codeclub_get_system_root,
            codeclub_read_file,
            codeclub_search_text,
            codeclub_write_file,
            codeclub_create_entry,
            codeclub_run_command,
            codeclub_terminal_list,
            codeclub_terminal_create,
            codeclub_terminal_snapshot,
            codeclub_terminal_write,
            codeclub_terminal_rename,
            codeclub_terminal_stop,
            codeclub_terminal_delete,
            codeclub_http_fetch,
            codeclub_browser_create,
            codeclub_browser_close,
            codeclub_browser_set_visible,
            codeclub_browser_set_bounds,
            codeclub_browser_eval,
            codeclub_browser_get_url,
            codeclub_browser_selection,
            codeclub_whatsapp_start,
            codeclub_whatsapp_send,
            codeclub_whatsapp_get_messages,
            codeclub_whatsapp_refresh,
            codeclub_whatsapp_logout,
            codeclub_whatsapp_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
