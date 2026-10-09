#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetWindow {
    pub native_id: u64,
    pub owner_pid: i32,
    pub bundle_id: String,
    pub app_name: String,
    pub name: String,
    #[serde(default)]
    pub title: String,
    pub is_on_screen: bool,
    pub bounds: Bounds,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowIdentity {
    pub native_id: u64,
    pub owner_pid: i32,
    pub bundle_id: String,
}

impl TargetWindow {
    pub fn identity(&self) -> WindowIdentity {
        WindowIdentity {
            native_id: self.native_id,
            owner_pid: self.owner_pid,
            bundle_id: self.bundle_id.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowThumbnail {
    pub native_id: u64,
    pub owner_pid: i32,
    pub bundle_id: String,
    pub thumbnail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeApplication {
    pub owner_pid: i32,
    pub bundle_id: String,
    pub app_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub request_id: Option<serde_json::Value>,
    pub command: String,
    #[serde(flatten)]
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub request_id: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug)]
pub enum WindowError {
    Unavailable(String),
    Permission(String),
    Ambiguous(String),
    Focus(String),
    Space(String),
    SpaceUnsupported(String),
    SpaceUnknown(String),
    SpaceDisplay(String),
    SpaceControls(String),
    Invalid(String),
    ApplicationUnavailable(String),
    LaunchFailed(String),
    Unsupported(String),
    Gone(String),
    InputBusy(String),
    PasteUnconfirmed(String),
    Other(String, String),
}

impl WindowError {
    pub fn code(&self) -> &str {
        match self {
            WindowError::Unavailable(_) => "unavailable",
            WindowError::Permission(_) => "permission",
            WindowError::Ambiguous(_) => "ambiguous",
            WindowError::Focus(_) => "focus",
            WindowError::Space(_) => "space",
            WindowError::SpaceUnsupported(_) => "spaceUnsupported",
            WindowError::SpaceUnknown(_) => "spaceUnknown",
            WindowError::SpaceDisplay(_) => "spaceDisplay",
            WindowError::SpaceControls(_) => "spaceControls",
            WindowError::Invalid(_) => "invalid",
            WindowError::ApplicationUnavailable(_) => "applicationUnavailable",
            WindowError::LaunchFailed(_) => "launchFailed",
            WindowError::Unsupported(_) => "unsupported",
            WindowError::Gone(_) => "gone",
            WindowError::InputBusy(_) => "input_busy",
            WindowError::PasteUnconfirmed(_) => "paste_unconfirmed",
            WindowError::Other(code, _) => code.as_str(),
        }
    }

    pub fn message(&self) -> &str {
        match self {
            WindowError::Unavailable(msg)
            | WindowError::Permission(msg)
            | WindowError::Ambiguous(msg)
            | WindowError::Focus(msg)
            | WindowError::Space(msg)
            | WindowError::SpaceUnsupported(msg)
            | WindowError::SpaceUnknown(msg)
            | WindowError::SpaceDisplay(msg)
            | WindowError::SpaceControls(msg)
            | WindowError::Invalid(msg)
            | WindowError::ApplicationUnavailable(msg)
            | WindowError::LaunchFailed(msg)
            | WindowError::Unsupported(msg)
            | WindowError::Gone(msg)
            | WindowError::InputBusy(msg)
            | WindowError::PasteUnconfirmed(msg)
            | WindowError::Other(_, msg) => msg.as_str(),
        }
    }
}

impl std::fmt::Display for WindowError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code(), self.message())
    }
}

impl std::error::Error for WindowError {}
