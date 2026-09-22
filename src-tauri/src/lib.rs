pub mod commands;
pub mod db;
pub mod error;
pub mod model;
pub mod settings;
pub mod workspace;

use commands::documents::DocumentService;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, WindowEvent};

/// 关窗拦截的「已放行」标志。
///
/// 第一次收到关闭请求时拦下，让前端先落盘；前端落盘完毕调用
/// `close_window` 命令再真正关闭。若前端因故没响应，用户再点一次关闭
/// 就会直接放行 —— 绝不把应用变成关不掉的窗口。
static CLOSE_APPROVED: AtomicBool = AtomicBool::new(false);

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // 设置页需要「浏览…」选目录；原生选择器交给官方插件，
        // 不在前端自造路径输入。
        .plugin(tauri_plugin_dialog::init())
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
            close_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running crab-md");
}
