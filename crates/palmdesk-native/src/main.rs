#![allow(unexpected_cfgs)]

use std::io::{self, BufRead, Write};

mod common;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod stub {
    use crate::common::{Request, WindowError};
    pub fn dispatch(_request: &Request) -> Result<serde_json::Value, WindowError> {
        Err(WindowError::Unsupported("Current platform unsupported".to_string()))
    }
}

use common::{Request, Response};

fn main() {
    #[cfg(target_os = "macos")]
    {
        macos::appkit::set_activation_policy_prohibited();
    }

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut handle = stdout.lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        if line.trim().is_empty() {
            continue;
        }

        let request: Result<Request, _> = serde_json::from_str(&line);
        let response = match request {
            Ok(req) => {
                let req_id = req.request_id.clone();
                #[cfg(target_os = "macos")]
                let result = macos::dispatch(&req);

                #[cfg(target_os = "windows")]
                let result = windows::dispatch(&req);

                #[cfg(not(any(target_os = "macos", target_os = "windows")))]
                let result = stub::dispatch(&req);

                match result {
                    Ok(data) => Response {
                        request_id: req_id,
                        data: Some(data),
                        error: None,
                        error_code: None,
                    },
                    Err(err) => Response {
                        request_id: req_id,
                        data: None,
                        error: Some(err.message().to_string()),
                        error_code: Some(err.code().to_string()),
                    },
                }
            }
            Err(_) => Response {
                request_id: None,
                data: None,
                error: Some("Invalid native window request".to_string()),
                error_code: Some("invalid".to_string()),
            },
        };

        if let Ok(json_str) = serde_json::to_string(&response) {
            let _ = writeln!(handle, "{}", json_str);
            let _ = handle.flush();
        }
    }
}
