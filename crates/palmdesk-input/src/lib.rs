use napi_derive::napi;

#[napi]
pub fn input_version() -> String {
    "palmdesk-input-v0.1.0".to_string()
}

#[cfg(target_os = "macos")]
mod macos_input {
    use std::ffi::c_void;
    use std::ptr;

    #[repr(C)]
    #[derive(Debug, Clone, Copy, PartialEq, Default)]
    pub struct CGPoint {
        pub x: f64,
        pub y: f64,
    }

    const K_CGHIDEVENT_TAP: u32 = 0;
    const K_CGEVENT_LEFT_MOUSE_DOWN: u32 = 1;
    const K_CGEVENT_LEFT_MOUSE_UP: u32 = 2;
    const K_CGEVENT_RIGHT_MOUSE_DOWN: u32 = 3;
    const K_CGEVENT_RIGHT_MOUSE_UP: u32 = 4;
    const K_CGEVENT_MOUSE_MOVED: u32 = 5;

    const K_CGMOUSE_BUTTON_LEFT: u32 = 0;
    const K_CGMOUSE_BUTTON_RIGHT: u32 = 1;

    const K_CGMOUSE_EVENT_CLICK_STATE: u32 = 1;
    const K_CGSCROLL_EVENT_UNIT_LINE: u32 = 1;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreateMouseEvent(
            source: *const c_void,
            mouseType: u32,
            mouseCursorPosition: CGPoint,
            mouseButton: u32,
        ) -> *mut c_void;
        fn CGEventCreateScrollWheelEvent(
            source: *const c_void,
            units: u32,
            wheelCount: u32,
            wheel1: i32,
        ) -> *mut c_void;
        fn CGEventCreateKeyboardEvent(
            source: *const c_void,
            virtualKey: u16,
            keyDown: bool,
        ) -> *mut c_void;
        fn CGEventKeyboardSetUnicodeString(
            event: *mut c_void,
            stringLength: usize,
            unicodeString: *const u16,
        );
        fn CGEventSetIntegerValueField(event: *mut c_void, field: u32, value: i64);
        fn CGEventPost(tap: u32, event: *mut c_void);
        fn CFRelease(cf: *const c_void);
    }

    static mut LAST_MOUSE_POS: CGPoint = CGPoint { x: 0.0, y: 0.0 };

    pub fn set_position(x: f64, y: f64) {
        unsafe {
            LAST_MOUSE_POS = CGPoint { x, y };
            let ev = CGEventCreateMouseEvent(
                ptr::null(),
                K_CGEVENT_MOUSE_MOVED,
                LAST_MOUSE_POS,
                K_CGMOUSE_BUTTON_LEFT,
            );
            if !ev.is_null() {
                CGEventPost(K_CGHIDEVENT_TAP, ev);
                CFRelease(ev);
            }
        }
    }

    pub fn button_down(button: &str) {
        unsafe {
            let (event_type, btn) = if button == "right" {
                (K_CGEVENT_RIGHT_MOUSE_DOWN, K_CGMOUSE_BUTTON_RIGHT)
            } else {
                (K_CGEVENT_LEFT_MOUSE_DOWN, K_CGMOUSE_BUTTON_LEFT)
            };
            let ev = CGEventCreateMouseEvent(ptr::null(), event_type, LAST_MOUSE_POS, btn);
            if !ev.is_null() {
                CGEventPost(K_CGHIDEVENT_TAP, ev);
                CFRelease(ev);
            }
        }
    }

    pub fn button_up(button: &str) {
        unsafe {
            let (event_type, btn) = if button == "right" {
                (K_CGEVENT_RIGHT_MOUSE_UP, K_CGMOUSE_BUTTON_RIGHT)
            } else {
                (K_CGEVENT_LEFT_MOUSE_UP, K_CGMOUSE_BUTTON_LEFT)
            };
            let ev = CGEventCreateMouseEvent(ptr::null(), event_type, LAST_MOUSE_POS, btn);
            if !ev.is_null() {
                CGEventPost(K_CGHIDEVENT_TAP, ev);
                CFRelease(ev);
            }
        }
    }

    pub fn click(button: &str, double: bool) {
        unsafe {
            let (down_type, up_type, btn) = if button == "right" {
                (
                    K_CGEVENT_RIGHT_MOUSE_DOWN,
                    K_CGEVENT_RIGHT_MOUSE_UP,
                    K_CGMOUSE_BUTTON_RIGHT,
                )
            } else {
                (
                    K_CGEVENT_LEFT_MOUSE_DOWN,
                    K_CGEVENT_LEFT_MOUSE_UP,
                    K_CGMOUSE_BUTTON_LEFT,
                )
            };

            let clicks = if double { 2 } else { 1 };
            for state in 1..=clicks {
                let down = CGEventCreateMouseEvent(ptr::null(), down_type, LAST_MOUSE_POS, btn);
                if !down.is_null() {
                    CGEventSetIntegerValueField(down, K_CGMOUSE_EVENT_CLICK_STATE, state);
                    CGEventPost(K_CGHIDEVENT_TAP, down);
                    CFRelease(down);
                }
                let up = CGEventCreateMouseEvent(ptr::null(), up_type, LAST_MOUSE_POS, btn);
                if !up.is_null() {
                    CGEventSetIntegerValueField(up, K_CGMOUSE_EVENT_CLICK_STATE, state);
                    CGEventPost(K_CGHIDEVENT_TAP, up);
                    CFRelease(up);
                }
            }
        }
    }

    pub fn scroll(direction: &str, amount: i32) {
        unsafe {
            let delta = match direction {
                "up" => amount,
                "down" => -amount,
                _ => 0,
            };
            let ev = CGEventCreateScrollWheelEvent(
                ptr::null(),
                K_CGSCROLL_EVENT_UNIT_LINE,
                1,
                delta,
            );
            if !ev.is_null() {
                CGEventPost(K_CGHIDEVENT_TAP, ev);
                CFRelease(ev);
            }
        }
    }

    pub fn type_text(text: &str) {
        unsafe {
            let utf16: Vec<u16> = text.encode_utf16().collect();
            let ev_down = CGEventCreateKeyboardEvent(ptr::null(), 0, true);
            if !ev_down.is_null() {
                CGEventKeyboardSetUnicodeString(ev_down, utf16.len(), utf16.as_ptr());
                CGEventPost(K_CGHIDEVENT_TAP, ev_down);
                CFRelease(ev_down);
            }
            let ev_up = CGEventCreateKeyboardEvent(ptr::null(), 0, false);
            if !ev_up.is_null() {
                CGEventKeyboardSetUnicodeString(ev_up, utf16.len(), utf16.as_ptr());
                CGEventPost(K_CGHIDEVENT_TAP, ev_up);
                CFRelease(ev_up);
            }
        }
    }

    pub fn keys_down(keys: &[u32]) {
        unsafe {
            for &k in keys {
                let ev = CGEventCreateKeyboardEvent(ptr::null(), k as u16, true);
                if !ev.is_null() {
                    CGEventPost(K_CGHIDEVENT_TAP, ev);
                    CFRelease(ev);
                }
            }
        }
    }

    pub fn keys_up(keys: &[u32]) {
        unsafe {
            for &k in keys {
                let ev = CGEventCreateKeyboardEvent(ptr::null(), k as u16, false);
                if !ev.is_null() {
                    CGEventPost(K_CGHIDEVENT_TAP, ev);
                    CFRelease(ev);
                }
            }
        }
    }
}

#[napi]
pub fn mouse_set_position(x: f64, y: f64) {
    #[cfg(target_os = "macos")]
    macos_input::set_position(x, y);
}

#[napi]
pub fn mouse_button_down(button: String) {
    #[cfg(target_os = "macos")]
    macos_input::button_down(&button);
}

#[napi]
pub fn mouse_button_up(button: String) {
    #[cfg(target_os = "macos")]
    macos_input::button_up(&button);
}

#[napi]
pub fn mouse_click(button: String, double: bool) {
    #[cfg(target_os = "macos")]
    macos_input::click(&button, double);
}

#[napi]
pub fn mouse_scroll(direction: String, amount: i32) {
    #[cfg(target_os = "macos")]
    macos_input::scroll(&direction, amount);
}

#[napi]
pub fn keyboard_type(text: String) {
    #[cfg(target_os = "macos")]
    macos_input::type_text(&text);
}

#[napi]
pub fn keyboard_keys_down(keys: Vec<u32>) {
    #[cfg(target_os = "macos")]
    macos_input::keys_down(&keys);
}

#[napi]
pub fn keyboard_keys_up(keys: Vec<u32>) {
    #[cfg(target_os = "macos")]
    macos_input::keys_up(&keys);
}

#[napi]
pub fn is_valid_key(key: u32) -> bool {
    // Valid virtual key range
    key < 256
}
