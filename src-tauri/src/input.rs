use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use thiserror::Error;

const MAX_POINTER_DELTA: f64 = 500.0;
const MAX_SCROLL_DELTA: f64 = 1_000.0;
const MAX_TEXT_CHARS: usize = 128;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum KeyState {
    Down,
    Up,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Modifier {
    Meta,
    Control,
    Alt,
    Shift,
    Function,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Key {
    ArrowUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    Enter,
    Escape,
    Space,
    Tab,
    Backspace,
    Delete,
    Home,
    End,
    PageUp,
    PageDown,
    F11,
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
    Mute,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SystemAction {
    Mute,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum InputCommand {
    Move {
        dx: f64,
        dy: f64,
    },
    Click {
        button: MouseButton,
    },
    ClickState {
        button: MouseButton,
        count: u8,
    },
    MouseButton {
        button: MouseButton,
        state: KeyState,
    },
    Scroll {
        dx: f64,
        dy: f64,
    },
    Key {
        key: Key,
        state: KeyState,
    },
    Modifier {
        modifier: Modifier,
        state: KeyState,
    },
    System {
        action: SystemAction,
    },
    Shortcut {
        modifiers: Vec<Modifier>,
        key: Key,
    },
    Text {
        text: String,
    },
}

impl InputCommand {
    pub fn validate(&self) -> Result<(), CommandValidationError> {
        match self {
            Self::Move { dx, dy } => {
                validate_delta(*dx, MAX_POINTER_DELTA, "pointer dx")?;
                validate_delta(*dy, MAX_POINTER_DELTA, "pointer dy")
            }
            Self::Scroll { dx, dy } => {
                validate_delta(*dx, MAX_SCROLL_DELTA, "scroll dx")?;
                validate_delta(*dy, MAX_SCROLL_DELTA, "scroll dy")
            }
            Self::ClickState { count, .. } => {
                if (1..=3).contains(count) {
                    Ok(())
                } else {
                    Err(CommandValidationError::ClickCount)
                }
            }
            Self::Shortcut { modifiers, key } => {
                if modifiers.is_empty() || modifiers.len() > 4 {
                    return Err(CommandValidationError::Shortcut);
                }
                let unique: HashSet<_> = modifiers.iter().copied().collect();
                if unique.len() != modifiers.len() || !allowed_shortcut(&unique, *key) {
                    return Err(CommandValidationError::Shortcut);
                }
                Ok(())
            }
            Self::Text { text } => {
                let count = text.chars().count();
                if count == 0 || count > MAX_TEXT_CHARS || text.chars().any(char::is_control) {
                    return Err(CommandValidationError::Text);
                }
                Ok(())
            }
            Self::Click { .. }
            | Self::MouseButton { .. }
            | Self::Key { .. }
            | Self::Modifier { .. }
            | Self::System { .. } => Ok(()),
        }
    }

    pub fn rate_cost(&self) -> u32 {
        match self {
            Self::Move { .. } | Self::Scroll { .. } => 1,
            Self::Key { .. } | Self::Modifier { .. } | Self::MouseButton { .. } => 2,
            Self::System { .. } => 4,
            Self::Click { .. } | Self::ClickState { .. } => 4,
            Self::Shortcut { modifiers, .. } => 4 + modifiers.len() as u32 * 2,
            Self::Text { text } => text.chars().count().max(1) as u32,
        }
    }
}

fn allowed_shortcut(modifiers: &HashSet<Modifier>, key: Key) -> bool {
    let supported_key = matches!(
        key,
        Key::A
            | Key::B
            | Key::C
            | Key::D
            | Key::E
            | Key::F
            | Key::G
            | Key::H
            | Key::I
            | Key::J
            | Key::K
            | Key::L
            | Key::M
            | Key::N
            | Key::O
            | Key::P
            | Key::Q
            | Key::R
            | Key::S
            | Key::T
            | Key::U
            | Key::V
            | Key::W
            | Key::X
            | Key::Y
            | Key::Z
            | Key::Tab
            | Key::Space
            | Key::Enter
            | Key::Escape
            | Key::Backspace
            | Key::Delete
            | Key::ArrowUp
            | Key::ArrowDown
            | Key::F11
    );
    let supported_modifiers = modifiers
        .iter()
        .all(|modifier| !matches!(modifier, Modifier::Function));
    supported_key && supported_modifiers
}

fn validate_delta(
    value: f64,
    limit: f64,
    field: &'static str,
) -> Result<(), CommandValidationError> {
    if !value.is_finite() || value.abs() > limit {
        return Err(CommandValidationError::Delta { field, limit });
    }
    Ok(())
}

#[derive(Debug, Error, PartialEq)]
pub enum CommandValidationError {
    #[error("{field} must be finite and within +/-{limit}")]
    Delta { field: &'static str, limit: f64 },
    #[error("shortcut modifiers must be unique and contain between one and four entries")]
    Shortcut,
    #[error("text must contain 1 to {MAX_TEXT_CHARS} printable characters")]
    Text,
    #[error("click count must be between 1 and 3")]
    ClickCount,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum DriverStatus {
    Ready,
    PermissionRequired,
    Unsupported,
}

#[derive(Debug, Error)]
#[allow(dead_code)]
pub enum InputError {
    #[error("input control permission is required")]
    PermissionRequired,
    #[error("input operation is not supported: {0}")]
    Unsupported(&'static str),
    #[error("the operating system rejected the input event")]
    Rejected,
    #[error("failed to create a native input event")]
    EventCreation,
}

pub trait InputDriver: Send + Sync {
    fn status(&self) -> DriverStatus;
    fn request_permission(&self) -> DriverStatus {
        self.status()
    }
    fn move_pointer(&self, dx: f64, dy: f64) -> Result<(), InputError>;
    fn click(&self, button: MouseButton) -> Result<(), InputError>;
    fn click_with_count(&self, button: MouseButton, _count: u8) -> Result<(), InputError> {
        self.click(button)
    }
    fn mouse_button(&self, button: MouseButton, state: KeyState) -> Result<(), InputError>;
    fn scroll(&self, dx: f64, dy: f64) -> Result<(), InputError>;
    fn key(&self, key: Key, state: KeyState) -> Result<(), InputError>;
    fn modifier(&self, modifier: Modifier, state: KeyState) -> Result<(), InputError>;
    fn system_action(&self, action: SystemAction) -> Result<(), InputError>;
    fn shortcut(&self, modifiers: &[Modifier], key: Key) -> Result<(), InputError>;
    fn text(&self, text: &str) -> Result<(), InputError>;

    fn execute(&self, command: &InputCommand) -> Result<(), InputError> {
        match command {
            InputCommand::Move { dx, dy } => self.move_pointer(*dx, *dy),
            InputCommand::Click { button } => self.click(*button),
            InputCommand::ClickState { button, count } => self.click_with_count(*button, *count),
            InputCommand::MouseButton { button, state } => self.mouse_button(*button, *state),
            InputCommand::Scroll { dx, dy } => self.scroll(*dx, *dy),
            InputCommand::Key { key, state } => self.key(*key, *state),
            InputCommand::Modifier { modifier, state } => self.modifier(*modifier, *state),
            InputCommand::System { action } => self.system_action(*action),
            InputCommand::Shortcut { modifiers, key } => self.shortcut(modifiers, *key),
            InputCommand::Text { text } => self.text(text),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_finite_and_oversized_motion() {
        assert!(InputCommand::Move {
            dx: f64::NAN,
            dy: 0.0
        }
        .validate()
        .is_err());
        assert!(InputCommand::Move { dx: 501.0, dy: 0.0 }
            .validate()
            .is_err());
    }

    #[test]
    fn rejects_duplicate_shortcut_modifiers() {
        let command = InputCommand::Shortcut {
            modifiers: vec![Modifier::Meta, Modifier::Meta],
            key: Key::Tab,
        };
        assert_eq!(command.validate(), Err(CommandValidationError::Shortcut));
    }

    #[test]
    fn accepts_only_product_shortcuts() {
        assert!(InputCommand::Shortcut {
            modifiers: vec![Modifier::Meta],
            key: Key::Tab,
        }
        .validate()
        .is_ok());
        assert!(InputCommand::Shortcut {
            modifiers: vec![Modifier::Meta, Modifier::Control],
            key: Key::Q,
        }
        .validate()
        .is_ok());
        assert!(InputCommand::Shortcut {
            modifiers: vec![Modifier::Meta],
            key: Key::Home,
        }
        .validate()
        .is_err());
        assert!(InputCommand::Shortcut {
            modifiers: vec![Modifier::Meta, Modifier::Shift],
            key: Key::Z,
        }
        .validate()
        .is_ok());
    }

    #[test]
    fn rejects_control_characters_in_text() {
        assert_eq!(
            InputCommand::Text {
                text: "hello\n".into()
            }
            .validate(),
            Err(CommandValidationError::Text)
        );
    }

    #[test]
    fn accepts_a_mouse_button_down_without_an_implicit_up() {
        let command = InputCommand::MouseButton {
            button: MouseButton::Left,
            state: KeyState::Down,
        };
        assert!(command.validate().is_ok());
    }

    #[test]
    fn accepts_double_click_state_and_rejects_invalid_counts() {
        assert!(InputCommand::ClickState {
            button: MouseButton::Left,
            count: 2,
        }
        .validate()
        .is_ok());
        assert!(InputCommand::ClickState {
            button: MouseButton::Left,
            count: 0,
        }
        .validate()
        .is_err());
    }
}
