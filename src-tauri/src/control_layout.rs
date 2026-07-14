use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::PathBuf, sync::RwLock};
use thiserror::Error;

const MAX_ACTIONS: usize = 24;
const MAX_LABEL_CHARS: usize = 32;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlLayout {
    pub language: Language,
    pub trackpad: TrackpadConfig,
    pub keys: Vec<KeyConfig>,
    pub actions: Vec<ActionConfig>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum Language {
    #[serde(rename = "en")]
    English,
    #[serde(rename = "zh-CN")]
    SimplifiedChinese,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrackpadConfig {
    pub pointer_speed: f64,
    pub scroll_speed: f64,
    pub show_left_click: bool,
    pub show_right_click: bool,
    pub show_modifiers: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct KeyConfig {
    pub id: String,
    pub visible: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ActionConfig {
    pub id: String,
    pub label: String,
    pub visible: bool,
    pub command: ActionCommand,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ActionCommand {
    Key {
        key: ActionKey,
    },
    Shortcut {
        modifiers: Vec<ActionModifier>,
        key: ActionKey,
    },
    System {
        action: SystemAction,
    },
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ActionModifier {
    Meta,
    Control,
    Alt,
    Shift,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActionKey {
    A,
    B,
    C,
    D,
    E,
    F,
    G,
    H,
    I,
    J,
    K,
    L,
    M,
    N,
    O,
    P,
    Q,
    R,
    S,
    T,
    U,
    V,
    W,
    X,
    Y,
    Z,
    Tab,
    Space,
    Enter,
    Escape,
    Backspace,
    Delete,
    ArrowUp,
    ArrowDown,
    F11,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SystemAction {
    VolumeUp,
    VolumeDown,
    Mute,
    PlayPause,
    LockScreen,
}

impl Default for ControlLayout {
    fn default() -> Self {
        Self {
            language: Language::English,
            trackpad: TrackpadConfig {
                pointer_speed: 1.3,
                scroll_speed: 1.3,
                show_left_click: true,
                show_right_click: true,
                show_modifiers: true,
            },
            keys: ["escape", "backspace", "tab", "space", "enter"]
                .into_iter()
                .map(|id| KeyConfig {
                    id: id.into(),
                    visible: true,
                })
                .collect(),
            actions: vec![
                action(
                    "switch-apps",
                    "Switch apps",
                    ActionCommand::Shortcut {
                        modifiers: vec![ActionModifier::Meta],
                        key: ActionKey::Tab,
                    },
                ),
                action(
                    "search",
                    "Search",
                    ActionCommand::Shortcut {
                        modifiers: vec![ActionModifier::Meta],
                        key: ActionKey::Space,
                    },
                ),
                action(
                    "overview",
                    "Overview",
                    ActionCommand::Shortcut {
                        modifiers: vec![ActionModifier::Control],
                        key: ActionKey::ArrowUp,
                    },
                ),
                action(
                    "show-desktop",
                    "Show desktop",
                    ActionCommand::Shortcut {
                        modifiers: vec![],
                        key: ActionKey::F11,
                    },
                ),
                action(
                    "mute",
                    "Mute audio",
                    ActionCommand::System {
                        action: SystemAction::Mute,
                    },
                ),
            ],
        }
    }
}

fn action(id: &str, label: &str, command: ActionCommand) -> ActionConfig {
    ActionConfig {
        id: id.into(),
        label: label.into(),
        visible: true,
        command,
    }
}

impl ControlLayout {
    pub fn validate(&self) -> Result<(), LayoutError> {
        if !self.trackpad.pointer_speed.is_finite()
            || !(0.5..=3.0).contains(&self.trackpad.pointer_speed)
            || !self.trackpad.scroll_speed.is_finite()
            || !(0.5..=3.0).contains(&self.trackpad.scroll_speed)
        {
            return Err(LayoutError::Trackpad);
        }
        let allowed_keys: HashSet<&str> = ["escape", "tab", "space", "backspace", "enter"]
            .into_iter()
            .collect();
        let key_ids: HashSet<&str> = self.keys.iter().map(|key| key.id.as_str()).collect();
        if self.keys.len() != allowed_keys.len() || key_ids != allowed_keys {
            return Err(LayoutError::Keys);
        }
        if self.actions.len() > MAX_ACTIONS {
            return Err(LayoutError::Actions);
        }
        let mut ids = HashSet::new();
        for action in &self.actions {
            let label_chars = action.label.chars().count();
            if action.id.is_empty()
                || action.id.len() > 64
                || !ids.insert(action.id.as_str())
                || label_chars == 0
                || label_chars > MAX_LABEL_CHARS
                || action.label.chars().any(char::is_control)
            {
                return Err(LayoutError::Actions);
            }
            if let ActionCommand::Shortcut { modifiers, .. } = &action.command {
                let unique: HashSet<_> = modifiers.iter().copied().collect();
                if modifiers.len() > 4 || unique.len() != modifiers.len() {
                    return Err(LayoutError::Actions);
                }
            }
        }
        Ok(())
    }
}

pub struct ControlLayoutStore {
    path: Option<PathBuf>,
    layout: RwLock<ControlLayout>,
}

impl ControlLayoutStore {
    pub fn load(path: Option<PathBuf>) -> Self {
        let layout = path
            .as_ref()
            .and_then(|path| fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice::<ControlLayout>(&bytes).ok())
            .filter(|layout| layout.validate().is_ok())
            .unwrap_or_default();
        Self {
            path,
            layout: RwLock::new(layout),
        }
    }
    pub fn get(&self) -> ControlLayout {
        self.layout
            .read()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }
    pub fn set(&self, layout: ControlLayout) -> Result<(), LayoutError> {
        layout.validate()?;
        if let Some(path) = &self.path {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            let temporary = path.with_extension("json.tmp");
            fs::write(&temporary, serde_json::to_vec_pretty(&layout)?)?;
            fs::rename(temporary, path)?;
        }
        *self
            .layout
            .write()
            .unwrap_or_else(|error| error.into_inner()) = layout;
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum LayoutError {
    #[error("trackpad configuration is out of bounds")]
    Trackpad,
    #[error("keys must contain each supported key exactly once")]
    Keys,
    #[error("actions contain invalid or duplicate values")]
    Actions,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_layout_is_valid() {
        let layout = ControlLayout::default();
        layout.validate().unwrap();
        assert_eq!(
            layout
                .keys
                .iter()
                .map(|key| key.id.as_str())
                .collect::<Vec<_>>(),
            ["escape", "backspace", "tab", "space", "enter"]
        );
    }
    #[test]
    fn rejects_unknown_or_duplicate_keys() {
        let mut layout = ControlLayout::default();
        layout.keys[0].id = "raw_keycode".into();
        assert!(matches!(layout.validate(), Err(LayoutError::Keys)));
    }
    #[test]
    fn rejects_duplicate_modifiers() {
        let mut layout = ControlLayout::default();
        layout.actions[0].command = ActionCommand::Shortcut {
            modifiers: vec![ActionModifier::Meta, ActionModifier::Meta],
            key: ActionKey::F,
        };
        assert!(matches!(layout.validate(), Err(LayoutError::Actions)));
    }

    #[test]
    fn rejects_scroll_speed_outside_product_bounds() {
        let mut layout = ControlLayout::default();
        layout.trackpad.scroll_speed = 3.1;
        assert!(matches!(layout.validate(), Err(LayoutError::Trackpad)));
    }
}
