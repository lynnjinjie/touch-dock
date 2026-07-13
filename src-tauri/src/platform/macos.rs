use crate::input::{
    DriverStatus, InputDriver, InputError, Key, KeyState, Modifier, MouseButton, SystemAction,
};
use core_graphics::{
    display::CGDisplay,
    event::{
        CGEvent, CGEventTapLocation, CGEventType, CGKeyCode, CGMouseButton, EventField, KeyCode,
        ScrollEventUnit,
    },
    event_source::{CGEventSource, CGEventSourceStateID},
    geometry::CGPoint,
};
use std::{
    collections::HashMap,
    ffi::c_void,
    ptr,
    sync::Mutex,
    time::{Duration, Instant},
};

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    static kAXTrustedCheckOptionPrompt: *const c_void;
}

#[repr(C)]
struct AudioObjectPropertyAddress {
    selector: u32,
    scope: u32,
    element: u32,
}

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectGetPropertyData(
        object: u32,
        address: *const AudioObjectPropertyAddress,
        qualifier_size: u32,
        qualifier_data: *const c_void,
        data_size: *mut u32,
        data: *mut c_void,
    ) -> i32;
    fn AudioObjectSetPropertyData(
        object: u32,
        address: *const AudioObjectPropertyAddress,
        qualifier_size: u32,
        qualifier_data: *const c_void,
        data_size: u32,
        data: *const c_void,
    ) -> i32;
}

const fn fourcc(value: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*value)
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFDictionaryCreate(
        allocator: *const c_void,
        keys: *const *const c_void,
        values: *const *const c_void,
        count: isize,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> *const c_void;
    fn CFRelease(value: *const c_void);
    static kCFBooleanTrue: *const c_void;
}

const DOUBLE_CLICK_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Default)]
struct ClickTracker {
    last_down: Option<(MouseButton, Instant)>,
    active_counts: HashMap<MouseButton, u8>,
}

impl ClickTracker {
    fn count(&mut self, button: MouseButton, state: KeyState, now: Instant) -> u8 {
        match state {
            KeyState::Down => {
                let is_double = self.last_down.is_some_and(|(last_button, last_time)| {
                    last_button == button && now.duration_since(last_time) <= DOUBLE_CLICK_INTERVAL
                });
                let count = if is_double { 2 } else { 1 };
                self.last_down = if is_double { None } else { Some((button, now)) };
                self.active_counts.insert(button, count);
                count
            }
            KeyState::Up => self.active_counts.remove(&button).unwrap_or(1),
        }
    }
}

#[derive(Default)]
pub struct MacOsInputDriver {
    click_tracker: Mutex<ClickTracker>,
}

impl MacOsInputDriver {
    fn toggle_mute() -> Result<(), InputError> {
        let default_output = AudioObjectPropertyAddress {
            selector: fourcc(b"dOut"),
            scope: fourcc(b"glob"),
            element: 0,
        };
        let mut device = 0_u32;
        let mut device_size = std::mem::size_of::<u32>() as u32;
        let status = unsafe {
            AudioObjectGetPropertyData(
                1,
                &default_output,
                0,
                ptr::null(),
                &mut device_size,
                (&mut device as *mut u32).cast(),
            )
        };
        if status != 0 || device == 0 {
            return Err(InputError::Rejected);
        }
        let mute_property = AudioObjectPropertyAddress {
            selector: fourcc(b"mute"),
            scope: fourcc(b"outp"),
            element: 0,
        };
        let mut muted = 0_u32;
        let mut muted_size = std::mem::size_of::<u32>() as u32;
        let status = unsafe {
            AudioObjectGetPropertyData(
                device,
                &mute_property,
                0,
                ptr::null(),
                &mut muted_size,
                (&mut muted as *mut u32).cast(),
            )
        };
        if status != 0 {
            return Err(InputError::Rejected);
        }
        let next = u32::from(muted == 0);
        let status = unsafe {
            AudioObjectSetPropertyData(
                device,
                &mute_property,
                0,
                ptr::null(),
                std::mem::size_of::<u32>() as u32,
                (&next as *const u32).cast(),
            )
        };
        if status == 0 {
            Ok(())
        } else {
            Err(InputError::Rejected)
        }
    }
    fn is_trusted() -> bool {
        unsafe { AXIsProcessTrusted() }
    }

    fn ensure_trusted() -> Result<(), InputError> {
        if Self::is_trusted() {
            Ok(())
        } else {
            Err(InputError::PermissionRequired)
        }
    }

    fn request_trust() -> bool {
        unsafe {
            let keys = [kAXTrustedCheckOptionPrompt];
            let values = [kCFBooleanTrue];
            let options = CFDictionaryCreate(
                ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                ptr::null(),
                ptr::null(),
            );
            if options.is_null() {
                return Self::is_trusted();
            }
            let trusted = AXIsProcessTrustedWithOptions(options);
            CFRelease(options);
            trusted
        }
    }

    fn source() -> Result<CGEventSource, InputError> {
        CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|_| InputError::EventCreation)
    }

    fn cursor_location() -> Result<CGPoint, InputError> {
        CGEvent::new(Self::source()?)
            .map(|event| event.location())
            .map_err(|_| InputError::EventCreation)
    }

    fn post_key(key: Key, state: KeyState) -> Result<(), InputError> {
        let event =
            CGEvent::new_keyboard_event(Self::source()?, key_code(key), state == KeyState::Down)
                .map_err(|_| InputError::EventCreation)?;
        event.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn post_modifier(modifier: Modifier, state: KeyState) -> Result<(), InputError> {
        let event = CGEvent::new_keyboard_event(
            Self::source()?,
            modifier_key_code(modifier),
            state == KeyState::Down,
        )
        .map_err(|_| InputError::EventCreation)?;
        event.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn post_mouse_button(
        button: MouseButton,
        state: KeyState,
        click_count: u8,
    ) -> Result<(), InputError> {
        let location = Self::cursor_location()?;
        let (native_button, down, up) = match button {
            MouseButton::Left => (
                CGMouseButton::Left,
                CGEventType::LeftMouseDown,
                CGEventType::LeftMouseUp,
            ),
            MouseButton::Right => (
                CGMouseButton::Right,
                CGEventType::RightMouseDown,
                CGEventType::RightMouseUp,
            ),
            MouseButton::Middle => (
                CGMouseButton::Center,
                CGEventType::OtherMouseDown,
                CGEventType::OtherMouseUp,
            ),
        };
        let event_type = if state == KeyState::Down { down } else { up };
        let event = CGEvent::new_mouse_event(Self::source()?, event_type, location, native_button)
            .map_err(|_| InputError::EventCreation)?;
        event.set_integer_value_field(EventField::MOUSE_EVENT_CLICK_STATE, i64::from(click_count));
        event.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn movement_target(current: CGPoint, dx: f64, dy: f64) -> CGPoint {
        let mut target = CGPoint::new(current.x + dx, current.y + dy);
        if CGDisplay::display_count_with_point(target).unwrap_or(0) > 0 {
            return target;
        }
        let Ok((displays, count)) = CGDisplay::displays_with_point(current, 1) else {
            return target;
        };
        if count == 0 {
            return target;
        }
        let bounds = CGDisplay::new(displays[0]).bounds();
        target.x = target.x.clamp(
            bounds.origin.x,
            bounds.origin.x + (bounds.size.width - 1.0).max(0.0),
        );
        target.y = target.y.clamp(
            bounds.origin.y,
            bounds.origin.y + (bounds.size.height - 1.0).max(0.0),
        );
        target
    }

    fn event_delta(value: f64) -> i64 {
        let rounded = value.round() as i64;
        if rounded == 0 && value != 0.0 {
            value.signum() as i64
        } else {
            rounded
        }
    }
}

impl InputDriver for MacOsInputDriver {
    fn status(&self) -> DriverStatus {
        if Self::is_trusted() {
            DriverStatus::Ready
        } else {
            DriverStatus::PermissionRequired
        }
    }

    fn request_permission(&self) -> DriverStatus {
        if Self::request_trust() {
            DriverStatus::Ready
        } else {
            DriverStatus::PermissionRequired
        }
    }

    fn move_pointer(&self, dx: f64, dy: f64) -> Result<(), InputError> {
        Self::ensure_trusted()?;
        let current = Self::cursor_location()?;
        let target = Self::movement_target(current, dx, dy);
        let event = CGEvent::new_mouse_event(
            Self::source()?,
            CGEventType::MouseMoved,
            target,
            CGMouseButton::Left,
        )
        .map_err(|_| InputError::EventCreation)?;
        event.set_integer_value_field(EventField::MOUSE_EVENT_DELTA_X, Self::event_delta(dx));
        event.set_integer_value_field(EventField::MOUSE_EVENT_DELTA_Y, Self::event_delta(dy));
        event.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn click(&self, button: MouseButton) -> Result<(), InputError> {
        self.click_with_count(button, 1)
    }

    fn click_with_count(&self, button: MouseButton, count: u8) -> Result<(), InputError> {
        Self::ensure_trusted()?;
        Self::post_mouse_button(button, KeyState::Down, count)?;
        Self::post_mouse_button(button, KeyState::Up, count)
    }

    fn mouse_button(&self, button: MouseButton, state: KeyState) -> Result<(), InputError> {
        Self::ensure_trusted()?;
        let count = self
            .click_tracker
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .count(button, state, Instant::now());
        Self::post_mouse_button(button, state, count)
    }

    fn scroll(&self, dx: f64, dy: f64) -> Result<(), InputError> {
        Self::ensure_trusted()?;
        let event = CGEvent::new_scroll_event(
            Self::source()?,
            ScrollEventUnit::PIXEL,
            2,
            (-dy).round() as i32,
            (-dx).round() as i32,
            0,
        )
        .map_err(|_| InputError::EventCreation)?;
        event.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn key(&self, key: Key, state: KeyState) -> Result<(), InputError> {
        Self::ensure_trusted()?;
        Self::post_key(key, state)
    }

    fn modifier(&self, modifier: Modifier, state: KeyState) -> Result<(), InputError> {
        Self::ensure_trusted()?;
        Self::post_modifier(modifier, state)
    }

    fn system_action(&self, action: SystemAction) -> Result<(), InputError> {
        match action {
            SystemAction::Mute => Self::toggle_mute(),
        }
    }

    fn shortcut(&self, modifiers: &[Modifier], key: Key) -> Result<(), InputError> {
        Self::ensure_trusted()?;
        for modifier in modifiers {
            Self::post_modifier(*modifier, KeyState::Down)?;
        }
        Self::post_key(key, KeyState::Down)?;
        Self::post_key(key, KeyState::Up)?;
        for modifier in modifiers.iter().rev() {
            Self::post_modifier(*modifier, KeyState::Up)?;
        }
        Ok(())
    }

    fn text(&self, text: &str) -> Result<(), InputError> {
        Self::ensure_trusted()?;
        for key_down in [true, false] {
            let event = CGEvent::new_keyboard_event(Self::source()?, 0, key_down)
                .map_err(|_| InputError::EventCreation)?;
            event.set_string(text);
            event.post(CGEventTapLocation::HID);
        }
        Ok(())
    }
}

fn key_code(key: Key) -> CGKeyCode {
    match key {
        Key::ArrowUp => KeyCode::UP_ARROW,
        Key::ArrowDown => KeyCode::DOWN_ARROW,
        Key::ArrowLeft => KeyCode::LEFT_ARROW,
        Key::ArrowRight => KeyCode::RIGHT_ARROW,
        Key::Enter => KeyCode::RETURN,
        Key::Escape => KeyCode::ESCAPE,
        Key::Space => KeyCode::SPACE,
        Key::Tab => KeyCode::TAB,
        Key::Backspace => KeyCode::DELETE,
        Key::Delete => KeyCode::FORWARD_DELETE,
        Key::Home => KeyCode::HOME,
        Key::End => KeyCode::END,
        Key::PageUp => KeyCode::PAGE_UP,
        Key::PageDown => KeyCode::PAGE_DOWN,
        Key::F11 => KeyCode::F11,
        Key::A => KeyCode::ANSI_A,
        Key::B => KeyCode::ANSI_B,
        Key::C => KeyCode::ANSI_C,
        Key::D => KeyCode::ANSI_D,
        Key::E => KeyCode::ANSI_E,
        Key::F => KeyCode::ANSI_F,
        Key::G => KeyCode::ANSI_G,
        Key::H => KeyCode::ANSI_H,
        Key::I => KeyCode::ANSI_I,
        Key::J => KeyCode::ANSI_J,
        Key::K => KeyCode::ANSI_K,
        Key::L => KeyCode::ANSI_L,
        Key::M => KeyCode::ANSI_M,
        Key::N => KeyCode::ANSI_N,
        Key::O => KeyCode::ANSI_O,
        Key::P => KeyCode::ANSI_P,
        Key::Q => KeyCode::ANSI_Q,
        Key::R => KeyCode::ANSI_R,
        Key::S => KeyCode::ANSI_S,
        Key::T => KeyCode::ANSI_T,
        Key::U => KeyCode::ANSI_U,
        Key::V => KeyCode::ANSI_V,
        Key::W => KeyCode::ANSI_W,
        Key::X => KeyCode::ANSI_X,
        Key::Y => KeyCode::ANSI_Y,
        Key::Z => KeyCode::ANSI_Z,
        Key::Mute => KeyCode::MUTE,
    }
}

fn modifier_key_code(modifier: Modifier) -> CGKeyCode {
    match modifier {
        Modifier::Meta => KeyCode::COMMAND,
        Modifier::Control => KeyCode::CONTROL,
        Modifier::Alt => KeyCode::OPTION,
        Modifier::Shift => KeyCode::SHIFT,
        Modifier::Function => KeyCode::FUNCTION,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_the_second_short_click_as_a_double_click() {
        let mut tracker = ClickTracker::default();
        let start = Instant::now();
        assert_eq!(tracker.count(MouseButton::Left, KeyState::Down, start), 1);
        assert_eq!(tracker.count(MouseButton::Left, KeyState::Up, start), 1);
        let second = start + Duration::from_millis(250);
        assert_eq!(tracker.count(MouseButton::Left, KeyState::Down, second), 2);
        assert_eq!(tracker.count(MouseButton::Left, KeyState::Up, second), 2);
    }

    #[test]
    fn long_or_different_button_clicks_start_a_new_sequence() {
        let mut tracker = ClickTracker::default();
        let start = Instant::now();
        assert_eq!(tracker.count(MouseButton::Left, KeyState::Down, start), 1);
        assert_eq!(tracker.count(MouseButton::Left, KeyState::Up, start), 1);
        assert_eq!(
            tracker.count(
                MouseButton::Left,
                KeyState::Down,
                start + DOUBLE_CLICK_INTERVAL + Duration::from_millis(1),
            ),
            1
        );
        assert_eq!(
            tracker.count(
                MouseButton::Right,
                KeyState::Down,
                start + DOUBLE_CLICK_INTERVAL + Duration::from_millis(100),
            ),
            1
        );
    }
}
