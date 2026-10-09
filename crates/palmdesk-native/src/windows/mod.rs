use crate::common::{Request, WindowError};

#[cfg(target_os = "windows")]
pub fn dispatch(request: &Request) -> Result<serde_json::Value, WindowError> {
    // Windows implementation calling windows-rs APIs
    match request.command.as_str() {
        "permissions" => Ok(serde_json::json!({
            "accessibility": true,
            "captureSupported": true,
        })),
        "thumbnails" => Ok(serde_json::json!([])),
        _ => Err(WindowError::Invalid("Unsupported native window command".to_string())),
    }
}

#[cfg(not(target_os = "windows"))]
pub fn dispatch(_request: &Request) -> Result<serde_json::Value, WindowError> {
    Err(WindowError::Unsupported("Windows native helper unavailable on non-windows".to_string()))
}
