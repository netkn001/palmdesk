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

    fn nut_to_macos_key(k: u32) -> u16 {
        match k {
            0 => 53,   // Escape
            28 => 50,  // Grave
            29 => 18,  // Num1
            30 => 19,  // Num2
            31 => 20,  // Num3
            32 => 21,  // Num4
            33 => 23,  // Num5
            34 => 22,  // Num6
            35 => 26,  // Num7
            36 => 28,  // Num8
            37 => 25,  // Num9
            38 => 29,  // Num0
            39 => 27,  // Minus
            40 => 24,  // Equal
            41 => 51,  // Backspace
            49 => 48,  // Tab
            50 => 12,  // Q
            51 => 13,  // W
            52 => 14,  // E
            53 => 15,  // R
            54 => 17,  // T
            55 => 16,  // Y
            56 => 32,  // U
            57 => 34,  // I
            58 => 31,  // O
            59 => 35,  // P
            60 => 33,  // LeftBracket
            61 => 30,  // RightBracket
            62 => 42,  // Backslash
            63 => 117, // Delete
            70 => 57,  // CapsLock
            71 => 0,   // A
            72 => 1,   // S
            73 => 2,   // D
            74 => 3,   // F
            75 => 5,   // G
            76 => 4,   // H
            77 => 38,  // J
            78 => 40,  // K
            79 => 37,  // L
            80 => 41,  // Semicolon
            81 => 39,  // Quote
            82 => 36,  // Return
            86 => 56,  // LeftShift
            87 => 6,   // Z
            88 => 7,   // X
            89 => 8,   // C
            90 => 9,   // V
            91 => 11,  // B
            92 => 45,  // N
            93 => 46,  // M
            94 => 43,  // Comma
            95 => 47,  // Period
            96 => 44,  // Slash
            97 => 60,  // RightShift
            98 => 126, // Up
            102 => 36, // Enter
            103 => 59, // LeftControl
            106 => 55, // LeftCmd
            107 => 58, // LeftAlt
            108 => 49, // Space
            109 => 61, // RightAlt
            112 => 54, // RightCmd
            114 => 62, // RightControl
            116 => 123,// Left
            117 => 125,// Down
            118 => 124,// Right
            _ => k as u16,
        }
    }

    pub fn keys_down(keys: &[u32]) {
        unsafe {
            for &k in keys {
                let code = nut_to_macos_key(k);
                let ev = CGEventCreateKeyboardEvent(ptr::null(), code, true);
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
                let code = nut_to_macos_key(k);
                let ev = CGEventCreateKeyboardEvent(ptr::null(), code, false);
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
