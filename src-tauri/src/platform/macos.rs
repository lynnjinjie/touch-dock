use crate::input::{
    DriverStatus, InputDriver, InputError, Key, KeyState, Modifier, MouseButton, SystemAction,
};
use core_graphics::{
    display::CGDisplay,
    event::{
        CGEvent, CGEventFlags, CGEventTapLocation, CGEventType, CGKeyCode, CGMouseButton,
        EventField, KeyCode, ScrollEventUnit,
    },
    event_source::{CGEventSource, CGEventSourceStateID},
    geometry::CGPoint,
};
use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSEventType};
use objc2_core_graphics::{CGEvent as ObjcCGEvent, CGEventTapLocation as ObjcCGEventTapLocation};
use objc2_foundation::NSPoint;
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
    fn AudioObjectHasProperty(object: u32, address: *const AudioObjectPropertyAddress) -> bool;
    fn AudioObjectIsPropertySettable(
        object: u32,
        address: *const AudioObjectPropertyAddress,
        settable: *mut bool,
    ) -> i32;
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
const VOLUME_STEP: f32 = 1.0 / 16.0;
const NX_SUBTYPE_AUX_CONTROL_BUTTONS: i16 = 8;
const NX_KEYTYPE_PLAY: isize = 16;
const NX_KEY_DOWN: isize = 0x0a;
const NX_KEY_UP: isize = 0x0b;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShortcutEvent {
    Modifier(Modifier, KeyState, CGEventFlags),
    Key(Key, KeyState, CGEventFlags),
}

fn shortcut_event_plan(modifiers: &[Modifier], key: Key) -> Vec<ShortcutEvent> {
    let mut flags = CGEventFlags::empty();
    let mut events = Vec::with_capacity(modifiers.len() * 2 + 2);
    for modifier in modifiers {
        flags.insert(modifier_flag(*modifier));
        events.push(ShortcutEvent::Modifier(*modifier, KeyState::Down, flags));
    }
    events.push(ShortcutEvent::Key(key, KeyState::Down, flags));
    events.push(ShortcutEvent::Key(key, KeyState::Up, flags));
    for modifier in modifiers.iter().rev() {
        flags.remove(modifier_flag(*modifier));
        events.push(ShortcutEvent::Modifier(*modifier, KeyState::Up, flags));
    }
    events
}

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
    fn default_output_device() -> Result<u32, InputError> {
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
        Ok(device)
    }

    fn mute_property() -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress {
            selector: fourcc(b"mute"),
            scope: fourcc(b"outp"),
            element: 0,
        }
    }

    fn set_mute(device: u32, muted: bool) -> Result<(), InputError> {
        let mute_property = Self::mute_property();
        if !unsafe { AudioObjectHasProperty(device, &mute_property) } {
            return Err(InputError::Unsupported("output device mute control"));
        }
        let next = u32::from(muted);
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

    fn toggle_mute() -> Result<(), InputError> {
        let device = Self::default_output_device()?;
        let mute_property = Self::mute_property();
        if !unsafe { AudioObjectHasProperty(device, &mute_property) } {
            return Err(InputError::Unsupported("output device mute control"));
        }
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
        Self::set_mute(device, muted == 0)
    }

    fn adjust_volume(delta: f32) -> Result<(), InputError> {
        let device = Self::default_output_device()?;
        let mut channels = Vec::new();
        for element in [0, 1, 2] {
            let address = AudioObjectPropertyAddress {
                selector: fourcc(b"volm"),
                scope: fourcc(b"outp"),
                element,
            };
            let mut settable = false;
            if unsafe { AudioObjectHasProperty(device, &address) }
                && unsafe { AudioObjectIsPropertySettable(device, &address, &mut settable) } == 0
                && settable
            {
                channels.push(address);
                if element == 0 {
                    break;
                }
            }
        }
        if channels.is_empty() {
            return Err(InputError::Unsupported("output device volume control"));
        }

        let mut current = 0_f32;
        let mut size = std::mem::size_of::<f32>() as u32;
        let status = unsafe {
            AudioObjectGetPropertyData(
                device,
                &channels[0],
                0,
                ptr::null(),
                &mut size,
                (&mut current as *mut f32).cast(),
            )
        };
        if status != 0 {
            return Err(InputError::Rejected);
        }
        let next = next_volume(current, delta);
        for address in channels {
            let status = unsafe {
                AudioObjectSetPropertyData(
                    device,
                    &address,
                    0,
                    ptr::null(),
                    std::mem::size_of::<f32>() as u32,
                    (&next as *const f32).cast(),
                )
            };
            if status != 0 {
                return Err(InputError::Rejected);
            }
        }
        let _ = Self::set_mute(device, false);
        Ok(())
    }

    fn post_media_key(key: isize) -> Result<(), InputError> {
        for state in [NX_KEY_DOWN, NX_KEY_UP] {
            let data = (key << 16) | (state << 8);
            let event = NSEvent::otherEventWithType_location_modifierFlags_timestamp_windowNumber_context_subtype_data1_data2(
                NSEventType::SystemDefined,
                NSPoint::new(0.0, 0.0),
                NSEventModifierFlags::empty(),
                0.0,
                0,
                None,
                NX_SUBTYPE_AUX_CONTROL_BUTTONS,
                data,
                -1,
            )
            .ok_or(InputError::EventCreation)?;
            let cg_event = event.CGEvent().ok_or(InputError::EventCreation)?;
            ObjcCGEvent::post(ObjcCGEventTapLocation::HIDEventTap, Some(&cg_event));
        }
        Ok(())
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
        Self::post_key_with_flags(key, state, CGEventFlags::empty())
    }

    fn post_key_with_flags(
        key: Key,
        state: KeyState,
        flags: CGEventFlags,
    ) -> Result<(), InputError> {
        let event =
            CGEvent::new_keyboard_event(Self::source()?, key_code(key), state == KeyState::Down)
                .map_err(|_| InputError::EventCreation)?;
        event.set_flags(flags);
        event.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn post_modifier(modifier: Modifier, state: KeyState) -> Result<(), InputError> {
        let flags = if state == KeyState::Down {
            modifier_flag(modifier)
        } else {
            CGEventFlags::empty()
        };
        Self::post_modifier_with_flags(modifier, state, flags)
    }

    fn post_modifier_with_flags(
        modifier: Modifier,
        state: KeyState,
        flags: CGEventFlags,
    ) -> Result<(), InputError> {
        let event = CGEvent::new_keyboard_event(
            Self::source()?,
            modifier_key_code(modifier),
            state == KeyState::Down,
        )
        .map_err(|_| InputError::EventCreation)?;
        event.set_flags(flags);
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
            SystemAction::VolumeUp => Self::adjust_volume(VOLUME_STEP),
            SystemAction::VolumeDown => Self::adjust_volume(-VOLUME_STEP),
            SystemAction::Mute => Self::toggle_mute(),
            SystemAction::PlayPause => Self::post_media_key(NX_KEYTYPE_PLAY),
        }
    }

    fn shortcut(&self, modifiers: &[Modifier], key: Key) -> Result<(), InputError> {
        Self::ensure_trusted()?;
        for event in shortcut_event_plan(modifiers, key) {
            match event {
                ShortcutEvent::Modifier(modifier, state, flags) => {
                    Self::post_modifier_with_flags(modifier, state, flags)?;
                }
                ShortcutEvent::Key(key, state, flags) => {
                    Self::post_key_with_flags(key, state, flags)?;
                }
            }
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

fn modifier_flag(modifier: Modifier) -> CGEventFlags {
    match modifier {
        Modifier::Meta => CGEventFlags::CGEventFlagCommand,
        Modifier::Control => CGEventFlags::CGEventFlagControl,
        Modifier::Alt => CGEventFlags::CGEventFlagAlternate,
        Modifier::Shift => CGEventFlags::CGEventFlagShift,
        Modifier::Function => CGEventFlags::CGEventFlagSecondaryFn,
    }
}

fn next_volume(current: f32, delta: f32) -> f32 {
    (current + delta).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn volume_adjustment_stays_in_the_supported_range() {
        assert_eq!(next_volume(0.98, VOLUME_STEP), 1.0);
        assert_eq!(next_volume(0.02, -VOLUME_STEP), 0.0);
        assert!((next_volume(0.5, VOLUME_STEP) - 0.5625).abs() < f32::EPSILON);
    }

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

    #[test]
    fn command_c_keeps_command_flag_on_both_main_key_events() {
        let command = CGEventFlags::CGEventFlagCommand;
        assert_eq!(
            shortcut_event_plan(&[Modifier::Meta], Key::C),
            vec![
                ShortcutEvent::Modifier(Modifier::Meta, KeyState::Down, command),
                ShortcutEvent::Key(Key::C, KeyState::Down, command),
                ShortcutEvent::Key(Key::C, KeyState::Up, command),
                ShortcutEvent::Modifier(Modifier::Meta, KeyState::Up, CGEventFlags::empty(),),
            ]
        );
    }

    #[test]
    fn multi_modifier_shortcuts_accumulate_and_release_flags_in_order() {
        let command = CGEventFlags::CGEventFlagCommand;
        let combined = command | CGEventFlags::CGEventFlagShift;
        assert_eq!(
            shortcut_event_plan(&[Modifier::Meta, Modifier::Shift], Key::Z),
            vec![
                ShortcutEvent::Modifier(Modifier::Meta, KeyState::Down, command),
                ShortcutEvent::Modifier(Modifier::Shift, KeyState::Down, combined),
                ShortcutEvent::Key(Key::Z, KeyState::Down, combined),
                ShortcutEvent::Key(Key::Z, KeyState::Up, combined),
                ShortcutEvent::Modifier(Modifier::Shift, KeyState::Up, command),
                ShortcutEvent::Modifier(Modifier::Meta, KeyState::Up, CGEventFlags::empty(),),
            ]
        );
    }
}
