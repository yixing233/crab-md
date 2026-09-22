pub mod commands;
pub mod db;
pub mod error;
pub mod model;
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

/// 解析工作区根目录：优先环境变量（便于测试与多工作区），
/// 否则用系统应用数据目录下的 `crab-md/workspace`。
fn resolve_workspace_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    if let Ok(custom) = std::env::var("CRAB_MD_WORKSPACE") {
        if !custom.trim().is_empty() {
            return Ok(std::path::PathBuf::from(custom));
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
            close_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running crab-md");
}
