use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager,
};

const OPEN_ID: &str = "open";
const SETTINGS_ID: &str = "settings";
const QUIT_ID: &str = "quit";
const OPEN_SETTINGS_EVENT: &str = "open-settings";

#[derive(Debug, PartialEq, Eq)]
enum TrayAction {
    Open,
    Settings,
    Quit,
}

fn action_for_menu_id(id: &str) -> Option<TrayAction> {
    match id {
        OPEN_ID => Some(TrayAction::Open),
        SETTINGS_ID => Some(TrayAction::Settings),
        QUIT_ID => Some(TrayAction::Quit),
        _ => None,
    }
}

fn show_main_window(app: &AppHandle, open_settings: bool) {
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

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, OPEN_ID, "Open TouchDock", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, SETTINGS_ID, "Settings…", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit TouchDock", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &settings, &separator, &quit])?;

    TrayIconBuilder::with_id("touchdock-tray")
        .icon(tauri::include_image!("icons/tray-icon.png"))
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("TouchDock")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match action_for_menu_id(event.id().as_ref()) {
            Some(TrayAction::Open) => show_main_window(app, false),
            Some(TrayAction::Settings) => show_main_window(app, true),
            Some(TrayAction::Quit) => app.exit(0),
            None => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                show_main_window(tray.app_handle(), false);
            }
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                #[cfg(target_os = "windows")]
                show_main_window(tray.app_handle(), false);
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_only_known_tray_menu_ids() {
        assert_eq!(action_for_menu_id(OPEN_ID), Some(TrayAction::Open));
        assert_eq!(action_for_menu_id(SETTINGS_ID), Some(TrayAction::Settings));
        assert_eq!(action_for_menu_id(QUIT_ID), Some(TrayAction::Quit));
        assert_eq!(action_for_menu_id("unexpected"), None);
    }
}
