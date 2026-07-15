use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Rect, Size,
};

const OPEN_SETTINGS_EVENT: &str = "open-settings";
const PANEL_LABEL: &str = "tray-panel";

fn show_main_window(app: &AppHandle, open_settings: bool) {
    if let Some(panel) = app.get_webview_window(PANEL_LABEL) {
        let _ = panel.hide();
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    if open_settings {
        let _ = window.emit(OPEN_SETTINGS_EVENT, ());
    }
}

fn panel_position(rect: Rect, panel_size: PhysicalSize<u32>) -> PhysicalPosition<i32> {
    let (rect_x, rect_y) = match rect.position {
        Position::Physical(position) => (f64::from(position.x), f64::from(position.y)),
        Position::Logical(position) => (position.x, position.y),
    };
    let (rect_width, rect_height) = match rect.size {
        Size::Physical(size) => (f64::from(size.width), f64::from(size.height)),
        Size::Logical(size) => (size.width, size.height),
    };
    let x = rect_x + (rect_width - f64::from(panel_size.width)) / 2.0;
    #[cfg(target_os = "windows")]
    let y = rect_y - f64::from(panel_size.height) - 8.0;
    #[cfg(not(target_os = "windows"))]
    let y = rect_y + rect_height + 6.0;
    PhysicalPosition::new(x.round() as i32, y.round() as i32)
}

fn toggle_panel(app: &AppHandle, rect: Rect) {
    let Some(panel) = app.get_webview_window(PANEL_LABEL) else {
        return;
    };
    if panel.is_visible().unwrap_or(false) {
        let _ = panel.hide();
        return;
    }
    let size = panel.outer_size().unwrap_or(PhysicalSize::new(280, 428));
    let _ = panel.set_position(panel_position(rect, size));
    let _ = panel.show();
    let _ = panel.set_focus();
}

#[tauri::command]
pub fn open_main_window(app: AppHandle) {
    show_main_window(&app, false);
}

#[tauri::command]
pub fn open_settings_window(app: AppHandle) {
    show_main_window(&app, true);
}

#[tauri::command]
pub fn close_tray_panel(app: AppHandle) {
    if let Some(panel) = app.get_webview_window(PANEL_LABEL) {
        let _ = panel.hide();
    }
}

#[tauri::command]
pub fn quit_touchdock(app: AppHandle) {
    app.exit(0);
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    TrayIconBuilder::with_id("touchdock-tray")
        .icon(tauri::include_image!("icons/tray-icon.png"))
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("TouchDock")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                rect,
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_panel(tray.app_handle(), rect);
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positions_macos_panel_below_the_menu_bar_icon() {
        let rect = Rect {
            position: Position::Physical(PhysicalPosition::new(100, 0)),
            size: Size::Physical(PhysicalSize::new(24, 24)),
        };
        let position = panel_position(rect, PhysicalSize::new(320, 440));
        assert_eq!(position.x, -48);
        #[cfg(not(target_os = "windows"))]
        assert_eq!(position.y, 30);
    }
}
