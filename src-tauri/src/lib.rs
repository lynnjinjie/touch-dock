mod control_layout;
mod crypto;
mod dock_visibility;
mod input;
mod platform;
mod protocol;
mod server;
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod tray;
mod updates;

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
            let app_config_dir = app.path().app_config_dir()?;
            let config_path = app_config_dir.join("control-layout.json");
            let server = tauri::async_runtime::block_on(RemoteServer::start(driver, config_path))?;
            app.manage(server);
            let dock_visibility = dock_visibility::DockVisibilityStore::load(
                app_config_dir.join("dock-visibility.json"),
            );
            dock_visibility::apply_saved_preference(app.handle(), &dock_visibility)?;
            app.manage(dock_visibility);
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
            } else if window.label() == "tray-panel" {
                match event {
                    tauri::WindowEvent::Focused(false) => {
                        let _ = window.hide();
                    }
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            remote_service_info,
            refresh_pairing_code,
            request_input_permission,
            control_layout,
            set_control_layout,
            dock_visibility::dock_visibility,
            dock_visibility::set_dock_visibility,
            latest_release,
            tray::open_main_window,
            tray::open_settings_window,
            tray::close_tray_panel,
            tray::quit_touchdock
        ])
        .run(tauri::generate_context!())
        .expect("failed to run TouchDock");
}
