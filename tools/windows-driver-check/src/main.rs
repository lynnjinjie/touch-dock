#![cfg(target_os = "windows")]
#![allow(dead_code)]

#[path = "../../../src-tauri/src/input.rs"]
mod input;
#[path = "../../../src-tauri/src/platform/windows.rs"]
mod windows;

use input::InputDriver;

fn main() {
    let driver = windows::WindowsInputDriver;
    let _ = driver.status();
}
