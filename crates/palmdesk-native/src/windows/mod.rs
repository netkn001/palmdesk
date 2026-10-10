use std::collections::{HashMap, HashSet};
use std::ffi::c_void;

use crate::common::{Bounds, NativeApplication, Request, TargetWindow, WindowError};

#[cfg(target_os = "windows")]
pub fn init() {
    unsafe {
        use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
        use windows::Win32::UI::HiDpi::{
            SetProcessDpiAwareness, SetProcessDpiAwarenessContext,
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, PROCESS_PER_MONITOR_DPI_AWARE,
        };

        if SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2).is_err() {
            let _ = SetProcessDpiAwareness(PROCESS_PER_MONITOR_DPI_AWARE);
        }
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn init() {}

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{CloseHandle, BOOL, FILETIME, HANDLE, HWND, RECT};

#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
pub struct ProcessIdentity {
    pub bundle: String,
    pub name: String,
}

#[cfg(target_os = "windows")]
struct HandleGuard(HANDLE);

#[cfg(target_os = "windows")]
impl Drop for HandleGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

#[cfg(target_os = "windows")]
pub fn supports_capture() -> bool {
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CMONITORS};
        if GetSystemMetrics(SM_CMONITORS) == 0 {
            return false;
        }
        windows::Graphics::Capture::GraphicsCaptureSession::IsSupported().unwrap_or(false)
    }
}

#[cfg(target_os = "windows")]
pub fn read_process(pid: u32) -> Option<ProcessIdentity> {
    unsafe {
        use windows::Win32::System::Threading::{
            GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
            PROCESS_QUERY_LIMITED_INFORMATION,
        };

        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        if handle.is_invalid() {
            return None;
        }
        let _guard = HandleGuard(handle);

        let mut buf = vec![0u16; 32768];
        let mut size = buf.len() as u32;
        if QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut size,
        )
        .is_err()
        {
            return None;
        }

        let mut created = FILETIME::default();
        let mut exited = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        if GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user).is_err() {
            return None;
        }

        let executable = String::from_utf16_lossy(&buf[..size as usize]);
        let started = ((created.dwHighDateTime as u64) << 32) | (created.dwLowDateTime as u64);
        let path = std::path::Path::new(&executable);
        let file_stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");

        Some(ProcessIdentity {
            bundle: format!("win32:{}#{:x}", executable.to_lowercase(), started),
            name: file_stem.to_string(),
        })
    }
}

#[cfg(target_os = "windows")]
pub fn read_window(
    hwnd: HWND,
    processes: &mut HashMap<u32, ProcessIdentity>,
    own_pid: u32,
) -> Option<TargetWindow> {
    unsafe {
        use windows::Win32::Graphics::Dwm::{
            DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
        };
        use windows::Win32::Graphics::Gdi::{MonitorFromWindow, MONITOR_DEFAULTTONULL};
        use windows::Win32::UI::WindowsAndMessaging::{
            GetAncestor, GetClassNameW, GetShellWindow, GetWindowLongW, GetWindowRect,
            GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible,
            GA_ROOT, GWL_EXSTYLE,
        };

        if !IsWindow(hwnd).as_bool() || !IsWindowVisible(hwnd).as_bool() || hwnd == GetShellWindow()
        {
            return None;
        }
        if GetAncestor(hwnd, GA_ROOT) != hwnd {
            return None;
        }

        let style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        if (style & 0x08000000) != 0 || ((style & 0x80) != 0 && (style & 0x40000) == 0) {
            return None;
        }

        let mut class_name_buf = vec![0u16; 256];
        let len = GetClassNameW(hwnd, &mut class_name_buf);
        let class_name = String::from_utf16_lossy(&class_name_buf[..len as usize]);
        match class_name.as_str() {
            "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" => return None,
            _ => {}
        }

        let mut cloaked: i32 = 0;
        let hr = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut _ as *mut c_void,
            std::mem::size_of::<i32>() as u32,
        );
        if hr.is_err() || cloaked != 0 {
            return None;
        }

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 || pid == own_pid {
            return None;
        }

        let identity = match processes.get(&pid) {
            Some(id) => id.clone(),
            None => {
                let id = read_process(pid)?;
                processes.insert(pid, id.clone());
                id
            }
        };

        let minimized = IsIconic(hwnd).as_bool();
        let mut rect = RECT::default();
        let dwm_rect = if minimized {
            Err(windows::core::Error::from_win32())
        } else {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut rect as *mut _ as *mut c_void,
                std::mem::size_of::<RECT>() as u32,
            )
        };

        if minimized || dwm_rect.is_err() {
            if GetWindowRect(hwnd, &mut rect).is_err() {
                return None;
            }
        }

        if rect.right <= rect.left || rect.bottom <= rect.top {
            return None;
        }

        let mut title_buf = vec![0u16; 4096];
        let title_len = GetWindowTextW(hwnd, &mut title_buf);
        let title = String::from_utf16_lossy(&title_buf[..title_len as usize]);

        let mut current_pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut current_pid));
        if !IsWindow(hwnd).as_bool() || current_pid != pid {
            return None;
        }

        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONULL);
        let is_on_screen = !minimized && !monitor.is_invalid();
        let name = if title.is_empty() {
            identity.name.clone()
        } else {
            title.clone()
        };

        Some(TargetWindow {
            native_id: hwnd.0 as usize as u64,
            owner_pid: pid as i32,
            bundle_id: identity.bundle,
            app_name: identity.name,
            name,
            title,
            is_on_screen,
            bounds: Bounds {
                x: rect.left as f64,
                y: rect.top as f64,
                width: (rect.right - rect.left) as f64,
                height: (rect.bottom - rect.top) as f64,
            },
        })
    }
}

#[cfg(target_os = "windows")]
pub fn list_windows() -> Result<Vec<TargetWindow>, WindowError> {
    if !supports_capture() {
        return Err(WindowError::Unsupported(
            "Windows Graphics Capture requires Windows 10 1903 or later and an active desktop"
                .to_string(),
        ));
    }

    unsafe {
        use windows::Win32::Foundation::LPARAM;
        use windows::Win32::System::Threading::GetCurrentProcessId;
        use windows::Win32::UI::WindowsAndMessaging::EnumWindows;

        struct EnumContext {
            windows: Vec<TargetWindow>,
            processes: HashMap<u32, ProcessIdentity>,
            own_pid: u32,
        }

        unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let ctx = &mut *(lparam.0 as *mut EnumContext);
            if let Some(target) = read_window(hwnd, &mut ctx.processes, ctx.own_pid) {
                ctx.windows.push(target);
            }
            BOOL(1)
        }

        let mut ctx = EnumContext {
            windows: Vec::new(),
            processes: HashMap::new(),
            own_pid: GetCurrentProcessId(),
        };

        if let Err(e) = EnumWindows(Some(enum_proc), LPARAM(&mut ctx as *mut _ as isize)) {
            if e.code().0 != 0 {
                return Err(WindowError::Unavailable(
                    "Could not enumerate desktop windows".to_string(),
                ));
            }
        }



        Ok(ctx.windows)
    }
}

#[cfg(target_os = "windows")]
pub fn list_applications() -> Result<Vec<NativeApplication>, WindowError> {
    unsafe {
        use windows::Win32::System::ProcessStatus::EnumProcesses;
        use windows::Win32::System::RemoteDesktop::ProcessIdToSessionId;
        use windows::Win32::System::Threading::GetCurrentProcessId;

        let mut current_session = 0u32;
        let _ = ProcessIdToSessionId(GetCurrentProcessId(), &mut current_session);

        let mut pids = vec![0u32; 2048];
        let mut bytes_returned = 0u32;
        if EnumProcesses(
            pids.as_mut_ptr(),
            (pids.len() * std::mem::size_of::<u32>()) as u32,
            &mut bytes_returned,
        )
        .is_err()
        {
            return Ok(Vec::new());
        }

        let count = (bytes_returned as usize) / std::mem::size_of::<u32>();
        let mut applications = Vec::new();

        for &pid in &pids[..count] {
            if pid == 0 {
                continue;
            }
            let mut session = 0u32;
            if ProcessIdToSessionId(pid, &mut session).is_ok() && session == current_session {
                if let Some(identity) = read_process(pid) {
                    applications.push(NativeApplication {
                        owner_pid: pid as i32,
                        bundle_id: identity.bundle,
                        app_name: identity.name,
                    });
                }
            }
        }

        Ok(applications)
    }
}

#[cfg(target_os = "windows")]
fn verify_window(hwnd: HWND, pid: u32, bundle: &str) -> Result<TargetWindow, WindowError> {
    let mut processes = HashMap::new();
    let own_pid = unsafe { windows::Win32::System::Threading::GetCurrentProcessId() };
    let target = read_window(hwnd, &mut processes, own_pid).ok_or_else(|| {
        WindowError::Gone(
            "The selected window is no longer available or its identity changed".to_string(),
        )
    })?;

    if target.owner_pid != pid as i32 || target.bundle_id != bundle {
        return Err(WindowError::Gone(
            "The selected window is no longer available or its identity changed".to_string(),
        ));
    }
    Ok(target)
}

#[cfg(target_os = "windows")]
fn integrity_level(handle: HANDLE) -> i32 {
    unsafe {
        use windows::Win32::Security::{
            GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, TokenIntegrityLevel,
            TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
        };
        use windows::Win32::System::Threading::OpenProcessToken;

        let mut token = HANDLE::default();
        if OpenProcessToken(handle, TOKEN_QUERY, &mut token).is_err() {
            return -1;
        }
        let _guard = HandleGuard(token);

        let mut size = 0u32;
        let _ = GetTokenInformation(token, TokenIntegrityLevel, None, 0, &mut size);
        if size < std::mem::size_of::<TOKEN_MANDATORY_LABEL>() as u32 || size > 65536 {
            return -1;
        }

        let mut buffer = vec![0u8; size as usize];
        if GetTokenInformation(
            token,
            TokenIntegrityLevel,
            Some(buffer.as_mut_ptr() as *mut _),
            size,
            &mut size,
        )
        .is_err()
        {
            return -1;
        }

        let label = &*(buffer.as_ptr() as *const TOKEN_MANDATORY_LABEL);
        let sid = label.Label.Sid;
        if sid.is_invalid() || sid.0.is_null() {
            return -1;
        }

        let count_ptr = GetSidSubAuthorityCount(sid);
        if count_ptr.is_null() {
            return -1;
        }
        let count = *count_ptr;
        if count == 0 {
            return -1;
        }

        let sub_auth_ptr = GetSidSubAuthority(sid, (count - 1) as u32);
        if sub_auth_ptr.is_null() {
            return -1;
        }
        *sub_auth_ptr as i32
    }
}

#[cfg(target_os = "windows")]
fn check_input_permission(pid: u32) -> Result<(), WindowError> {
    unsafe {
        use windows::Win32::System::Threading::{
            GetCurrentProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };

        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).map_err(|_| {
            WindowError::Permission("The selected process is not accessible".to_string())
        })?;
        if process.is_invalid() {
            return Err(WindowError::Permission(
                "The selected process is not accessible".to_string(),
            ));
        }
        let _guard = HandleGuard(process);

        let own = integrity_level(GetCurrentProcess());
        let target = integrity_level(process);
        if own < 0 || target < 0 || target > own {
            return Err(WindowError::Permission(
                "Windows blocks input to a process with a higher privilege level".to_string(),
            ));
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn get_native_id(request: &Request) -> Result<u64, WindowError> {
    let val = request
        .payload
        .get("nativeId")
        .ok_or_else(|| WindowError::Invalid("Invalid native window request".to_string()))?;
    let num = match val {
        serde_json::Value::Number(n) => n
            .as_u64()
            .or_else(|| n.as_i64().and_then(|i| if i > 0 { Some(i as u64) } else { None })),
        _ => None,
    };
    match num {
        Some(n) if n > 0 => Ok(n),
        _ => Err(WindowError::Invalid("Invalid native window identity".to_string())),
    }
}

#[cfg(target_os = "windows")]
fn get_pid(request: &Request) -> Result<u32, WindowError> {
    let val = request
        .payload
        .get("ownerPid")
        .ok_or_else(|| WindowError::Invalid("Invalid native window request".to_string()))?;
    match val {
        serde_json::Value::Number(n) => {
            let pid = n.as_u64().unwrap_or(0);
            if pid > 0 && pid <= u32::MAX as u64 {
                Ok(pid as u32)
            } else {
                Err(WindowError::Invalid("Invalid native window identity".to_string()))
            }
        }
        _ => Err(WindowError::Invalid("Invalid native window request".to_string())),
    }
}

#[cfg(target_os = "windows")]
fn get_bundle_id(request: &Request) -> Result<String, WindowError> {
    let val = request
        .payload
        .get("bundleId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| WindowError::Invalid("Missing executable identity".to_string()))?;
    if val.trim().is_empty() {
        return Err(WindowError::Invalid("Missing executable identity".to_string()));
    }
    Ok(val.to_string())
}

#[cfg(target_os = "windows")]
pub fn focus_window(request: &Request) -> Result<TargetWindow, WindowError> {
    let native_id = get_native_id(request)?;
    let pid = get_pid(request)?;
    let bundle = get_bundle_id(request)?;
    let hwnd = HWND(native_id as usize as *mut c_void);

    verify_window(hwnd, pid, &bundle)?;
    check_input_permission(pid)?;

    unsafe {
        use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
        use windows::Win32::UI::Input::KeyboardAndMouse::IsWindowEnabled;
        use windows::Win32::UI::WindowsAndMessaging::{
            BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId,
            IsIconic, SetForegroundWindow, ShowWindowAsync, SW_RESTORE,
        };

        if !IsWindowEnabled(hwnd).as_bool() {
            return Err(WindowError::Focus(
                "The selected window is blocked by a dialog".to_string(),
            ));
        }

        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindowAsync(hwnd, SW_RESTORE);
            let start = std::time::Instant::now();
            while IsIconic(hwnd).as_bool() && start.elapsed().as_millis() < 1500 {
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            verify_window(hwnd, pid, &bundle)?;
        }

        if GetForegroundWindow() != hwnd {
            let _ = SetForegroundWindow(hwnd);
            if GetForegroundWindow() != hwnd {
                let mut foreground_pid = 0u32;
                let foreground_thread =
                    GetWindowThreadProcessId(GetForegroundWindow(), Some(&mut foreground_pid));
                let own_thread = GetCurrentThreadId();
                let attached = foreground_thread != 0
                    && foreground_thread != own_thread
                    && AttachThreadInput(own_thread, foreground_thread, true).as_bool();
                let _ = BringWindowToTop(hwnd);
                let _ = SetForegroundWindow(hwnd);
                if attached {
                    let _ = AttachThreadInput(own_thread, foreground_thread, false);
                }
            }
            let start = std::time::Instant::now();
            while GetForegroundWindow() != hwnd && start.elapsed().as_millis() < 750 {
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
        }

        let refreshed = verify_window(hwnd, pid, &bundle)?;
        if !refreshed.is_on_screen
            || GetForegroundWindow() != hwnd
            || !IsWindowEnabled(hwnd).as_bool()
        {
            return Err(WindowError::Focus(
                "The selected window could not be focused; bring it to the foreground and retry"
                    .to_string(),
            ));
        }
        Ok(refreshed)
    }
}

#[cfg(target_os = "windows")]
pub fn type_text(request: &Request) -> Result<serde_json::Value, WindowError> {
    let text = request
        .payload
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            WindowError::Invalid("Text length must be between 1 and 4096".to_string())
        })?;
    let char_count = text.encode_utf16().count();
    if char_count < 1 || char_count > 4096 {
        return Err(WindowError::Invalid(
            "Text length must be between 1 and 4096".to_string(),
        ));
    }

    let target = focus_window(request)?;

    unsafe {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
            KEYEVENTF_UNICODE, VIRTUAL_KEY,
        };
        use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

        let utf16_chars: Vec<u16> = text.encode_utf16().collect();
        let mut inputs = Vec::with_capacity(utf16_chars.len() * 2);

        for &ch in &utf16_chars {
            // VK_PACKET inserts literal UTF-16, bypassing keyboard-layout and IME conversion.
            inputs.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(0),
                        wScan: ch,
                        dwFlags: KEYEVENTF_UNICODE,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            });
            inputs.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(0),
                        wScan: ch,
                        dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            });
        }

        if GetForegroundWindow().0 as usize as u64 != target.native_id
            || SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) != inputs.len() as u32
        {
            return Err(WindowError::Permission(
                "Windows could not insert the requested text".to_string(),
            ));
        }

        Ok(serde_json::json!({}))
    }
}

#[cfg(target_os = "windows")]
pub fn verify_image_paste(request: &Request) -> Result<TargetWindow, WindowError> {
    let native_id = get_native_id(request)?;
    let pid = get_pid(request)?;
    let bundle = get_bundle_id(request)?;
    let hwnd = HWND(native_id as usize as *mut c_void);

    let target = verify_window(hwnd, pid, &bundle)?;

    let prefix = "win32:";
    if !target.bundle_id.starts_with(prefix) {
        return Err(WindowError::Invalid(
            "Image paste requires a verified Windows Codex window".to_string(),
        ));
    }
    let rest = &target.bundle_id[prefix.len()..];
    let hash_pos = rest.rfind('#').ok_or_else(|| {
        WindowError::Invalid("Image paste requires a verified Windows Codex window".to_string())
    })?;
    let executable_path = &rest[..hash_pos];
    let file_name = std::path::Path::new(executable_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if !file_name.eq_ignore_ascii_case("codex.exe") {
        return Err(WindowError::Invalid(
            "Image paste requires a verified Windows Codex window".to_string(),
        ));
    }

    check_input_permission(pid)?;

    unsafe {
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, IsWindowEnabled};
        use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

        if !target.is_on_screen || !IsWindowEnabled(hwnd).as_bool() || GetForegroundWindow() != hwnd
        {
            return Err(WindowError::Focus(
                "The selected Codex window must remain in the foreground".to_string(),
            ));
        }

        for key in 1..255 {
            if (GetAsyncKeyState(key) as u16 & 0x8000) != 0 {
                return Err(WindowError::InputBusy(
                    "Release held modifiers and V before pasting".to_string(),
                ));
            }
        }
    }

    Ok(target)
}

#[cfg(target_os = "windows")]
pub fn paste_image(request: &Request) -> Result<serde_json::Value, WindowError> {
    let target = verify_image_paste(request)?;
    unsafe {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
            KEYEVENTF_KEYUP, VK_CONTROL, VIRTUAL_KEY,
        };
        use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

        fn key_input(vk: VIRTUAL_KEY, up: bool) -> INPUT {
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: if up {
                            KEYEVENTF_KEYUP
                        } else {
                            KEYBD_EVENT_FLAGS(0)
                        },
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            }
        }

        let inputs = [
            key_input(VK_CONTROL, false),
            key_input(VIRTUAL_KEY(0x56), false),
            key_input(VIRTUAL_KEY(0x56), true),
            key_input(VK_CONTROL, true),
        ];

        let hwnd = HWND(target.native_id as usize as *mut c_void);
        if GetForegroundWindow() != hwnd {
            return Err(WindowError::Focus(
                "The selected Codex window lost foreground focus".to_string(),
            ));
        }

        let inserted = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        if inserted != inputs.len() as u32 {
            if inserted > 0 {
                let release = [
                    key_input(VIRTUAL_KEY(0x56), true),
                    key_input(VK_CONTROL, true),
                ];
                let _ = SendInput(&release, std::mem::size_of::<INPUT>() as i32);
            }
            return Err(WindowError::PasteUnconfirmed(
                "Windows did not confirm the complete paste shortcut".to_string(),
            ));
        }

        Ok(serde_json::json!({}))
    }
}

#[cfg(target_os = "windows")]
pub fn diagnostics() -> Result<serde_json::Value, WindowError> {
    let windows = list_windows()?;
    let mut applications = Vec::new();
    let mut seen = HashSet::new();

    for w in windows {
        if seen.insert(w.bundle_id.clone()) {
            applications.push(serde_json::json!({
                "bundleId": w.bundle_id,
                "appName": w.app_name,
            }));
        }
    }

    Ok(serde_json::json!({
        "applications": applications,
    }))
}

#[cfg(target_os = "windows")]
pub fn dispatch(request: &Request) -> Result<serde_json::Value, WindowError> {
    match request.command.as_str() {
        "list" => Ok(serde_json::to_value(list_windows()?).unwrap()),
        "applications" => Ok(serde_json::to_value(list_applications()?).unwrap()),
        "focus" => Ok(serde_json::to_value(focus_window(request)?).unwrap()),
        "text" => type_text(request),
        "verifyImagePaste" => Ok(serde_json::to_value(verify_image_paste(request)?).unwrap()),
        "pasteImage" => paste_image(request),
        "permissions" => Ok(serde_json::json!({
            "accessibility": true,
            "captureSupported": supports_capture(),
        })),
        "thumbnails" => Ok(serde_json::json!([])),
        "diagnostics" => diagnostics(),
        _ => Err(WindowError::Invalid("Unsupported native window command".to_string())),
    }
}

#[cfg(not(target_os = "windows"))]
pub fn dispatch(_request: &Request) -> Result<serde_json::Value, WindowError> {
    Err(WindowError::Unsupported(
        "Windows native helper unavailable on non-windows".to_string(),
    ))
}
