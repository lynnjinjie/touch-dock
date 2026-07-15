use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DockPreference {
    visible: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockVisibility {
    supported: bool,
    visible: bool,
}

pub struct DockVisibilityStore {
    path: PathBuf,
    visible: Mutex<bool>,
}

impl DockVisibilityStore {
    pub fn load(path: PathBuf) -> Self {
        let visible = fs::read_to_string(&path)
            .ok()
            .and_then(|contents| serde_json::from_str::<DockPreference>(&contents).ok())
            .map(|preference| preference.visible)
            .unwrap_or(true);
        Self {
            path,
            visible: Mutex::new(visible),
        }
    }

    pub fn visible(&self) -> bool {
        self.visible.lock().map(|value| *value).unwrap_or(true)
    }

    fn save(&self, visible: bool) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let contents = serde_json::to_vec_pretty(&DockPreference { visible })
            .map_err(|error| error.to_string())?;
        fs::write(&self.path, contents).map_err(|error| error.to_string())?;
        *self.visible.lock().map_err(|error| error.to_string())? = visible;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn apply(app: &AppHandle, visible: bool) -> Result<(), String> {
    let main_window = app.get_webview_window("main");
    let restore_main_window = main_window
        .as_ref()
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);
    let policy = if visible {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    };
    app.set_activation_policy(policy)
        .map_err(|error| error.to_string())?;

    // Changing the activation policy can cause macOS to order the current
    // window out. Preserve the user's visible window while removing or adding
    // the Dock icon; startup preferences still leave hidden windows hidden.
    if restore_main_window {
        if let Some(window) = main_window {
            window.unminimize().map_err(|error| error.to_string())?;
            window.show().map_err(|error| error.to_string())?;
            window.set_focus().map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn apply(_app: &AppHandle, _visible: bool) -> Result<(), String> {
    Err("Dock visibility is only supported on macOS".into())
}

pub fn apply_saved_preference(app: &AppHandle, store: &DockVisibilityStore) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return apply(app, store.visible());

    #[cfg(not(target_os = "macos"))]
    Ok(())
}

#[tauri::command]
pub fn dock_visibility(store: State<'_, DockVisibilityStore>) -> DockVisibility {
    DockVisibility {
        supported: cfg!(target_os = "macos"),
        visible: store.visible(),
    }
}

#[tauri::command]
pub fn set_dock_visibility(
    visible: bool,
    app: AppHandle,
    store: State<'_, DockVisibilityStore>,
) -> Result<DockVisibility, String> {
    apply(&app, visible)?;
    store.save(visible)?;
    Ok(DockVisibility {
        supported: true,
        visible,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_or_invalid_preferences_default_to_visible() {
        let missing = std::env::temp_dir().join("touchdock-missing-dock-preference.json");
        let _ = fs::remove_file(&missing);
        assert!(DockVisibilityStore::load(missing).visible());

        let invalid = std::env::temp_dir().join("touchdock-invalid-dock-preference.json");
        fs::write(&invalid, "not-json").unwrap();
        assert!(DockVisibilityStore::load(invalid.clone()).visible());
        let _ = fs::remove_file(invalid);
    }

    #[test]
    fn reads_saved_visibility_preference() {
        let path = std::env::temp_dir().join(format!(
            "touchdock-dock-preference-{}.json",
            std::process::id()
        ));
        fs::write(&path, r#"{"visible":false}"#).unwrap();
        assert!(!DockVisibilityStore::load(path.clone()).visible());
        let _ = fs::remove_file(path);
    }
}
