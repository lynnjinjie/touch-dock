use crate::input::{DriverStatus, InputDriver, InputError, Key, KeyState, Modifier, MouseButton};

pub struct UnsupportedInputDriver;

impl InputDriver for UnsupportedInputDriver {
    fn status(&self) -> DriverStatus {
        DriverStatus::Unsupported
    }

    fn move_pointer(&self, _dx: f64, _dy: f64) -> Result<(), InputError> {
        Err(InputError::Unsupported("pointer movement"))
    }

    fn click(&self, _button: MouseButton) -> Result<(), InputError> {
        Err(InputError::Unsupported("mouse click"))
    }

    fn mouse_button(&self, _button: MouseButton, _state: KeyState) -> Result<(), InputError> {
        Err(InputError::Unsupported("mouse button state"))
    }

    fn scroll(&self, _dx: f64, _dy: f64) -> Result<(), InputError> {
        Err(InputError::Unsupported("scroll"))
    }

    fn key(&self, _key: Key, _state: KeyState) -> Result<(), InputError> {
        Err(InputError::Unsupported("keyboard input"))
    }

    fn shortcut(&self, _modifiers: &[Modifier], _key: Key) -> Result<(), InputError> {
        Err(InputError::Unsupported("keyboard shortcut"))
    }

    fn text(&self, _text: &str) -> Result<(), InputError> {
        Err(InputError::Unsupported("text input"))
    }
}
