pub mod commands;
pub mod db;
pub mod error;
pub mod model;
pub mod settings;
pub mod workspace;

use commands::documents::DocumentService;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager, WindowEvent};

/// 关窗拦截的「已放行」标志。
///
/// 第一次收到关闭请求时拦下，让前端先落盘；前端落盘完毕调用
/// `close_window` 命令再真正关闭。若前端因故没响应，用户再点一次关闭
/// 就会直接放行 —— 绝不把应用变成关不掉的窗口。
static CLOSE_APPROVED: AtomicBool = AtomicBool::new(false);

/// 启动时由 Windows 文件关联传入的待打开文件。
///
/// NSIS 会把关联文件作为命令行参数传给应用；前端启动后通过命令一次性取走，
/// 这样打开 `.txt` / `.md` / `.markdown` 时会复用现有的「打开文件」流程。
struct OpenedFiles(Mutex<Vec<String>>);

fn supported_open_file(raw: &std::ffi::OsStr) -> Option<String> {
    let path = Path::new(raw);
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if matches!(extension.as_str(), "txt" | "md" | "markdown") {
        Some(path.to_string_lossy().into_owned())
    } else {
        None
    }
}

fn command_line_opened_files() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .filter_map(|arg| supported_open_file(&arg))
        .collect()
}

fn parse_instance_args(args: &[String], cwd: &str) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter_map(|arg| {
            let p = Path::new(arg);
            let extension = p.extension()?.to_str()?.to_ascii_lowercase();
            if matches!(extension.as_str(), "txt" | "md" | "markdown") {
                let absolute = if p.is_relative() {
                    Path::new(cwd).join(p)
                } else {
                    p.to_path_buf()
                };
                Some(absolute.to_string_lossy().into_owned())
            } else {
                None
            }
        })
        .collect()
}

/// 取走启动时由文件关联传入的路径；重复调用不会重复打开同一个文件。
#[tauri::command]
fn opened_files(files: tauri::State<'_, OpenedFiles>) -> Vec<String> {
    files
        .0
        .lock()
        .map(|mut paths| std::mem::take(&mut *paths))
        .unwrap_or_default()
}

/// 解析工作区根目录，优先级（从高到低）：
/// 1. `CRAB_MD_WORKSPACE` 环境变量 —— 便于测试与多工作区
/// 2. 设置文件里的自定义路径（用户在设置页选的）
/// 3. 平台应用数据目录下的 `workspace`（默认）
///
/// 设置文件位于**应用配置目录**，不在工作区里 —— 工作区根路径本身
/// 就是要被它配置的东西，放进去会成鸡生蛋。
fn resolve_workspace_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    if let Ok(custom) = std::env::var("CRAB_MD_WORKSPACE") {
        if !custom.trim().is_empty() {
            return Ok(std::path::PathBuf::from(custom));
        }
    }

    let config_dir = app.path().app_config_dir()?;
    let stored = settings::load(&config_dir);
    if let Some(raw) = stored.workspace_root_clean() {
        // 设置文件可能被手工改坏（写成相对路径等）。校验失败就退回默认位置，
        // 而不是拒绝启动 —— 打不开应用比用错目录更糟。
        match settings::validate_workspace_root(raw) {
            Ok(path) => return Ok(path),
            Err(_) => eprintln!("crab-md: ignoring invalid workspaceRoot in settings: {raw}"),
        }
    }

    let base = app.path().app_data_dir()?;
    Ok(base.join("workspace"))
}

/// 前端完成落盘后调用，放行关闭。
#[tauri::command]
fn close_window(window: tauri::Window) {
    CLOSE_APPROVED.store(true, Ordering::SeqCst);
    let _ = window.close();
}

/// 当前应用版本。
///
/// 取自 `package_info()`，即 `tauri.conf.json` 的 version —— **与更新检查用的是
/// 同一个值**。不用 `env!("CARGO_PKG_VERSION")`：那读的是 Cargo.toml，
/// 与 tauri.conf.json 是两份可以各自漂移的版本号；一旦不一致，
/// 「关于」页显示的版本就和更新器比较的版本不是一回事。
#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OpenedFiles(Mutex::new(command_line_opened_files())))
        // 单实例模式：当应用已在运行，后续通过文件关联或命令行打开文件时，
        // 将命令行参数转发给已运行的实例，唤醒窗口并在新标签页中打开，不启动重复进程。
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let files = parse_instance_args(&args, &cwd);
            if !files.is_empty() {
                if let Some(opened) = app.try_state::<OpenedFiles>() {
                    if let Ok(mut lock) = opened.0.lock() {
                        for f in &files {
                            if !lock.contains(f) {
                                lock.push(f.clone());
                            }
                        }
                    }
                }
                let _ = app.emit("open-files", &files);
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        // 设置页需要「浏览…」选目录；原生选择器交给官方插件，
        // 不在前端自造路径输入。
        .plugin(tauri_plugin_dialog::init())
        // 内置更新：检查 → 下载 → 校验签名 → 安装。
        // 签名公钥在 tauri.conf.json；校验由插件完成，前端无法跳过，
        // 因此被篡改的安装包会被拒绝而不是静默装上。
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 安装完成后需要重启进程才能生效。
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let root = resolve_workspace_root(app.handle())?;
            let service = DocumentService::new(root)?;
            app.manage(service);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 已经放行过（或前端主动要求关闭）就不再拦。
                if CLOSE_APPROVED.load(Ordering::SeqCst) {
                    return;
                }
                // 拦下本次关闭，请前端先落盘。前端处理完会调用 close_window。
                // 用户若再点一次关闭，第二次会走到上面那条放行分支。
                api.prevent_close();
                let _ = window.emit("flush-before-close", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::attachments::save_attachment,
            commands::attachments::read_attachment,
            commands::documents::list_documents,
            commands::documents::create_document,
            commands::documents::read_document,
            commands::documents::save_document,
            commands::documents::rename_document,
            commands::documents::delete_document,
            commands::documents::duplicate_document,
            commands::documents::search_documents,
            commands::documents::get_settings,
            commands::documents::set_workspace_root,
            commands::documents::reset_workspace_root,
            commands::documents::default_workspace_root,
            commands::documents::export_document,
            commands::documents::import_document,
            commands::documents::read_external_file,
            commands::documents::save_external_file,
            commands::documents::list_external_files,
            commands::documents::forget_external_file,
            // 文档内引用的本地资产（相对路径图片 / 笔记互链）
            commands::documents::read_local_asset,
            commands::documents::resolve_local_link,
            commands::documents::reveal_document,
            commands::documents::reveal_external_file,
            // 统一纯磁盘文件命令
            commands::documents::open_file,
            commands::documents::save_file,
            commands::documents::create_file,
            commands::documents::list_recent_files,
            commands::documents::remove_from_history,
            commands::documents::delete_file_on_disk,
            commands::documents::search_files,
            commands::documents::update_file_session,
            commands::documents::set_file_pinned,
            commands::documents::reveal_file,
            opened_files,
            app_version,
            close_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running crab-md");
}
