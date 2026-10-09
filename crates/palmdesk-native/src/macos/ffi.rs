#![allow(non_upper_case_globals, dead_code)]

use std::ffi::c_void;

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct CGPoint {
    pub x: f64,
    pub y: f64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct CGSize {
    pub width: f64,
    pub height: f64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct CGRect {
    pub origin: CGPoint,
    pub size: CGSize,
}

pub type CFTypeRef = *const c_void;
pub type CFStringRef = *const c_void;
pub type CFArrayRef = *const c_void;
pub type CFDictionaryRef = *const c_void;
pub type CFBooleanRef = *const c_void;
pub type CFNumberRef = *const c_void;
pub type CFIndex = isize;
pub type AXUIElementRef = *const c_void;
pub type AXValueRef = *const c_void;
pub type AXError = i32;

pub const kAXErrorSuccess: AXError = 0;

pub const kCGWindowListOptionAll: u32 = 0;
pub const kCGWindowListOptionIncludingWindow: u32 = 8;
pub const kCGWindowListExcludeDesktopElements: u32 = 16;
pub const kCGNullWindowID: u32 = 0;
pub const kCFStringEncodingUTF8: u32 = 0x08000100;

pub const kAXValueTypeCGPoint: u32 = 1;
pub const kAXValueTypeCGSize: u32 = 2;

#[link(name = "AppKit", kind = "framework")]
#[link(name = "Foundation", kind = "framework")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    pub fn CGWindowListCopyWindowInfo(option: u32, relativeToWindow: u32) -> CFArrayRef;
    pub fn CGPreflightScreenCaptureAccess() -> bool;
    pub fn CGRectMakeWithDictionaryRepresentation(dict: CFDictionaryRef, rect: *mut CGRect) -> bool;
    pub fn CGDisplayCreateUUIDFromDisplayID(displayID: u32) -> *const c_void;
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    pub fn AXIsProcessTrusted() -> bool;
    pub fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    pub fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    pub fn AXUIElementSetAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: CFTypeRef,
    ) -> AXError;
    pub fn AXUIElementPerformAction(element: AXUIElementRef, action: CFStringRef) -> AXError;
    pub fn AXUIElementSetMessagingTimeout(element: AXUIElementRef, timeoutInSeconds: f32) -> AXError;
    pub fn AXValueGetTypeID() -> usize;
    pub fn AXValueGetValue(value: AXValueRef, theType: u32, valuePtr: *mut c_void) -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    pub fn CFRelease(cf: CFTypeRef);
    pub fn CFRetain(cf: CFTypeRef) -> CFTypeRef;
    pub fn CFGetTypeID(cf: CFTypeRef) -> usize;
    pub fn CFEqual(cf1: CFTypeRef, cf2: CFTypeRef) -> bool;
    pub fn CFArrayGetCount(theArray: CFArrayRef) -> CFIndex;
    pub fn CFArrayGetValueAtIndex(theArray: CFArrayRef, idx: CFIndex) -> *const c_void;
    pub fn CFDictionaryGetValue(theDict: CFDictionaryRef, key: *const c_void) -> *const c_void;
    pub fn CFStringCreateWithCString(
        alloc: *const c_void,
        cStr: *const std::os::raw::c_char,
        encoding: u32,
    ) -> CFStringRef;
    pub fn CFStringGetLength(theString: CFStringRef) -> CFIndex;
    pub fn CFStringGetCString(
        theString: CFStringRef,
        buffer: *mut std::os::raw::c_char,
        bufferSize: CFIndex,
        encoding: u32,
    ) -> bool;
    pub fn CFBooleanGetValue(boolean: CFBooleanRef) -> bool;
    pub static kCFBooleanTrue: CFBooleanRef;
    pub static kCFBooleanFalse: CFBooleanRef;
    pub fn CFNumberGetValue(number: CFNumberRef, theType: i32, valuePtr: *mut c_void) -> bool;
    pub fn CFUUIDCreateString(alloc: *const c_void, uuid: *const c_void) -> CFStringRef;
}
