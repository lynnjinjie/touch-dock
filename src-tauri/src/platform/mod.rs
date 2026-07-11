use crate::input::InputDriver;
use std::sync::Arc;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod unsupported;
#[cfg(target_os = "windows")]
mod windows;

pub fn create_input_driver() -> Arc<dyn InputDriver> {
    #[cfg(target_os = "macos")]
    return Arc::new(macos::MacOsInputDriver::default());

    #[cfg(target_os = "windows")]
    return Arc::new(windows::WindowsInputDriver);

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return Arc::new(unsupported::UnsupportedInputDriver);
}
