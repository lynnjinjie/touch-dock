use crate::input::{
    DriverStatus, InputDriver, InputError, Key, KeyState, Modifier, MouseButton, SystemAction,
};
use std::mem::size_of;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MOUSEEVENTF_HWHEEL,
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
    MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEINPUT,
    MOUSE_EVENT_FLAGS, VIRTUAL_KEY, VK_BACK, VK_CONTROL, VK_DELETE, VK_DOWN, VK_END, VK_ESCAPE,
    VK_HOME, VK_LEFT, VK_LWIN, VK_MEDIA_PLAY_PAUSE, VK_MENU, VK_NEXT, VK_PRIOR, VK_RETURN,
    VK_RIGHT, VK_SHIFT, VK_SPACE, VK_TAB, VK_UP, VK_VOLUME_DOWN, VK_VOLUME_MUTE, VK_VOLUME_UP,
};

pub struct WindowsInputDriver;

impl WindowsInputDriver {
    fn send(inputs: &[INPUT]) -> Result<(), InputError> {
        let sent = unsafe { SendInput(inputs, size_of::<INPUT>() as i32) };
        if sent == inputs.len() as u32 {
            Ok(())
        } else {
            // SendInput can return zero without a useful error when UIPI blocks injection.
            Err(InputError::Rejected)
        }
    }

    fn mouse(flags: MOUSE_EVENT_FLAGS, dx: i32, dy: i32, data: u32) -> INPUT {
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx,
                    dy,
                    mouseData: data,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn keyboard(key: Key, state: KeyState) -> INPUT {
        let (virtual_key, extended) = virtual_key(key);
        let mut flags = if extended {
            KEYEVENTF_EXTENDEDKEY
        } else {
            KEYBD_EVENT_FLAGS::default()
        };
        if state == KeyState::Up {
            flags |= KEYEVENTF_KEYUP;
        }
        Self::virtual_keyboard(virtual_key, flags)
    }

    fn modifier(modifier: Modifier, state: KeyState) -> Result<INPUT, InputError> {
        let key = match modifier {
            Modifier::Meta => VK_LWIN,
            Modifier::Control => VK_CONTROL,
            Modifier::Alt => VK_MENU,
            Modifier::Shift => VK_SHIFT,
            Modifier::Function => return Err(InputError::Unsupported("Windows Fn modifier")),
        };
        let flags = if state == KeyState::Up {
            KEYEVENTF_KEYUP
        } else {
            KEYBD_EVENT_FLAGS::default()
        };
        Ok(Self::virtual_keyboard(key, flags))
    }

    fn virtual_keyboard(key: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }
}

impl InputDriver for WindowsInputDriver {
    fn status(&self) -> DriverStatus {
        DriverStatus::Ready
    }

    fn move_pointer(&self, dx: f64, dy: f64) -> Result<(), InputError> {
        Self::send(&[Self::mouse(
            MOUSEEVENTF_MOVE,
            dx.round() as i32,
            dy.round() as i32,
            0,
        )])
    }

    fn click(&self, button: MouseButton) -> Result<(), InputError> {
        self.mouse_button(button, KeyState::Down)?;
        self.mouse_button(button, KeyState::Up)
    }

    fn mouse_button(&self, button: MouseButton, state: KeyState) -> Result<(), InputError> {
        let flags = match (button, state) {
            (MouseButton::Left, KeyState::Down) => MOUSEEVENTF_LEFTDOWN,
            (MouseButton::Left, KeyState::Up) => MOUSEEVENTF_LEFTUP,
            (MouseButton::Right, KeyState::Down) => MOUSEEVENTF_RIGHTDOWN,
            (MouseButton::Right, KeyState::Up) => MOUSEEVENTF_RIGHTUP,
            (MouseButton::Middle, KeyState::Down) => MOUSEEVENTF_MIDDLEDOWN,
            (MouseButton::Middle, KeyState::Up) => MOUSEEVENTF_MIDDLEUP,
        };
        Self::send(&[Self::mouse(flags, 0, 0, 0)])
    }

    fn scroll(&self, dx: f64, dy: f64) -> Result<(), InputError> {
        let mut inputs = Vec::with_capacity(2);
        if dy != 0.0 {
            inputs.push(Self::mouse(
                MOUSEEVENTF_WHEEL,
                0,
                0,
                ((-dy.round() as i32) * 120) as u32,
            ));
        }
        if dx != 0.0 {
            inputs.push(Self::mouse(
                MOUSEEVENTF_HWHEEL,
                0,
                0,
                (dx.round() as i32 * 120) as u32,
            ));
        }
        if inputs.is_empty() {
            Ok(())
        } else {
            Self::send(&inputs)
        }
    }

    fn key(&self, key: Key, state: KeyState) -> Result<(), InputError> {
        Self::send(&[Self::keyboard(key, state)])
    }

    fn modifier(&self, modifier: Modifier, state: KeyState) -> Result<(), InputError> {
        Self::send(&[Self::modifier(modifier, state)?])
    }

    fn system_action(&self, action: SystemAction) -> Result<(), InputError> {
        let key = match action {
            SystemAction::VolumeUp => VK_VOLUME_UP,
            SystemAction::VolumeDown => VK_VOLUME_DOWN,
            SystemAction::Mute => VK_VOLUME_MUTE,
            SystemAction::PlayPause => VK_MEDIA_PLAY_PAUSE,
        };
        Self::send(&[
            Self::virtual_keyboard(key, KEYBD_EVENT_FLAGS::default()),
            Self::virtual_keyboard(key, KEYEVENTF_KEYUP),
        ])
    }

    fn shortcut(&self, modifiers: &[Modifier], key: Key) -> Result<(), InputError> {
        let mut inputs = Vec::with_capacity(modifiers.len() * 2 + 2);
        for modifier in modifiers {
            inputs.push(Self::modifier(*modifier, KeyState::Down)?);
        }
        inputs.push(Self::keyboard(key, KeyState::Down));
        inputs.push(Self::keyboard(key, KeyState::Up));
        for modifier in modifiers.iter().rev() {
            inputs.push(Self::modifier(*modifier, KeyState::Up)?);
        }
        Self::send(&inputs)
    }

    fn text(&self, text: &str) -> Result<(), InputError> {
        let mut inputs = Vec::with_capacity(text.encode_utf16().count() * 2);
        for unit in text.encode_utf16() {
            for flags in [KEYEVENTF_UNICODE, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP] {
                inputs.push(INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: VIRTUAL_KEY(0),
                            wScan: unit,
                            dwFlags: flags,
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                });
            }
        }
        Self::send(&inputs)
    }
}

fn virtual_key(key: Key) -> (VIRTUAL_KEY, bool) {
    match key {
        Key::ArrowUp => (VK_UP, true),
        Key::ArrowDown => (VK_DOWN, true),
        Key::ArrowLeft => (VK_LEFT, true),
        Key::ArrowRight => (VK_RIGHT, true),
        Key::Enter => (VK_RETURN, false),
        Key::Escape => (VK_ESCAPE, false),
        Key::Space => (VK_SPACE, false),
        Key::Tab => (VK_TAB, false),
        Key::Backspace => (VK_BACK, false),
        Key::Delete => (VK_DELETE, true),
        Key::Home => (VK_HOME, true),
        Key::End => (VK_END, true),
        Key::PageUp => (VK_PRIOR, true),
        Key::PageDown => (VK_NEXT, true),
        Key::F11 => (VIRTUAL_KEY(0x7A), false),
        Key::A => (VIRTUAL_KEY(b'A' as u16), false),
        Key::B => (VIRTUAL_KEY(b'B' as u16), false),
        Key::C => (VIRTUAL_KEY(b'C' as u16), false),
        Key::D => (VIRTUAL_KEY(b'D' as u16), false),
        Key::E => (VIRTUAL_KEY(b'E' as u16), false),
        Key::F => (VIRTUAL_KEY(b'F' as u16), false),
        Key::G => (VIRTUAL_KEY(b'G' as u16), false),
        Key::H => (VIRTUAL_KEY(b'H' as u16), false),
        Key::I => (VIRTUAL_KEY(b'I' as u16), false),
        Key::J => (VIRTUAL_KEY(b'J' as u16), false),
        Key::K => (VIRTUAL_KEY(b'K' as u16), false),
        Key::L => (VIRTUAL_KEY(b'L' as u16), false),
        Key::M => (VIRTUAL_KEY(b'M' as u16), false),
        Key::N => (VIRTUAL_KEY(b'N' as u16), false),
        Key::O => (VIRTUAL_KEY(b'O' as u16), false),
        Key::P => (VIRTUAL_KEY(b'P' as u16), false),
        Key::Q => (VIRTUAL_KEY(b'Q' as u16), false),
        Key::R => (VIRTUAL_KEY(b'R' as u16), false),
        Key::S => (VIRTUAL_KEY(b'S' as u16), false),
        Key::T => (VIRTUAL_KEY(b'T' as u16), false),
        Key::U => (VIRTUAL_KEY(b'U' as u16), false),
        Key::V => (VIRTUAL_KEY(b'V' as u16), false),
        Key::W => (VIRTUAL_KEY(b'W' as u16), false),
        Key::X => (VIRTUAL_KEY(b'X' as u16), false),
        Key::Y => (VIRTUAL_KEY(b'Y' as u16), false),
        Key::Z => (VIRTUAL_KEY(b'Z' as u16), false),
        Key::LeftBracket => (VIRTUAL_KEY(0xDB), false),
        Key::RightBracket => (VIRTUAL_KEY(0xDD), false),
        Key::Mute => (VIRTUAL_KEY(0xAD), true),
    }
}
