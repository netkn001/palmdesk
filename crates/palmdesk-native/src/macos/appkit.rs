use std::ffi::CString;
use objc::runtime::Object;
use objc::{class, msg_send, sel, sel_impl};

pub fn set_activation_policy_prohibited() {
    unsafe {
        let app: *mut Object = msg_send![class!(NSApplication), sharedApplication];
        if !app.is_null() {
            let () = msg_send![app, setActivationPolicy: 2isize];
        }
    }
}

pub fn nsstring_from_str(s: &str) -> *mut Object {
    unsafe {
        let c_str = CString::new(s).unwrap_or_default();
        let cls = class!(NSString);
        msg_send![cls, stringWithUTF8String: c_str.as_ptr()]
    }
}

pub fn str_from_nsstring(ns_str: *mut Object) -> Option<String> {
    if ns_str.is_null() {
        return None;
    }
    unsafe {
        let c_ptr: *const std::os::raw::c_char = msg_send![ns_str, UTF8String];
        if c_ptr.is_null() {
            None
        } else {
            Some(std::ffi::CStr::from_ptr(c_ptr).to_string_lossy().into_owned())
        }
    }
}

pub fn path_from_nsurl(ns_url: *mut Object) -> Option<String> {
    if ns_url.is_null() {
        return None;
    }
    unsafe {
        let resolved: *mut Object = msg_send![ns_url, URLByResolvingSymlinksInPath];
        let target = if resolved.is_null() { ns_url } else { resolved };
        let path: *mut Object = msg_send![target, path];
        str_from_nsstring(path)
    }
}

pub struct RunningApp {
    pub obj: *mut Object,
}

impl RunningApp {
    pub fn from_pid(pid: i32) -> Option<Self> {
        unsafe {
            let obj: *mut Object = msg_send![
                class!(NSRunningApplication),
                runningApplicationWithProcessIdentifier: pid
            ];
            if obj.is_null() {
                None
            } else {
                Some(RunningApp { obj })
            }
        }
    }

    pub fn bundle_identifier(&self) -> Option<String> {
        unsafe {
            let ns_str: *mut Object = msg_send![self.obj, bundleIdentifier];
            str_from_nsstring(ns_str)
        }
    }

    pub fn localized_name(&self) -> Option<String> {
        unsafe {
            let ns_str: *mut Object = msg_send![self.obj, localizedName];
            str_from_nsstring(ns_str)
        }
    }

    pub fn activation_policy(&self) -> isize {
        unsafe { msg_send![self.obj, activationPolicy] }
    }

    pub fn is_terminated(&self) -> bool {
        unsafe { msg_send![self.obj, isTerminated] }
    }

    pub fn process_identifier(&self) -> i32 {
        unsafe { msg_send![self.obj, processIdentifier] }
    }

    pub fn bundle_url(&self) -> Option<*mut Object> {
        unsafe {
            let url: *mut Object = msg_send![self.obj, bundleURL];
            if url.is_null() {
                None
            } else {
                Some(url)
            }
        }
    }

    pub fn executable_url(&self) -> Option<*mut Object> {
        unsafe {
            let url: *mut Object = msg_send![self.obj, executableURL];
            if url.is_null() {
                None
            } else {
                Some(url)
            }
        }
    }

    pub fn activate(&self, options: usize) -> bool {
        unsafe { msg_send![self.obj, activateWithOptions: options] }
    }
}

pub struct Workspace;

impl Workspace {
    pub fn running_applications() -> Vec<RunningApp> {
        unsafe {
            let ws: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
            let array: *mut Object = msg_send![ws, runningApplications];
            let count: usize = msg_send![array, count];
            let mut list = Vec::with_capacity(count);
            for i in 0..count {
                let item: *mut Object = msg_send![array, objectAtIndex: i];
                list.push(RunningApp { obj: item });
            }
            list
        }
    }

    pub fn frontmost_application() -> Option<RunningApp> {
        unsafe {
            let ws: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
            let obj: *mut Object = msg_send![ws, frontmostApplication];
            if obj.is_null() {
                None
            } else {
                Some(RunningApp { obj })
            }
        }
    }

    pub fn url_for_application(bundle_id: &str) -> Option<*mut Object> {
        unsafe {
            let ws: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
            let ns_bundle = nsstring_from_str(bundle_id);
            let url: *mut Object = msg_send![ws, URLForApplicationWithBundleIdentifier: ns_bundle];
            if url.is_null() {
                None
            } else {
                Some(url)
            }
        }
    }

    pub fn urls_for_applications(bundle_id: &str) -> Vec<*mut Object> {
        unsafe {
            let ws: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
            let ns_bundle = nsstring_from_str(bundle_id);
            let array: *mut Object =
                msg_send![ws, URLsForApplicationsWithBundleIdentifier: ns_bundle];
            if array.is_null() {
                return Vec::new();
            }
            let count: usize = msg_send![array, count];
            let mut list = Vec::with_capacity(count);
            for i in 0..count {
                let item: *mut Object = msg_send![array, objectAtIndex: i];
                list.push(item);
            }
            list
        }
    }

    pub fn open_application_at_url(url: *mut Object) -> bool {
        unsafe {
            let ws: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
            let ok: bool = msg_send![ws, openURL: url];
            ok
        }
    }
}
