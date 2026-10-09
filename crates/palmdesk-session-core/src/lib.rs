use std::fs::File;
use std::path::Path;

use memmap2::Mmap;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use sha2::{Digest, Sha256};

const MAX_SESSION_FILE_BYTES: u64 = 32 * 1024 * 1024;

#[napi]
pub fn session_core_version() -> String {
    "palmdesk-session-core-v0.1.0".to_string()
}

#[napi]
pub fn hash_sha256(input: String) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

#[napi]
pub fn read_session_text_sync(file_path: String, max_bytes: Option<u32>) -> Result<String> {
    let limit = max_bytes.map(|v| v as u64).unwrap_or(MAX_SESSION_FILE_BYTES);
    let path = Path::new(&file_path);
    let file = File::open(path).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    let metadata = file
        .metadata()
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

    if metadata.len() > limit {
        return Err(Error::new(
            Status::GenericFailure,
            "会话日志超过 32 MiB，请在原窗口查看".to_string(),
        ));
    }

    if metadata.len() == 0 {
        return Ok(String::new());
    }

    let mmap = unsafe {
        Mmap::map(&file).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?
    };

    if mmap.len() as u64 > limit {
        return Err(Error::new(
            Status::GenericFailure,
            "会话日志超过 32 MiB，请在原窗口查看".to_string(),
        ));
    }

    let s = std::str::from_utf8(&mmap)
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    Ok(s.to_string())
}

#[napi]
pub fn read_session_lines_sync(
    file_path: String,
    max_bytes: Option<u32>,
) -> Result<Vec<String>> {
    let limit = max_bytes.map(|v| v as u64).unwrap_or(MAX_SESSION_FILE_BYTES);
    let path = Path::new(&file_path);
    let file = File::open(path).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    let metadata = file
        .metadata()
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

    if metadata.len() > limit {
        return Err(Error::new(
            Status::GenericFailure,
            "会话日志超过 32 MiB，请在原窗口查看".to_string(),
        ));
    }

    if metadata.len() == 0 {
        return Ok(Vec::new());
    }

    let mmap = unsafe {
        Mmap::map(&file).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?
    };

    if mmap.len() as u64 > limit {
        return Err(Error::new(
            Status::GenericFailure,
            "会话日志超过 32 MiB，请在原窗口查看".to_string(),
        ));
    }

    let content = std::str::from_utf8(&mmap)
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

    let lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    Ok(lines)
}
