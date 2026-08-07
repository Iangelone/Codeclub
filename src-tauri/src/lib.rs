use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, Read, Write},
    path::{Component, Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
use tauri::{webview::{PageLoadEvent, WebviewBuilder}, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder};

#[cfg(windows)]
use base64::Engine as _;
#[cfg(windows)]
use uiautomation::{inputs::Mouse, patterns::{UIInvokePattern, UIValuePattern}, types::{ControlType, Point}, UIAutomation};
#[cfg(windows)]
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
#[cfg(windows)]
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{EnumChildWindows, GetCursorPos, GetWindowRect, HWND_TOP, LoadCursorFromFileW, SetSystemCursor, SetWindowPos, ShowWindow, SystemParametersInfoW, OCR_NORMAL, SPI_SETCURSORS, SPIF_SENDCHANGE, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_SHOW};
#[cfg(windows)]
use windows::core::{BOOL, PCWSTR};

#[cfg(windows)]
fn computer_automation() -> Result<UIAutomation, String> {
    UIAutomation::new_direct()
        .or_else(|_| UIAutomation::new())
        .map_err(|error| format!("No se pudo inicializar UI Automation: {error}"))
}

#[cfg(windows)]
static COMPUTER_AUTOMATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
#[cfg(windows)]
static COMPUTER_OVERLAY_ACTIVE: AtomicBool = AtomicBool::new(false);

static BROWSER_WEBVIEW: OnceLock<tauri::Webview> = OnceLock::new();

#[cfg(windows)]
fn lock_computer_automation() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    COMPUTER_AUTOMATION_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Computer Use está ocupado.".to_string())
}

#[cfg(windows)]
fn start_computer_escape_monitor(app: AppHandle) {
    std::thread::spawn(move || {
        let mut was_down = false;
        loop {
            let is_down = unsafe { ((GetAsyncKeyState(VK_ESCAPE.0 as i32) as u16) & 0x8000) != 0 };
            if is_down && !was_down {
                if COMPUTER_OVERLAY_ACTIVE.load(Ordering::Relaxed) {
                    let _ = app.emit("codeclub-computer-escape", ());
                }
            }
            was_down = is_down;
            std::thread::sleep(Duration::from_millis(if COMPUTER_OVERLAY_ACTIVE.load(Ordering::Relaxed) { 16 } else { 50 }));
        }
    });
}

#[cfg(windows)]
fn set_computer_cursor(app: &AppHandle, active: bool) -> Result<(), String> {
    if !active {
        unsafe { SystemParametersInfoW(SPI_SETCURSORS, 0, None, SPIF_SENDCHANGE) }
            .map_err(|error| format!("No se pudo restaurar el cursor de Windows: {error}"))?;
        return Ok(());
    }

    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/cursors/dark/arrow.cur");
    let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
    let path = [
        dev_path,
        resource_dir.join("resources/cursors/dark/arrow.cur"),
        resource_dir.join("cursors/dark/arrow.cur"),
    ]
    .into_iter()
    .find(|candidate| candidate.exists())
    .ok_or_else(|| "No se encontró el cursor dark/arrow.cur en los recursos de Codeclub.".to_string())?;
    let wide_path: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let cursor = unsafe { LoadCursorFromFileW(PCWSTR(wide_path.as_ptr())) }
        .map_err(|error| format!("No se pudo cargar el cursor de Computer Use: {error}"))?;
    unsafe { SetSystemCursor(cursor, OCR_NORMAL) }
        .map_err(|error| format!("No se pudo activar el cursor de Computer Use: {error}"))?;
    Ok(())
}

#[cfg(windows)]
fn move_cursor_smoothly(target_x: i32, target_y: i32) -> Result<(), String> {
    let mut current = POINT::default();
    unsafe { GetCursorPos(&mut current) }
        .map_err(|error| format!("No se pudo leer la posición actual del cursor: {error}"))?;

    let delta_x = (target_x - current.x) as f64;
    let delta_y = (target_y - current.y) as f64;
    let distance = (delta_x * delta_x + delta_y * delta_y).sqrt();
    if distance <= 1.0 {
        return Mouse::new().move_to(&Point::new(target_x, target_y)).map_err(|error| error.to_string());
    }

    let steps = ((distance / 20.0).ceil() as u32).clamp(6, 48);
    let duration_ms = ((distance * 0.32).round() as u64).clamp(180, 650);
    let step_delay = Duration::from_millis((duration_ms / steps as u64).max(1));
    let mouse = Mouse::new();

    for step in 1..=steps {
        let progress = step as f64 / steps as f64;
        let eased = progress * progress * (3.0 - 2.0 * progress);
        let x = current.x as f64 + delta_x * eased;
        let y = current.y as f64 + delta_y * eased;
        mouse.move_to(&Point::new(x.round() as i32, y.round() as i32)).map_err(|error| error.to_string())?;
        if step < steps {
            std::thread::sleep(step_delay);
        }
    }
    Ok(())
}

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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentPluginSkill {
    id: String,
    name: String,
    description: String,
    content: String,
    plugin_name: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentPluginDescriptor {
    id: String,
    name: String,
    version: Option<String>,
    description: Option<String>,
    root: String,
    source: String,
    skills: Vec<AgentPluginSkill>,
    mcp_servers: serde_json::Value,
    warnings: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpStdioStartRequest {
    plugin_root: String,
    plugin_data: String,
    name: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    cwd: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpCallRequest {
    session_id: String,
    name: String,
    arguments: serde_json::Value,
}

struct McpSession {
    child: Child,
    stdin: ChildStdin,
    stdout: std::io::BufReader<std::process::ChildStdout>,
    next_id: u64,
}

#[derive(Default)]
struct McpRegistry {
    sessions: Mutex<HashMap<String, McpSession>>,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComputerActionRequest {
    action: String,
    x: Option<i32>,
    y: Option<i32>,
    text: Option<String>,
    key: Option<String>,
    target_name: Option<String>,
    automation_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ComputerWindow {
    title: String,
    class_name: String,
    handle: isize,
    bounds: [i32; 4],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ComputerScreenshot {
    mime_type: String,
    data: String,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ComputerElement {
    id: String,
    name: String,
    role: String,
    automation_id: String,
    enabled: bool,
    focused: bool,
    bounds: [i32; 4],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ComputerState {
    focused_window: Option<ComputerWindow>,
    focused_element: Option<ComputerElement>,
    elements: Vec<ComputerElement>,
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

#[derive(Clone, Deserialize, Serialize)]
struct MenuOverlayPayload {
    html: String,
    width: f64,
    height: f64,
}

#[derive(Default)]
struct MenuOverlayState {
    payload: Mutex<Option<MenuOverlayPayload>>,
}

#[cfg(windows)]
struct NativeChildMatch {
    target: RECT,
    matched: Option<HWND>,
}

#[cfg(windows)]
struct NativeZeroChildMatch {
    target: RECT,
    matched: Option<HWND>,
}

#[cfg(windows)]
unsafe extern "system" fn find_native_child(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let state = unsafe { &mut *(lparam.0 as *mut NativeChildMatch) };
    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok()
        && ((rect.right - rect.left) - (state.target.right - state.target.left)).abs() <= 4
        && ((rect.bottom - rect.top) - (state.target.bottom - state.target.top)).abs() <= 4
    {
        state.matched = Some(hwnd);
        return BOOL(0);
    }
    BOOL(1)
}

#[cfg(windows)]
unsafe extern "system" fn find_native_zero_child(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let state = unsafe { &mut *(lparam.0 as *mut NativeZeroChildMatch) };
    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok()
        && rect.left == state.target.left
        && rect.top == state.target.top
        && rect.right == rect.left
        && rect.bottom == rect.top
    {
        state.matched = Some(hwnd);
        return BOOL(0);
    }
    BOOL(1)
}

#[cfg(windows)]
fn repair_browser_child(main: &tauri::WebviewWindow, x: f64, y: f64, width: f64, height: f64) {
    let Ok(scale) = main.scale_factor() else { return; };
    let Ok(origin) = main.outer_position() else { return; };
    let target = RECT {
        left: origin.x + (x * scale).round() as i32,
        top: origin.y + (y * scale).round() as i32,
        right: origin.x + ((x + width) * scale).round() as i32,
        bottom: origin.y + ((y + height) * scale).round() as i32,
    };
    let mut outer = NativeChildMatch { target, matched: None };
    let Ok(parent) = main.hwnd() else { return; };
    unsafe {
        let _ = EnumChildWindows(Some(parent), Some(find_native_child), LPARAM((&mut outer as *mut NativeChildMatch) as isize));
        let Some(outer) = outer.matched else { return; };
        let mut inner = NativeZeroChildMatch { target, matched: None };
        let _ = EnumChildWindows(Some(outer), Some(find_native_zero_child), LPARAM((&mut inner as *mut NativeZeroChildMatch) as isize));
        if let Some(inner) = inner.matched {
            let px_width = ((width * scale).round() as i32).max(1);
            let px_height = ((height * scale).round() as i32).max(1);
            let _ = SetWindowPos(inner, Some(HWND_TOP), 0, 0, px_width, px_height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
            let _ = ShowWindow(inner, SW_SHOW);
        }
    }
}

#[cfg(windows)]
fn raise_menu_child(main: &tauri::WebviewWindow, x: f64, y: f64, width: f64, height: f64) {
    let Ok(scale) = main.scale_factor() else { return; };
    let Ok(origin) = main.outer_position() else { return; };
    let target = RECT {
        left: origin.x + (x * scale).round() as i32,
        top: origin.y + (y * scale).round() as i32,
        right: origin.x + ((x + width) * scale).round() as i32,
        bottom: origin.y + ((y + height) * scale).round() as i32,
    };
    let mut candidate = NativeChildMatch { target, matched: None };
    if let Ok(parent) = main.hwnd() {
        unsafe {
            let _ = EnumChildWindows(Some(parent), Some(find_native_child), LPARAM((&mut candidate as *mut NativeChildMatch) as isize));
            if let Some(child) = candidate.matched {
                let _ = SetWindowPos(child, Some(HWND_TOP), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            }
        }
    }
}

#[tauri::command]
fn codeclub_menu_overlay_content(state: State<'_, MenuOverlayState>) -> Result<Option<MenuOverlayPayload>, String> {
    state.payload.lock().map(|payload| payload.clone()).map_err(|error| error.to_string())
}

#[tauri::command]
fn codeclub_menu_overlay(
    app: AppHandle,
    state: State<'_, MenuOverlayState>,
    open: bool,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    html: String,
) -> Result<(), String> {
    let overlay_label = "codeclub-menu-overlay";
    if !open {
        if let Ok(mut payload) = state.payload.lock() {
            *payload = None;
        }
        if let Some(webview) = app.get_webview(overlay_label) {
            webview.close().map_err(|error| error.to_string())?;
        }
        if let Some(window) = app.get_webview_window(overlay_label) {
            window.close().map_err(|error| error.to_string())?;
        }
        return Ok(());
    }
    let payload = MenuOverlayPayload { html, width, height };
    *state.payload.lock().map_err(|error| error.to_string())? = Some(payload.clone());
    let main = app.get_webview_window("main").ok_or_else(|| "No se encontró la ventana principal.".to_string())?;
    if let Some(webview) = app.get_webview(overlay_label) {
        webview.set_position(LogicalPosition::new(x, y)).map_err(|error| error.to_string())?;
        webview.set_size(LogicalSize::new(width, height)).map_err(|error| error.to_string())?;
        webview.show().map_err(|error| error.to_string())?;
        #[cfg(windows)]
        raise_menu_child(&main, x, y, width, height);
        webview.emit("codeclub-menu-overlay-content", payload).map_err(|error| error.to_string())?;
        return Ok(());
    }
    let overlay_url = if cfg!(debug_assertions) {
        WebviewUrl::External("http://127.0.0.1:4321/menu-overlay/".parse().map_err(|error| format!("URL inválida para el menú overlay: {error}"))?)
    } else {
        WebviewUrl::App("menu-overlay".into())
    };
    if let Some(window) = app.get_webview_window(overlay_label) {
        // Ocultar conserva la instancia precargada para poder reutilizarla.
        window.hide().map_err(|error| error.to_string())?;
    }
    // El menú comparte jerarquía con el navegador. Al crearlo después, Windows
    // conserva el orden Z correcto sin congelar ni recalcular el WebView.
    let child_host = app.get_window("main").ok_or_else(|| "No se encontró la ventana principal.".to_string())?;
    let builder = WebviewBuilder::new(overlay_label, overlay_url.clone())
        .transparent(true)
        .background_color(tauri::window::Color(0, 0, 0, 0));
    let webview = child_host
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width, height))
        .map_err(|error| {
            eprintln!("[menu-overlay] no se pudo crear el WebView hijo: {error}");
            format!("No se pudo crear el menú overlay: {error}")
        })?;
    webview.show().map_err(|error| error.to_string())?;
    #[cfg(windows)]
    raise_menu_child(&main, x, y, width, height);
    webview.emit("codeclub-menu-overlay-content", payload.clone()).map_err(|error| error.to_string())?;
    let overlay_x = x;
    let overlay_y = y;
    if app.get_webview(overlay_label).is_some() {
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(&app, overlay_label, overlay_url)
        .title("Codeclub menu")
        .inner_size(width, height)
        .position(overlay_x, overlay_y)
        .owner(&main)
        .map_err(|error| format!("No se pudo asociar el menu a la ventana principal: {error}"))?
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(true)
        .build()
        .map_err(|error| format!("No se pudo crear el menú overlay: {error}"))?;
    window.emit("codeclub-menu-overlay-content", payload).map_err(|error| error.to_string())?;
    Ok(())
}

fn main_relative_position(main: &tauri::WebviewWindow, x: f64, y: f64) -> Result<(f64, f64), String> {
    let scale = main.scale_factor().map_err(|error| error.to_string())?;
    let position = main.outer_position().map_err(|error| error.to_string())?;
    Ok((position.x as f64 / scale + x, position.y as f64 / scale + y))
}

#[tauri::command]
fn codeclub_popup_window(
    app: AppHandle,
    state: State<'_, MenuOverlayState>,
    open: bool,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    html: String,
) -> Result<(), String> {
    let label = "codeclub-menu-overlay";
    if let Some(webview) = app.get_webview(label) {
        let _ = webview.close();
    }
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.close();
    }
    if !open {
        *state.payload.lock().map_err(|error| error.to_string())? = None;
        return Ok(());
    }

    let payload = MenuOverlayPayload { html, width, height };
    *state.payload.lock().map_err(|error| error.to_string())? = Some(payload.clone());
    let main = app.get_webview_window("main").ok_or_else(|| "No se encontró la ventana principal.".to_string())?;
    let (screen_x, screen_y) = main_relative_position(&main, x, y)?;
    let overlay_url = if cfg!(debug_assertions) {
        WebviewUrl::External("http://127.0.0.1:4321/menu-overlay/".parse().map_err(|error| format!("URL inválida para el menú: {error}"))?)
    } else {
        WebviewUrl::App("menu-overlay".into())
    };

    let builder = WebviewWindowBuilder::new(&app, label, overlay_url)
        .title("Codeclub menu")
        .inner_size(width, height)
        .position(screen_x, screen_y)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(true);
    let builder = if let Some(browser) = app.get_webview_window("codeclub-browser") {
        builder.owner(&browser).map_err(|error| format!("No se pudo asociar el menú al navegador: {error}"))?
    } else {
        builder.owner(&main).map_err(|error| format!("No se pudo asociar el menú a la app: {error}"))?
    };
    let window = builder.build().map_err(|error| format!("No se pudo crear el menú: {error}"))?;
    window.emit("codeclub-menu-overlay-content", payload).map_err(|error| error.to_string())
}

#[tauri::command]
fn codeclub_browser_window_open(
    app: AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("codeclub-browser") {
        let _ = window.close();
    } else if let Some(webview) = app.get_webview("codeclub-browser") {
        let _ = webview.close();
    }
    let parsed_url: tauri::Url = url.parse().map_err(|error| format!("URL inválida: {error}"))?;
    if !matches!(parsed_url.scheme(), "http" | "https") || parsed_url.host().is_none() {
        return Err("Solo se permiten URLs http(s) con dominio válido.".to_string());
    }
    let main = app.get_webview_window("main").ok_or_else(|| "No se encontró la ventana principal.".to_string())?;
    let (screen_x, screen_y) = main_relative_position(&main, x, y)?;
    let window = WebviewWindowBuilder::new(&app, "codeclub-browser", WebviewUrl::External(parsed_url))
        .title("Codeclub Browser")
        .inner_size(width, height)
        .position(screen_x, screen_y)
        .owner(&main)
        .map_err(|error| format!("No se pudo asociar el navegador a la app: {error}"))?
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .visible(true)
        .build()
        .map_err(|error| format!("No se pudo crear el navegador: {error}"))?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
fn codeclub_browser_window_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or_else(|| "No se encontró la ventana principal.".to_string())?;
    let browser = app.get_webview_window("codeclub-browser").ok_or_else(|| "El navegador no está disponible.".to_string())?;
    let (screen_x, screen_y) = main_relative_position(&main, x, y)?;
    browser.set_position(LogicalPosition::new(screen_x, screen_y)).map_err(|error| error.to_string())?;
    browser.set_size(LogicalSize::new(width, height)).map_err(|error| error.to_string())
}

fn codeclub_browser_webview(app: &AppHandle) -> Result<tauri::Webview, String> {
    // El navegador se precarga como WebView hijo; conservar este handle es
    // necesario porque get_webview() puede no registrar hijos de add_child.
    if let Some(webview) = BROWSER_WEBVIEW.get() {
        return Ok(webview.clone());
    }
    app.get_webview("codeclub-browser")
        .or_else(|| {
            app.get_window("main")?.webviews().into_iter().find(|webview| {
                webview.label() == "codeclub-browser"
            })
        })
        .ok_or_else(|| "El WebView del navegador no está disponible.".to_string())
}

#[tauri::command]
fn codeclub_browser_create_on_main_thread(
    app: AppHandle,
    parsed_url: tauri::Url,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let window = app.get_window("main").ok_or_else(|| "No se encontró la ventana principal.".to_string())?;
    // Reutilizar el WebView evita que close() bloquee el hilo nativo de
    // WebView2 y evita recreaciones/cargas duplicadas durante syncBounds.
    if let Some(existing) = BROWSER_WEBVIEW.get() {
        existing
            .set_position(LogicalPosition::new(x, y))
            .map_err(|error| format!("No se pudo reposicionar WebView2 existente: {error}"))?;
        existing
            .set_size(LogicalSize::new(width, height))
            .map_err(|error| format!("No se pudo redimensionar WebView2 existente: {error}"))?;
        existing.show().map_err(|error| error.to_string())?;
        existing
            .navigate(parsed_url)
            .map_err(|error| format!("No se pudo navegar WebView2 existente: {error}"))?;
        #[cfg(windows)]
        if let Some(main) = app.get_webview_window("main") {
            repair_browser_child(&main, x, y, width, height);
        }
        return Ok(());
    }
    let builder = WebviewBuilder::new("codeclub-browser", WebviewUrl::External(parsed_url.clone()))
        .focused(false)
        .on_navigation(|_url| true)
        .on_page_load(|webview, payload| {
            let page_url = payload.url().to_string();
            match payload.event() {
                PageLoadEvent::Started => {
                }
                PageLoadEvent::Finished => {
                    let _ = webview.emit("codeclub-browser-page-loaded", page_url);
                }
            }
        });
    let webview = window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    webview
        .set_auto_resize(true)
        .map_err(|error| format!("No se pudo activar auto-resize de WebView2: {error}"))?;
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|error| format!("No se pudo posicionar WebView2: {error}"))?;
    webview
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| format!("No se pudo dimensionar WebView2: {error}"))?;
    webview.show().map_err(|error| error.to_string())?;
    webview
        .navigate(parsed_url)
        .map_err(|error| format!("No se pudo iniciar navegación WebView2: {error}"))?;
    #[cfg(windows)]
    if let Some(main) = app.get_webview_window("main") {
        repair_browser_child(&main, x, y, width, height);
    }
    Ok(())
}

#[tauri::command]
fn codeclub_browser_create(app: AppHandle, url: String, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    let parsed_url: tauri::Url = url.parse().map_err(|error| format!("URL inválida: {error}"))?;
    if !matches!(parsed_url.scheme(), "http" | "https") || parsed_url.host().is_none() {
        return Err("Solo se permiten URLs http(s) con dominio válido.".to_string());
    }
    let app_for_main = app.clone();
    app.run_on_main_thread(move || {
        if let Err(error) = codeclub_browser_create_on_main_thread(app_for_main, parsed_url, x, y, width, height) {
            eprintln!("[browser] main-thread create failed: {error}");
        }
    })
    .map_err(|error| format!("No se pudo despachar creación de WebView2 al hilo principal: {error}"))
}

#[tauri::command]
fn codeclub_browser_navigate(app: AppHandle, url: String) -> Result<(), String> {
    let parsed_url: tauri::Url = url.parse().map_err(|error| format!("URL invÃ¡lida: {error}"))?;
    if !matches!(parsed_url.scheme(), "http" | "https") || parsed_url.host().is_none() {
        return Err("Solo se permiten URLs http(s) con dominio vÃ¡lido.".to_string());
    }
    codeclub_browser_webview(&app)?
        .navigate(parsed_url)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn codeclub_browser_close(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("codeclub-browser") {
        window.close().map_err(|error| error.to_string())?;
        return Ok(());
    }
    if let Ok(webview) = codeclub_browser_webview(&app) {
        webview.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn codeclub_browser_set_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("codeclub-browser") {
        if visible {
            window.show().map_err(|error| error.to_string())?;
        } else {
            window.hide().map_err(|error| error.to_string())?;
        }
        return Ok(());
    }
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
    let webview = codeclub_browser_webview(&app)?;
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    webview
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    #[cfg(windows)]
    if let Some(main) = app.get_webview_window("main") {
        repair_browser_child(&main, x, y, width, height);
    }
    Ok(())
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

const AGENT_PLUGIN_SCHEMA: &str = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const AGENT_MCP_SCHEMA: &str = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const AGENT_PLUGIN_SCHEMA_DOCUMENT: &str = include_str!("../resources/agent-plugins/1.0.0/plugin.schema.json");
const AGENT_MCP_SCHEMA_DOCUMENT: &str = include_str!("../resources/agent-plugins/1.0.0/mcp.schema.json");

fn path_inside(root: &Path, candidate: &Path) -> bool {
    candidate.canonicalize().map(|path| path.starts_with(root)).unwrap_or(false)
}

fn placeholder_path_stays_inside(value: &str, prefix: &str) -> bool {
    let suffix = value.strip_prefix(prefix).unwrap_or(value).trim_start_matches(['/', '\\']);
    let mut depth = 0i32;
    for component in Path::new(suffix).components() {
        match component {
            Component::ParentDir => { depth -= 1; if depth < 0 { return false; } }
            Component::Normal(_) => depth += 1,
            Component::CurDir | Component::RootDir | Component::Prefix(_) => {}
        }
    }
    true
}

fn valid_plugin_name(name: &str) -> bool {
    let chars: Vec<char> = name.chars().collect();
    !chars.is_empty() && chars.len() <= 64
        && chars.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '-' || *c == '.')
        && chars.first().is_some_and(|c| c.is_ascii_alphanumeric())
        && chars.last().is_some_and(|c| c.is_ascii_alphanumeric())
        && !name.contains("--") && !name.contains("..")
}

fn valid_skill_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') && !name.starts_with('-') && !name.ends_with('-') && !name.contains("--")
}

fn json_string(object: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<String> {
    object.get(key).and_then(|value| value.as_str()).map(str::to_string)
}

fn validate_plugin_manifest(value: &serde_json::Value) -> Result<(String, Option<String>, Option<String>, Vec<String>), String> {
    debug_assert!(AGENT_PLUGIN_SCHEMA_DOCUMENT.contains(AGENT_PLUGIN_SCHEMA));
    let object = value.as_object().ok_or_else(|| "plugin.json debe contener un objeto JSON.".to_string())?;
    let schema = json_string(object, "$schema").ok_or_else(|| "Falta $schema en plugin.json.".to_string())?;
    if schema != AGENT_PLUGIN_SCHEMA { return Err(format!("Schema Agent Plugins no soportado: {schema}")); }
    let name = json_string(object, "name").ok_or_else(|| "Falta name en plugin.json.".to_string())?;
    if !valid_plugin_name(&name) { return Err("name no cumple las restricciones de Agent Plugins.".into()); }
    let mut warnings = Vec::new();
    for key in object.keys() {
        if !["$schema", "name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions"].contains(&key.as_str()) {
            warnings.push(format!("Campo desconocido ignorado en plugin.json: {key}"));
        }
    }
    for key in ["version", "description", "homepage", "repository", "license"] {
        if object.contains_key(key) && object.get(key).and_then(|value| value.as_str()).is_none() {
            return Err(format!("{key} debe ser texto en plugin.json."));
        }
    }
    if let Some(author) = object.get("author") {
        let author = author.as_object().ok_or_else(|| "author debe ser un objeto.".to_string())?;
        for key in author.keys() {
            if !["name", "email", "url"].contains(&key.as_str()) { return Err(format!("Campo author desconocido: {key}")); }
        }
        if author.values().any(|value| value.as_str().is_none()) { return Err("Los campos de author deben ser texto.".into()); }
    }
    if let Some(keywords) = object.get("keywords") {
        let keywords = keywords.as_array().ok_or_else(|| "keywords debe ser un arreglo.".to_string())?;
        if keywords.iter().any(|value| value.as_str().is_none()) { return Err("keywords solo puede contener textos.".into()); }
    }
    if let Some(extensions) = object.get("extensions") && !extensions.is_object() {
        warnings.push("extensions no es un objeto y fue ignorado.".into());
    }
    Ok((name, json_string(object, "version"), json_string(object, "description"), warnings))
}

fn validate_mcp_entry(name: &str, value: &serde_json::Value, root: &Path) -> Result<serde_json::Value, String> {
    debug_assert!(AGENT_MCP_SCHEMA_DOCUMENT.contains(AGENT_MCP_SCHEMA));
    let object = value.as_object().ok_or_else(|| format!("MCP {name}: la entrada debe ser un objeto."))?;
    let transport = object.get("type").and_then(|value| value.as_str()).ok_or_else(|| format!("MCP {name}: falta type."))?;
    let allowed: &[&str] = match transport { "stdio" => &["type", "command", "args", "env", "cwd"], "streamable-http" => &["type", "url", "headers"], "sse" => &["type", "url", "headers"], _ => return Err(format!("MCP {name}: transporte no soportado: {transport}")) };
    if object.keys().any(|key| !allowed.contains(&key.as_str())) { return Err(format!("MCP {name}: contiene campos desconocidos.")); }
    match transport {
        "stdio" => {
            let command = object.get("command").and_then(|value| value.as_str()).ok_or_else(|| format!("MCP {name}: falta command."))?;
            if command.trim().is_empty() || command.contains(char::is_whitespace) { return Err(format!("MCP {name}: command debe ser un token.")); }
            if let Some(args) = object.get("args") { if args.as_array().is_none_or(|items| items.iter().any(|item| item.as_str().is_none())) { return Err(format!("MCP {name}: args inválidos.")); } }
            if let Some(env) = object.get("env") {
                if env.as_object().is_none_or(|items| items.keys().any(|key| key == "PLUGIN_ROOT" || key == "PLUGIN_DATA") || items.values().any(|item| item.as_str().is_none())) { return Err(format!("MCP {name}: env inválido.")); }
            }
            for key in ["command", "cwd"] {
                if let Some(path) = object.get(key).and_then(|value| value.as_str()) && path.starts_with("./") {
                    let resolved = root.join(path);
                    if !path_inside(root, &resolved) { return Err(format!("MCP {name}: {key} escapa del plugin.")); }
                }
            }
            if let Some(cwd) = object.get("cwd").and_then(|value| value.as_str()) {
                let valid_form = cwd.starts_with("./") || cwd == "${PLUGIN_ROOT}" || cwd.starts_with("${PLUGIN_ROOT}/") || cwd == "${PLUGIN_DATA}" || cwd.starts_with("${PLUGIN_DATA}/");
                let valid_containment = if cwd.starts_with("./") || cwd.starts_with("${PLUGIN_ROOT}") { placeholder_path_stays_inside(cwd, if cwd.starts_with("./") { "./" } else { "${PLUGIN_ROOT}" }) } else { placeholder_path_stays_inside(cwd, "${PLUGIN_DATA}") };
                if !valid_form || !valid_containment { return Err(format!("MCP {name}: cwd debe usar una ruta contenida del plugin o PLUGIN_DATA.")); }
            }
        }
        "streamable-http" | "sse" => {
            let url = object.get("url").and_then(|value| value.as_str()).ok_or_else(|| format!("MCP {name}: falta url."))?;
            if url.contains('#') || url.contains('@') || (!url.starts_with("https://") && !url.starts_with("http://")) { return Err(format!("MCP {name}: url inválida.")); }
            if url.starts_with("http://") {
                let host = url.trim_start_matches("http://").split(['/', ':']).next().unwrap_or_default();
                if !["localhost", "127.0.0.1", "::1"].contains(&host) { return Err(format!("MCP {name}: los endpoints remotos deben usar HTTPS.")); }
            }
            if let Some(headers) = object.get("headers") {
                let Some(items) = headers.as_object() else { return Err(format!("MCP {name}: headers inválidos.")); };
                let mut names = std::collections::HashSet::new();
                for (key, value) in items { if value.as_str().is_none() || !names.insert(key.to_lowercase()) { return Err(format!("MCP {name}: headers inválidos.")); } }
            }
        }
        _ => unreachable!(),
    }
    Ok(value.clone())
}

#[tauri::command]
fn codeclub_list_agent_plugins(app: AppHandle, project_path: String) -> Result<Vec<AgentPluginDescriptor>, String> {
    let mut roots = Vec::new();
    if !project_path.trim().is_empty() { roots.push((PathBuf::from(project_path).join(".codeclub/plugins"), "project".to_string())); }
    if let Ok(config) = app.path().app_config_dir() { roots.push((config.join("plugins"), "global".to_string())); }
    let mut plugins = Vec::new();
    for (plugins_root, source) in roots {
        if !plugins_root.is_dir() { continue; }
        let entries = fs::read_dir(&plugins_root).map_err(|error| format!("No se pudieron listar plugins: {error}"))?;
        for entry in entries.flatten() {
            let root = entry.path();
            if !root.is_dir() { continue; }
            let root = match root.canonicalize() { Ok(root) => root, Err(_) => continue };
            let manifest_path = root.join("plugin.json");
            if !manifest_path.is_file() || !path_inside(&root, &manifest_path) { continue; }
            let manifest = match fs::read_to_string(&manifest_path).ok().and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok()) {
                Some(value) => value,
                None => continue,
            };
            let (name, version, description, mut warnings) = match validate_plugin_manifest(&manifest) { Ok(value) => value, Err(error) => { eprintln!("Plugin rechazado en {}: {error}", root.display()); continue; } };
            let mut skills = Vec::new();
            let skills_root = root.join("skills");
            if skills_root.is_dir() {
                for child in fs::read_dir(&skills_root).into_iter().flatten().flatten() {
                    let dir = child.path();
                    let skill_file = dir.join("SKILL.md");
                    if !dir.is_dir() || !skill_file.is_file() || !path_inside(&root, &skill_file) { continue; }
                    let Ok(content) = fs::read_to_string(&skill_file) else { continue };
                    let id = dir.file_name().and_then(|value| value.to_str()).unwrap_or_default().to_string();
                    let Some(skill_name) = frontmatter_value(&content, "name") else { continue };
                    let Some(skill_description) = frontmatter_value(&content, "description") else { continue };
                    if id.is_empty() || !valid_skill_name(&skill_name) || skill_description.is_empty() || skill_description.len() > 1024 { continue; }
                    skills.push(AgentPluginSkill { id, name: skill_name, description: skill_description, content, plugin_name: name.clone() });
                }
            }
            let mut mcp_servers = serde_json::json!({});
            let mcp_path = root.join("mcp.json");
            if mcp_path.is_file() {
                let parsed = match fs::read_to_string(&mcp_path).ok().and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok()) {
                    Some(value) => Some(value),
                    None => { warnings.push("mcp.json no contiene JSON válido.".into()); None },
                };
                if let Some(config) = parsed.and_then(|value| {
                    let object = value.as_object()?;
                    if object.keys().any(|key| !["$schema", "mcpServers"].contains(&key.as_str())) { warnings.push("mcp.json contiene campos desconocidos.".into()); return None; }
                    if object.get("$schema")?.as_str()? != AGENT_MCP_SCHEMA { warnings.push("mcp.json usa un schema no soportado.".into()); return None; }
                    let Some(servers) = object.get("mcpServers").and_then(|value| value.as_object()) else { warnings.push("mcpServers debe ser un objeto.".into()); return None; };
                    let mut valid = serde_json::Map::new();
                    for (server_name, entry) in servers { match validate_mcp_entry(server_name, entry, &root) { Ok(value) => { valid.insert(server_name.clone(), value); }, Err(error) => warnings.push(error) } }
                    Some(serde_json::Value::Object(valid))
                }) { mcp_servers = config; }
            }
            plugins.push(AgentPluginDescriptor { id: name.clone(), name, version, description, root: root.to_string_lossy().to_string(), source: source.clone(), skills, mcp_servers, warnings });
        }
    }
    plugins.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(plugins)
}

fn mcp_request(session: &mut McpSession, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
    let id = session.next_id;
    session.next_id += 1;
    let request = serde_json::json!({"jsonrpc":"2.0","id":id,"method":method,"params":params});
    writeln!(session.stdin, "{}", request).map_err(|error| error.to_string())?;
    session.stdin.flush().map_err(|error| error.to_string())?;
    let mut line = String::new();
    loop {
        line.clear();
        if session.stdout.read_line(&mut line).map_err(|error| error.to_string())? == 0 { return Err("El servidor MCP cerró stdout.".into()); }
        let value: serde_json::Value = match serde_json::from_str(line.trim()) { Ok(value) => value, Err(_) => continue };
        if value.get("id").and_then(|value| value.as_u64()) == Some(id) {
            if let Some(error) = value.get("error") { return Err(error.to_string()); }
            return Ok(value.get("result").cloned().unwrap_or(serde_json::Value::Null));
        }
    }
}

#[tauri::command]
fn codeclub_mcp_stdio_start(state: State<'_, McpRegistry>, request: McpStdioStartRequest) -> Result<serde_json::Value, String> {
    let root = PathBuf::from(&request.plugin_root).canonicalize().map_err(|error| error.to_string())?;
    let data = PathBuf::from(&request.plugin_data);
    fs::create_dir_all(&data).map_err(|error| error.to_string())?;
    let command_path = if request.command.starts_with("./") { root.join(&request.command).canonicalize().map_err(|error| error.to_string())? } else { PathBuf::from(&request.command) };
    if request.command.starts_with("./") && !command_path.starts_with(&root) { return Err("command escapa del plugin.".into()); }
    let cwd = request.cwd.as_deref().map(|value| value.replace("${PLUGIN_ROOT}", &root.to_string_lossy()).replace("${PLUGIN_DATA}", &data.to_string_lossy())).unwrap_or_else(|| root.to_string_lossy().to_string());
    let cwd_path = PathBuf::from(&cwd).canonicalize().map_err(|error| format!("No se pudo resolver cwd de MCP: {error}"))?;
    if !cwd_path.starts_with(&root) && !cwd_path.starts_with(&data) { return Err("cwd escapa del plugin o de PLUGIN_DATA.".into()); }
    let mut environment = std::env::vars().collect::<HashMap<_, _>>();
    for (key, value) in request.env { environment.insert(key, value.replace("${PLUGIN_ROOT}", &root.to_string_lossy()).replace("${PLUGIN_DATA}", &data.to_string_lossy())); }
    environment.insert("PLUGIN_ROOT".into(), root.to_string_lossy().to_string());
    environment.insert("PLUGIN_DATA".into(), data.to_string_lossy().to_string());
    let mut command = if cfg!(windows) && (command_path.extension().and_then(|value| value.to_str()) == Some("cmd") || command_path.extension().and_then(|value| value.to_str()) == Some("bat")) { let mut cmd = Command::new("cmd"); cmd.arg("/C").arg(&command_path); cmd } else { Command::new(&command_path) };
    let args = request.args.into_iter().map(|value| value.replace("${PLUGIN_ROOT}", &root.to_string_lossy()).replace("${PLUGIN_DATA}", &data.to_string_lossy())).collect::<Vec<_>>();
    let mut child = command.args(args).current_dir(cwd).envs(environment).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|error| format!("No se pudo iniciar MCP {}: {error}", request.name))?;
    let stdin = child.stdin.take().ok_or_else(|| "MCP no expuso stdin.".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "MCP no expuso stdout.".to_string())?;
    let mut session = McpSession { child, stdin, stdout: std::io::BufReader::new(stdout), next_id: 1 };
    mcp_request(&mut session, "initialize", serde_json::json!({"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"Codeclub","version":"0.1.0"}}))?;
    writeln!(session.stdin, "{}", serde_json::json!({"jsonrpc":"2.0","method":"notifications/initialized"})).map_err(|error| error.to_string())?;
    session.stdin.flush().map_err(|error| error.to_string())?;
    let tools = mcp_request(&mut session, "tools/list", serde_json::json!({}))?;
    let id = format!("mcp-{}-{}", request.name, now_millis());
    state.sessions.lock().map_err(|_| "No se pudo registrar MCP.".to_string())?.insert(id.clone(), session);
    Ok(serde_json::json!({"sessionId":id,"tools":tools.get("tools").cloned().unwrap_or(serde_json::json!([]))}))
}

#[tauri::command]
fn codeclub_mcp_stdio_call(state: State<'_, McpRegistry>, request: McpCallRequest) -> Result<serde_json::Value, String> {
    let mut sessions = state.sessions.lock().map_err(|_| "No se pudo acceder a MCP.".to_string())?;
    let session = sessions.get_mut(&request.session_id).ok_or_else(|| "Sesión MCP inexistente.".to_string())?;
    mcp_request(session, "tools/call", serde_json::json!({"name":request.name,"arguments":request.arguments}))
}

#[tauri::command]
fn codeclub_mcp_stdio_close(state: State<'_, McpRegistry>, session_id: String) -> Result<(), String> {
    if let Some(mut session) = state.sessions.lock().map_err(|_| "No se pudo acceder a MCP.".to_string())?.remove(&session_id) { let _ = session.child.kill(); }
    Ok(())
}

#[tauri::command]
fn codeclub_agent_plugin_data(app: AppHandle, plugin_id: String) -> Result<String, String> {
    if !valid_plugin_name(&plugin_id) { return Err("Identificador de plugin inválido.".into()); }
    let root = app.path().app_cache_dir().map_err(|error| error.to_string())?.join("agent-plugins").join(plugin_id);
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
fn codeclub_delete_agent_plugin(project_path: String, plugin_id: String) -> Result<(), String> {
    if !valid_plugin_name(&plugin_id) { return Err("Identificador de plugin inválido.".into()); }
    let root = workspace_root(&project_path)?;
    let plugins_root = root.join(".codeclub/plugins").canonicalize().unwrap_or_else(|_| root.join(".codeclub/plugins"));
    let target = plugins_root.join(&plugin_id);
    if !target.exists() { return Err("No se encontró el paquete Agent Plugin.".into()); }
    let resolved = target.canonicalize().map_err(|error| error.to_string())?;
    if !resolved.starts_with(&plugins_root) { return Err("El plugin está fuera del directorio permitido.".into()); }
    fs::remove_dir_all(resolved).map_err(|error| format!("No se pudo eliminar el plugin: {error}"))
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
fn codeclub_computer_get_state() -> Result<ComputerState, String> {
    #[cfg(windows)]
    {
        let _automation_guard = lock_computer_automation()?;
        fn element_id(element: &uiautomation::UIElement) -> String {
            element.get_runtime_id().map(|id| id.iter().map(ToString::to_string).collect::<Vec<_>>().join("-")).unwrap_or_default()
        }
        fn describe(element: &uiautomation::UIElement, focused_id: &str) -> Option<ComputerElement> {
            let rect = element.get_bounding_rectangle().ok()?;
            let role = element.get_control_type().map(|value| format!("{value:?}")).unwrap_or_else(|_| "Unknown".to_string());
            let id = element_id(element);
            Some(ComputerElement {
                id,
                name: element.get_name().unwrap_or_default(),
                role,
                automation_id: element.get_automation_id().unwrap_or_default(),
                enabled: element.is_enabled().unwrap_or(false),
                focused: element.has_keyboard_focus().unwrap_or(false) || element_id(element) == focused_id,
                bounds: [rect.get_left(), rect.get_top(), rect.get_right(), rect.get_bottom()],
            })
        }
        fn walk(element: &uiautomation::UIElement, walker: &uiautomation::UITreeWalker, focused_id: &str, elements: &mut Vec<ComputerElement>, depth: usize) {
            if depth > 5 || elements.len() >= 80 { return; }
            if let Some(item) = describe(element, focused_id) {
                if item.role != "Window" && (!item.name.is_empty() || !item.automation_id.is_empty()) { elements.push(item); }
            }
            let mut child = walker.get_first_child(element).ok();
            while let Some(item) = child {
                walk(&item, walker, focused_id, elements, depth + 1);
                child = walker.get_next_sibling(&item).ok();
                if elements.len() >= 80 { break; }
            }
        }

        let automation = computer_automation()?;
        let focused = automation.get_focused_element().ok();
        let focused_id = focused.as_ref().map(element_id).unwrap_or_default();
        let walker = automation.get_control_view_walker().map_err(|error| error.to_string())?;
        let mut focused_window = None;
        let mut window = focused.clone();
        for _ in 0..10 {
            let Some(element) = window else { break; };
            if element.get_control_type().ok() == Some(ControlType::Window) {
                let rect = element.get_bounding_rectangle().map_err(|error| error.to_string())?;
                focused_window = Some(ComputerWindow {
                    title: element.get_name().unwrap_or_default(),
                    class_name: element.get_classname().unwrap_or_default(),
                    handle: element.get_native_window_handle().map(|handle| handle.into()).unwrap_or_default(),
                    bounds: [rect.get_left(), rect.get_top(), rect.get_right(), rect.get_bottom()],
                });
                let mut elements = Vec::new();
                walk(&element, &walker, &focused_id, &mut elements, 0);
                return Ok(ComputerState { focused_window, focused_element: focused.as_ref().and_then(|item| describe(item, &focused_id)), elements });
            }
            window = walker.get_parent(&element).ok();
        }
        Ok(ComputerState { focused_window, focused_element: focused.as_ref().and_then(|item| describe(item, &focused_id)), elements: Vec::new() })
    }
    #[cfg(not(windows))]
    { Err("Computer Use solo está disponible en Windows.".to_string()) }
}

#[tauri::command]
fn codeclub_computer_list_windows() -> Result<Vec<ComputerWindow>, String> {
    #[cfg(windows)]
    {
        let _automation_guard = lock_computer_automation()?;
        let automation = computer_automation()?;
        let root = automation.get_root_element().map_err(|error| error.to_string())?;
        let walker = automation.get_control_view_walker().map_err(|error| error.to_string())?;
        let mut windows = Vec::new();
        let mut current = walker.get_first_child(&root).ok();
        let mut inspected = 0;
        while let Some(element) = current {
            inspected += 1;
            if inspected > 80 { break; }
            if element.get_control_type().ok() == Some(ControlType::Window) {
                let rect = element.get_bounding_rectangle().map_err(|error| error.to_string())?;
                windows.push(ComputerWindow {
                    title: element.get_name().unwrap_or_default(),
                    class_name: element.get_classname().unwrap_or_default(),
                    handle: element.get_native_window_handle().map(|handle| handle.into()).unwrap_or_default(),
                    bounds: [rect.get_left(), rect.get_top(), rect.get_right(), rect.get_bottom()],
                });
            }
            current = walker.get_next_sibling(&element).ok();
        }
        return Ok(windows);
    }
    #[cfg(not(windows))]
    { Err("Computer Use solo está disponible en Windows.".to_string()) }
}

#[tauri::command]
fn codeclub_computer_screenshot() -> Result<ComputerScreenshot, String> {
    #[cfg(windows)]
    {
        let _automation_guard = lock_computer_automation()?;
        let screenshot = uiautomation::screenshots::Screenshot::capture_desktop().map_err(|error| error.to_string())?;
        let path = std::env::temp_dir().join(format!("codeclub-computer-{}.png", std::process::id()));
        screenshot.save_png(&path).map_err(|error| error.to_string())?;
        let bytes = fs::read(&path).map_err(|error| error.to_string());
        let _ = fs::remove_file(&path);
        let bytes = bytes?;
        return Ok(ComputerScreenshot {
            mime_type: "image/png".to_string(),
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
            width: screenshot.width(),
            height: screenshot.height(),
        });
    }
    #[cfg(not(windows))]
    { Err("Computer Use solo está disponible en Windows.".to_string()) }
}

#[tauri::command]
fn codeclub_computer_action(request: ComputerActionRequest) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _automation_guard = lock_computer_automation()?;
        let automation = computer_automation()?;
        let target = if request.target_name.is_some() || request.automation_id.is_some() {
            let root = automation.get_root_element().map_err(|error| error.to_string())?;
            let mut matcher = automation.create_matcher().from(root).timeout(1500);
            if let Some(name) = request.target_name.as_deref() { matcher = matcher.match_name(name); }
            if let Some(automation_id) = request.automation_id.as_deref() {
                matcher = matcher.filter_fn(Box::new({ let expected = automation_id.to_string(); move |element: &uiautomation::UIElement| Ok(element.get_automation_id().unwrap_or_default() == expected) }));
            }
            matcher.find_first().ok()
        } else { None };
        if let Some(element) = target {
            match request.action.as_str() {
                "focus" => return element.set_focus().map_err(|error| error.to_string()),
                "click" | "doubleClick" | "rightClick" => {
                    if request.action == "click" {
                        if let Ok(pattern) = element.get_pattern::<UIInvokePattern>() { return pattern.invoke().map_err(|error| error.to_string()); }
                    }
                    let rect = element.get_bounding_rectangle().map_err(|error| error.to_string())?;
                    let point = Point::new((rect.get_left() + rect.get_right()) / 2, (rect.get_top() + rect.get_bottom()) / 2);
                    return match request.action.as_str() {
                        "doubleClick" => Mouse::new().double_click(&point).map_err(|error| error.to_string()),
                        "rightClick" => Mouse::new().right_click(&point).map_err(|error| error.to_string()),
                        _ => Mouse::new().click(&point).map_err(|error| error.to_string()),
                    };
                }
                "type" => {
                    element.set_focus().map_err(|error| error.to_string())?;
                    if let Ok(pattern) = element.get_pattern::<UIValuePattern>() {
                        if let Some(text) = request.text.as_deref() { return pattern.set_value(text).map_err(|error| error.to_string()); }
                    }
                    return automation.get_root_element().map_err(|error| error.to_string())?.send_text_by_clipboard(&request.text.unwrap_or_default()).map_err(|error| error.to_string());
                }
                _ => {}
            }
        }
        match request.action.as_str() {
            "move" => move_cursor_smoothly(request.x.ok_or("Falta x")?, request.y.ok_or("Falta y")?),
            "click" => Mouse::new().click(&Point::new(request.x.ok_or("Falta x")?, request.y.ok_or("Falta y")?)).map_err(|error| error.to_string()),
            "doubleClick" => Mouse::new().double_click(&Point::new(request.x.ok_or("Falta x")?, request.y.ok_or("Falta y")?)).map_err(|error| error.to_string()),
            "rightClick" => Mouse::new().right_click(&Point::new(request.x.ok_or("Falta x")?, request.y.ok_or("Falta y")?)).map_err(|error| error.to_string()),
            "type" => automation.get_root_element().map_err(|error| error.to_string())?.send_text_by_clipboard(&request.text.unwrap_or_default()).map_err(|error| error.to_string()),
            "key" => automation.get_root_element().map_err(|error| error.to_string())?.send_keys(&request.key.unwrap_or_default(), 10).map_err(|error| error.to_string()),
            _ => Err("Acción de Computer Use no reconocida.".to_string()),
        }
    }
    #[cfg(not(windows))]
    { let _ = request; Err("Computer Use solo está disponible en Windows.".to_string()) }
}

#[tauri::command]
fn codeclub_computer_overlay(app: AppHandle, active: bool, provider: Option<String>) -> Result<(), String> {
    #[cfg(windows)]
    {
        set_computer_cursor(&app, active)?;
        COMPUTER_OVERLAY_ACTIVE.store(active, Ordering::Relaxed);
    }
    let provider_name = provider
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "Codeclub".to_string());
    app.emit("codeclub-computer-provider", provider_name)
        .map_err(|error| error.to_string())?;
    if let Some(window) = app.get_webview_window("computer-use-overlay") {
        if active { window.show().map_err(|error| error.to_string())?; }
        else { window.hide().map_err(|error| error.to_string())?; }
    }
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
        .setup(|app| {
            #[cfg(windows)]
            start_computer_escape_monitor(app.handle().clone());
            let overlay_url = if cfg!(debug_assertions) {
                WebviewUrl::External("http://127.0.0.1:4321/computer-overlay/".parse().map_err(|error| format!("URL invalida para el overlay: {error}"))?)
            } else {
                WebviewUrl::App("computer-overlay".into())
            };
            let monitor = app.get_webview_window("main").and_then(|window| window.primary_monitor().ok().flatten());
            let (monitor_x, monitor_y, monitor_width, monitor_height, monitor_scale) = monitor
                .map(|monitor| {
                    let size = monitor.size();
                    (
                        monitor.position().x,
                        monitor.position().y,
                        size.width as f64,
                        size.height as f64,
                        monitor.scale_factor(),
                    )
                })
                .unwrap_or((0, 0, 1920.0, 1080.0, 1.0));
            let overlay = WebviewWindowBuilder::new(app, "computer-use-overlay", overlay_url)
                .title("Codeclub is using your computer")
                .inner_size(monitor_width / monitor_scale, monitor_height / monitor_scale)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .focusable(false)
                .visible(false)
                .build()
                .map_err(|error| format!("No se pudo crear el overlay de Computer Use: {error}"))?;
            overlay.set_ignore_cursor_events(true).map_err(|error| format!("No se pudo hacer click-through el overlay: {error}"))?;
            overlay.set_position(PhysicalPosition::new(monitor_x, monitor_y)).map_err(|error| error.to_string())?;

            // Crear el WebView hijo durante setup evita el deadlock de WebView2
            // cuando add_child se invoca desde un comando IPC posterior.
            if let Some(main) = app.get_window("main") {
                let browser_url = WebviewUrl::External("about:blank".parse().map_err(|error| format!("URL invalida para el navegador: {error}"))?);
                let browser = main
                    .add_child(
                        WebviewBuilder::new("codeclub-browser", browser_url).focused(false),
                        LogicalPosition::new(0.0, 0.0),
                        LogicalSize::new(1.0, 1.0),
                    )
                    .map_err(|error| format!("No se pudo precargar el WebView2 del navegador: {error}"))?;
                browser.hide().map_err(|error| error.to_string())?;
                // El handle debe vivir durante toda la sesión; si se descarta
                // al salir de setup, el manager deja de encontrar el hijo y el
                // siguiente create vuelve a entrar en add_child (que bloquea).
                BROWSER_WEBVIEW
                    .set(browser)
                    .map_err(|_| "El WebView2 del navegador ya estaba precargado.".to_string())?;
            }
            Ok(())
        })
        .manage(TerminalRegistry::default())
        .manage(McpRegistry::default())
        .manage(WhatsAppRegistry::default())
        .manage(MenuOverlayState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            codeclub_menu_overlay,
            codeclub_popup_window,
            codeclub_menu_overlay_content,
            codeclub_list_files,
            codeclub_index_project,
            codeclub_get_username,
            codeclub_list_skills,
            codeclub_list_agent_plugins,
            codeclub_mcp_stdio_start,
            codeclub_mcp_stdio_call,
            codeclub_mcp_stdio_close,
            codeclub_agent_plugin_data,
            codeclub_delete_agent_plugin,
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
            codeclub_computer_get_state,
            codeclub_computer_list_windows,
            codeclub_computer_screenshot,
            codeclub_computer_action,
            codeclub_computer_overlay,
            codeclub_browser_create,
            codeclub_browser_window_open,
            codeclub_browser_window_bounds,
            codeclub_browser_navigate,
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

#[cfg(test)]
mod agent_plugin_tests {
    use super::{valid_plugin_name, valid_skill_name};

    #[test]
    fn validates_agent_plugin_names() {
        assert!(valid_plugin_name("acme.tools"));
        assert!(valid_plugin_name("lint3r"));
        assert!(!valid_plugin_name("My-Plugin"));
        assert!(!valid_plugin_name("has--double"));
        assert!(!valid_plugin_name("-start"));
    }

    #[test]
    fn validates_agent_skill_names() {
        assert!(valid_skill_name("frontend-review"));
        assert!(!valid_skill_name("Frontend Review"));
        assert!(!valid_skill_name("double--dash"));
    }

    #[test]
    fn bundles_canonical_agent_plugin_schemas() {
        let plugin: serde_json::Value = serde_json::from_str(super::AGENT_PLUGIN_SCHEMA_DOCUMENT).expect("plugin schema JSON");
        let mcp: serde_json::Value = serde_json::from_str(super::AGENT_MCP_SCHEMA_DOCUMENT).expect("mcp schema JSON");
        assert_eq!(plugin["$id"], super::AGENT_PLUGIN_SCHEMA);
        assert_eq!(mcp["$id"], super::AGENT_MCP_SCHEMA);
    }
}
