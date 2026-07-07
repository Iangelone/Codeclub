use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

#[derive(Serialize)]
struct FileEntry {
    path: String,
    kind: String,
    size: u64,
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
}

#[derive(Deserialize)]
struct CommandRequest {
    command: String,
    args: Vec<String>,
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
    let allowed = ["bun", "npm", "pnpm", "node", "git", "cargo", "python", "rg"];
    if !allowed.contains(&request.command.as_str()) {
        return Err("Comando no permitido para el agente.".into());
    }

    let mut child = Command::new(&request.command)
        .args(&request.args)
        .current_dir(root)
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
    })
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            codeclub_list_files,
            codeclub_read_file,
            codeclub_search_text,
            codeclub_write_file,
            codeclub_run_command,
            codeclub_http_fetch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
