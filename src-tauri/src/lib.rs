mod control_layout;
mod crypto;
mod input;
mod platform;
mod protocol;
mod server;
mod updates;
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod tray;

use server::{RemoteServer, RemoteServiceInfo};
use tauri::{Manager, State};

#[tauri::command]
fn remote_service_info(service: State<'_, RemoteServer>) -> Result<RemoteServiceInfo, String> {
    service.info().map_err(|error| error.to_string())
}

#[tauri::command]
fn refresh_pairing_code(service: State<'_, RemoteServer>) -> Result<RemoteServiceInfo, String> {
    service.refresh_pairing().map_err(|error| error.to_string())
}

#[tauri::command]
fn request_input_permission(service: State<'_, RemoteServer>) -> input::DriverStatus {
    service.request_input_permission()
}

#[tauri::command]
fn control_layout(service: State<'_, RemoteServer>) -> control_layout::ControlLayout {
    service.control_layout()
}

#[tauri::command]
fn set_control_layout(
    layout: control_layout::ControlLayout,
    service: State<'_, RemoteServer>,
) -> Result<control_layout::ControlLayout, String> {
    service
        .set_control_layout(layout)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn latest_release() -> Result<Option<updates::LatestRelease>, String> {
    updates::latest_release().await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let driver = platform::create_input_driver();
            let config_path = app.path().app_config_dir()?.join("control-layout.json");
            let server = tauri::async_runtime::block_on(RemoteServer::start(driver, config_path))?;
            app.manage(server);
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            tray::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            remote_service_info,
            refresh_pairing_code,
            request_input_permission,
            control_layout,
            set_control_layout,
            latest_release
        ])
        .run(tauri::generate_context!())
        .expect("failed to run TouchDock");
}
