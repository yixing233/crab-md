pub mod commands;
pub mod db;
pub mod error;
pub mod model;
pub mod workspace;

use commands::documents::DocumentService;
use tauri::Manager;

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
        .invoke_handler(tauri::generate_handler![
            commands::documents::list_documents,
            commands::documents::create_document,
            commands::documents::read_document,
            commands::documents::save_document,
            commands::documents::rename_document,
            commands::documents::delete_document,
            commands::documents::search_documents,
        ])
        .run(tauri::generate_context!())
        .expect("error while running crab-md");
}
