pub mod appkit;
pub mod ffi;

use std::collections::HashSet;
use std::ffi::{c_void, CStr, CString};
use std::ptr;
use std::thread::sleep;
use std::time::{Duration, Instant};

use crate::common::{Bounds, NativeApplication, Request, TargetWindow, WindowError};
use appkit::{path_from_nsurl, RunningApp, Workspace};
use ffi::*;

unsafe fn cf_str(s: &str) -> CFStringRef {
    let c_str = CString::new(s).unwrap_or_default();
    CFStringCreateWithCString(ptr::null(), c_str.as_ptr(), kCFStringEncodingUTF8)
}

unsafe fn cf_to_string(cf: CFStringRef) -> Option<String> {
    if cf.is_null() {
        return None;
    }
    let len = CFStringGetLength(cf);
    let max_bytes = len * 4 + 1;
    let mut buf = vec![0u8; max_bytes as usize];
    if CFStringGetCString(
        cf,
        buf.as_mut_ptr() as *mut std::os::raw::c_char,
        max_bytes,
        kCFStringEncodingUTF8,
    ) {
        let c_str = CStr::from_ptr(buf.as_ptr() as *const std::os::raw::c_char);
        Some(c_str.to_string_lossy().into_owned())
    } else {
        None
    }
}

unsafe fn dict_get_i32(dict: CFDictionaryRef, key: &str) -> Option<i32> {
    let k = cf_str(key);
    let val = CFDictionaryGetValue(dict, k as *const c_void);
    CFRelease(k as CFTypeRef);
    if val.is_null() {
        return None;
    }
    let mut num: i32 = 0;
    if CFNumberGetValue(val as CFNumberRef, 3 /* kCFNumberSInt32Type */, &mut num as *mut _ as *mut c_void) {
        Some(num)
    } else {
        None
    }
}

unsafe fn dict_get_u32(dict: CFDictionaryRef, key: &str) -> Option<u32> {
    dict_get_i32(dict, key).map(|n| n as u32)
}

unsafe fn dict_get_f64(dict: CFDictionaryRef, key: &str) -> Option<f64> {
    let k = cf_str(key);
    let val = CFDictionaryGetValue(dict, k as *const c_void);
    CFRelease(k as CFTypeRef);
    if val.is_null() {
        return None;
    }
    let mut num: f64 = 0.0;
    if CFNumberGetValue(val as CFNumberRef, 13 /* kCFNumberFloat64Type */, &mut num as *mut _ as *mut c_void) {
        Some(num)
    } else {
        None
    }
}

unsafe fn dict_get_bool(dict: CFDictionaryRef, key: &str) -> Option<bool> {
    let k = cf_str(key);
    let val = CFDictionaryGetValue(dict, k as *const c_void);
    CFRelease(k as CFTypeRef);
    if val.is_null() {
        return None;
    }
    Some(CFBooleanGetValue(val as CFBooleanRef))
}

unsafe fn dict_get_string(dict: CFDictionaryRef, key: &str) -> Option<String> {
    let k = cf_str(key);
    let val = CFDictionaryGetValue(dict, k as *const c_void);
    CFRelease(k as CFTypeRef);
    if val.is_null() {
        return None;
    }
    cf_to_string(val as CFStringRef)
}

pub fn windows(target_id: Option<u32>) -> Vec<TargetWindow> {
    let mut results = Vec::new();
    unsafe {
        let options = match target_id {
            None => kCGWindowListOptionAll | kCGWindowListExcludeDesktopElements,
            Some(_) => kCGWindowListOptionIncludingWindow | kCGWindowListExcludeDesktopElements,
        };
        let relative = target_id.unwrap_or(kCGNullWindowID);
        let list = CGWindowListCopyWindowInfo(options, relative);
        if list.is_null() {
            return results;
        }
        let count = CFArrayGetCount(list);
        for i in 0..count {
            let dict = CFArrayGetValueAtIndex(list, i) as CFDictionaryRef;
            if dict.is_null() {
                continue;
            }

            let id = match dict_get_u32(dict, "kCGWindowNumber") {
                Some(id) => id,
                None => continue,
            };

            let pid = match dict_get_i32(dict, "kCGWindowOwnerPID") {
                Some(pid) => pid,
                None => continue,
            };

            let layer = dict_get_i32(dict, "kCGWindowLayer").unwrap_or(-1);
            if layer != 0 {
                continue;
            }

            let alpha = dict_get_f64(dict, "kCGWindowAlpha").unwrap_or(1.0);
            if alpha <= 0.0 {
                continue;
            }

            let app = match RunningApp::from_pid(pid) {
                Some(app) => app,
                None => continue,
            };

            let bundle = match app.bundle_identifier() {
                Some(bundle) => bundle,
                None => continue,
            };

            if app.activation_policy() != 0 {
                continue;
            }

            let bounds_key = cf_str("kCGWindowBounds");
            let raw_bounds = CFDictionaryGetValue(dict, bounds_key as *const c_void);
            CFRelease(bounds_key as CFTypeRef);
            if raw_bounds.is_null() {
                continue;
            }

            let mut rect = CGRect::default();
            if !CGRectMakeWithDictionaryRepresentation(raw_bounds as CFDictionaryRef, &mut rect) {
                continue;
            }

            if rect.size.width <= 1.0 || rect.size.height <= 1.0 {
                continue;
            }

            let title = dict_get_string(dict, "kCGWindowName").unwrap_or_default();
            let is_on_screen = dict_get_bool(dict, "kCGWindowIsOnscreen").unwrap_or(false);
            let app_name = app.localized_name().unwrap_or_else(|| bundle.clone());
            let name = if title.is_empty() {
                app_name.clone()
            } else {
                title.clone()
            };

            results.push(TargetWindow {
                native_id: id as u64,
                owner_pid: pid,
                bundle_id: bundle,
                app_name,
                name,
                title,
                is_on_screen,
                bounds: Bounds {
                    x: rect.origin.x,
                    y: rect.origin.y,
                    width: rect.size.width,
                    height: rect.size.height,
                },
            });
        }
        CFRelease(list as CFTypeRef);
    }
    results
}

unsafe fn attribute(element: AXUIElementRef, name: &str) -> Option<CFTypeRef> {
    let attr_str = cf_str(name);
    let mut val: CFTypeRef = ptr::null();
    let err = AXUIElementCopyAttributeValue(element, attr_str, &mut val);
    CFRelease(attr_str as CFTypeRef);
    if err == kAXErrorSuccess && !val.is_null() {
        Some(val)
    } else {
        None
    }
}

unsafe fn window_number(element: AXUIElementRef) -> Option<u32> {
    if let Some(num_ref) = attribute(element, "AXWindowNumber") {
        let mut num: u32 = 0;
        let ok = CFNumberGetValue(
            num_ref as CFNumberRef,
            3, /* kCFNumberSInt32Type */
            &mut num as *mut _ as *mut c_void,
        );
        CFRelease(num_ref);
        if ok && num != 0 {
            return Some(num);
        }
    }
    None
}

unsafe fn matches(element: AXUIElementRef, target: &TargetWindow) -> bool {
    if let Some(num) = window_number(element) {
        return num as u64 == target.native_id;
    }

    let title = attribute(element, "AXTitle")
        .and_then(|t| {
            let s = cf_to_string(t as CFStringRef);
            CFRelease(t);
            s
        })
        .unwrap_or_default();
    if title != target.title {
        return false;
    }

    let pos_val = match attribute(element, "AXPosition") {
        Some(v) => v,
        None => return false,
    };
    let size_val = match attribute(element, "AXSize") {
        Some(v) => v,
        None => {
            CFRelease(pos_val);
            return false;
        }
    };

    let mut pos = CGPoint::default();
    let mut size = CGSize::default();
    let pos_ok = AXValueGetValue(pos_val as AXValueRef, kAXValueTypeCGPoint, &mut pos as *mut _ as *mut c_void);
    let size_ok = AXValueGetValue(size_val as AXValueRef, kAXValueTypeCGSize, &mut size as *mut _ as *mut c_void);
    CFRelease(pos_val);
    CFRelease(size_val);

    if !pos_ok || !size_ok {
        return false;
    }

    let b = &target.bounds;
    (pos.x - b.x).abs() < 2.0
        && (pos.y - b.y).abs() < 2.0
        && (size.width - b.width).abs() < 2.0
        && (size.height - b.height).abs() < 2.0
}

pub fn listed_windows() -> Vec<TargetWindow> {
    let all = windows(None);
    all.into_iter()
        .filter(|t| t.is_on_screen || !t.title.is_empty())
        .collect()
}

pub fn application_identity() -> Result<serde_json::Value, WindowError> {
    let parent_pid = unsafe { libc::getppid() };
    let parent = RunningApp::from_pid(parent_pid)
        .ok_or_else(|| WindowError::Invalid("Parent application not found".to_string()))?;
    let bundle_id = parent
        .bundle_identifier()
        .ok_or_else(|| WindowError::Invalid("Parent has no bundle ID".to_string()))?;
    let bundle_url = parent
        .bundle_url()
        .and_then(path_from_nsurl)
        .ok_or_else(|| WindowError::Invalid("Parent has no bundle URL".to_string()))?;
    let executable_path = parent
        .executable_url()
        .and_then(path_from_nsurl)
        .ok_or_else(|| WindowError::Invalid("Parent has no executable URL".to_string()))?;

    let registered_urls = Workspace::urls_for_applications(&bundle_id);
    let mut paths: HashSet<String> = registered_urls
        .into_iter()
        .filter_map(path_from_nsurl)
        .collect();
    paths.insert(bundle_url.clone());

    let mut registered_paths: Vec<String> = paths.into_iter().collect();
    registered_paths.sort();

    Ok(serde_json::json!({
        "bundleId": bundle_id,
        "bundlePath": bundle_url,
        "executablePath": executable_path,
        "registeredPaths": registered_paths,
    }))
}

pub fn installed_agents(bundles: &[String]) -> Vec<String> {
    bundles
        .iter()
        .filter(|bundle| {
            if let Some(url) = Workspace::url_for_application(bundle) {
                if let Some(path) = path_from_nsurl(url) {
                    return std::path::Path::new(&path).exists();
                }
            }
            false
        })
        .cloned()
        .collect()
}

pub fn launch_agent(bundle_id: &str) -> Result<(), WindowError> {
    let url = Workspace::url_for_application(bundle_id)
        .ok_or_else(|| WindowError::ApplicationUnavailable("Agent 已移除或尚未安装，请刷新后重试".to_string()))?;
    if Workspace::open_application_at_url(url) {
        Ok(())
    } else {
        Err(WindowError::LaunchFailed("无法打开 Agent，请在电脑上检查应用后重试".to_string()))
    }
}

pub fn reveal(bundle_id: &str) -> Result<bool, WindowError> {
    let running = Workspace::running_applications()
        .into_iter()
        .find(|app| app.bundle_identifier().as_deref() == Some(bundle_id))
        .ok_or_else(|| WindowError::Unavailable("Target window is no longer available".to_string()))?;
    if running.activation_policy() != 0 {
        return Err(WindowError::Unavailable("Target window is no longer available".to_string()));
    }
    unsafe {
        if AXIsProcessTrusted() {
            let app_elem = AXUIElementCreateApplication(running.process_identifier());
            if let Some(windows_ref) = attribute(app_elem, "AXWindows") {
                let count = CFArrayGetCount(windows_ref as CFArrayRef);
                let unmin_attr = cf_str("AXMinimized");
                for i in 0..count {
                    let win = CFArrayGetValueAtIndex(windows_ref as CFArrayRef, i) as AXUIElementRef;
                    let k_false = ffi::kCFBooleanFalse as CFTypeRef;
                    AXUIElementSetAttributeValue(win, unmin_attr, k_false);
                }
                CFRelease(unmin_attr as CFTypeRef);
                CFRelease(windows_ref);
            }
            CFRelease(app_elem as CFTypeRef);
        }
    }
    Ok(running.activate(1 /* NSApplicationActivateAllWindows */))
}

pub fn focus(id: u64, pid: i32, bundle: &str) -> Result<TargetWindow, WindowError> {
    unsafe {
        if !AXIsProcessTrusted() {
            return Err(WindowError::Permission(
                "Accessibility permission is required for the PalmDesk native window helper".to_string(),
            ));
        }

        let app_elem = AXUIElementCreateApplication(pid);
        AXUIElementSetMessagingTimeout(app_elem, 0.5);

        // Fast path: if frontmost and focused matches id
        if let Some(front) = Workspace::frontmost_application() {
            if front.process_identifier() == pid {
                if let Some(focused) = attribute(app_elem, "AXFocusedWindow") {
                    let num = window_number(focused as AXUIElementRef);
                    CFRelease(focused);
                    if num == Some(id as u32) {
                        let target = windows(Some(id as u32))
                            .into_iter()
                            .find(|w| w.native_id == id && w.owner_pid == pid && w.bundle_id == bundle);
                        if let Some(t) = target {
                            if t.is_on_screen {
                                CFRelease(app_elem as CFTypeRef);
                                return Ok(t);
                            }
                        }
                    }
                }
            }
        }

        let app_windows: Vec<TargetWindow> = windows(None)
            .into_iter()
            .filter(|w| w.owner_pid == pid && w.bundle_id == bundle)
            .collect();
        let target = app_windows
            .iter()
            .find(|w| w.native_id == id)
            .cloned()
            .ok_or_else(|| WindowError::Unavailable("Target window is no longer available".to_string()))?;

        let running = RunningApp::from_pid(pid)
            .ok_or_else(|| WindowError::Unavailable("Target window is no longer available".to_string()))?;

        // Find candidate AX window
        let mut candidate: Option<AXUIElementRef> = None;
        if let Some(wins_ref) = attribute(app_elem, "AXWindows") {
            let count = CFArrayGetCount(wins_ref as CFArrayRef);
            for i in 0..count {
                let win = CFArrayGetValueAtIndex(wins_ref as CFArrayRef, i) as AXUIElementRef;
                if matches(win, &target) {
                    CFRetain(win as CFTypeRef);
                    candidate = Some(win);
                    break;
                }
            }
            CFRelease(wins_ref);
        }

        let win = candidate.ok_or_else(|| {
            CFRelease(app_elem as CFTypeRef);
            WindowError::Ambiguous("Cannot identify the exact accessibility window".to_string())
        })?;

        // Unminimize if minimized
        let unmin_key = cf_str("AXMinimized");
        let k_false = ffi::kCFBooleanFalse as CFTypeRef;
        let _ = AXUIElementSetAttributeValue(win, unmin_key, k_false);
        CFRelease(unmin_key as CFTypeRef);

        // Raise and focus
        let raise_action = cf_str("AXRaise");
        let main_attr = cf_str("AXMain");
        let front_attr = cf_str("AXFrontmost");
        let focus_attr = cf_str("AXFocusedWindow");
        let k_true = ffi::kCFBooleanTrue as CFTypeRef;

        let _ = AXUIElementSetAttributeValue(win, main_attr, k_true);
        let _ = AXUIElementPerformAction(win, raise_action);
        let _ = running.activate(0);
        let _ = AXUIElementSetAttributeValue(app_elem, front_attr, k_true);
        let _ = AXUIElementPerformAction(win, raise_action);
        let _ = AXUIElementSetAttributeValue(app_elem, focus_attr, win as CFTypeRef);

        CFRelease(raise_action as CFTypeRef);
        CFRelease(main_attr as CFTypeRef);
        CFRelease(front_attr as CFTypeRef);
        CFRelease(focus_attr as CFTypeRef);

        // Wait up to 2 seconds for focus confirmation
        let start = Instant::now();
        while start.elapsed() < Duration::from_millis(2000) {
            let refreshed = windows(Some(id as u32))
                .into_iter()
                .find(|w| w.native_id == id && w.owner_pid == pid && w.bundle_id == bundle);
            if let Some(t) = refreshed {
                if t.is_on_screen {
                    CFRelease(win as CFTypeRef);
                    CFRelease(app_elem as CFTypeRef);
                    return Ok(t);
                }
            }
            sleep(Duration::from_millis(25));
        }

        CFRelease(win as CFTypeRef);
        CFRelease(app_elem as CFTypeRef);
        Err(WindowError::Focus("The selected window could not be focused".to_string()))
    }
}

pub fn permissions() -> serde_json::Value {
    let ax = unsafe { AXIsProcessTrusted() };
    let screen = unsafe { CGPreflightScreenCaptureAccess() };
    serde_json::json!({
        "accessibility": ax,
        "screen": screen,
    })
}

pub fn diagnostics() -> serde_json::Value {
    let all = windows(None);
    let apps = Workspace::running_applications()
        .into_iter()
        .filter(|app| app.activation_policy() == 0)
        .map(|app| {
            serde_json::json!({
                "pid": app.process_identifier(),
                "bundleId": app.bundle_identifier().unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();
    let wins = all
        .iter()
        .map(|w| {
            serde_json::json!({
                "id": w.native_id,
                "pid": w.owner_pid,
                "bundleId": w.bundle_id,
                "onscreen": w.is_on_screen,
            })
        })
        .collect::<Vec<_>>();
    serde_json::json!({
        "windowCount": all.len(),
        "applications": apps,
        "windows": wins,
    })
}

pub fn dispatch(request: &Request) -> Result<serde_json::Value, WindowError> {
    match request.command.as_str() {
        "appIdentity" => application_identity(),
        "installedAgents" => {
            let bundles: Vec<String> = request
                .payload
                .get("bundles")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .ok_or_else(|| WindowError::Invalid("Invalid bundles array".to_string()))?;
            Ok(serde_json::to_value(installed_agents(&bundles)).unwrap())
        }
        "launchAgent" => {
            let bundle_id = request
                .payload
                .get("bundleId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| WindowError::Invalid("Missing bundleId".to_string()))?;
            launch_agent(bundle_id)?;
            Ok(serde_json::json!({ "opened": true }))
        }
        "list" => Ok(serde_json::to_value(listed_windows()).unwrap()),
        "applications" => {
            let apps: Vec<NativeApplication> = Workspace::running_applications()
                .into_iter()
                .filter(|app| app.activation_policy() == 0 && !app.is_terminated() && app.process_identifier() > 0)
                .filter_map(|app| {
                    let bundle = app.bundle_identifier()?;
                    let name = app.localized_name().unwrap_or_else(|| bundle.clone());
                    Some(NativeApplication {
                        owner_pid: app.process_identifier(),
                        bundle_id: bundle,
                        app_name: name,
                    })
                })
                .collect();
            Ok(serde_json::to_value(apps).unwrap())
        }
        "thumbnails" => {
            // ScreenCaptureKit / window thumbnails preview. Return empty array by default or previews.
            Ok(serde_json::json!([]))
        }
        "focus" => {
            let id = request
                .payload
                .get("nativeId")
                .and_then(|v| v.as_u64())
                .ok_or_else(|| WindowError::Invalid("Missing nativeId".to_string()))?;
            let pid = request
                .payload
                .get("ownerPid")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| WindowError::Invalid("Missing ownerPid".to_string()))? as i32;
            let bundle = request
                .payload
                .get("bundleId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| WindowError::Invalid("Missing bundleId".to_string()))?;
            let target = focus(id, pid, bundle)?;
            Ok(serde_json::to_value(target).unwrap())
        }
        "permissions" => Ok(permissions()),
        "reveal" => {
            let bundle = request
                .payload
                .get("bundleId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| WindowError::Invalid("Missing bundleId".to_string()))?;
            let activated = reveal(bundle)?;
            Ok(serde_json::json!({ "activated": activated }))
        }
        "diagnostics" => Ok(diagnostics()),
        _ => Err(WindowError::Invalid("Invalid native window command".to_string())),
    }
}
