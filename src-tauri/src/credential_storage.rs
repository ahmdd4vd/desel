//! Windows current-user DPAPI storage. No machine-wide decrypt flag, no UI.
#[cfg(windows)]
pub fn protect(bytes: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    if bytes.len() > 1024 * 1024 {
        return Err("Credential payload too large".into());
    }
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let entropy = b"Desel own-client credentials v1";
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: entropy.len() as u32,
        pbData: entropy.as_ptr() as *mut u8,
    };
    let ok = unsafe {
        if decrypt {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                &entropy,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptProtectData(
                &input,
                std::ptr::null(),
                &entropy,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if ok == 0 {
        return Err("Windows user credential protection failed".into());
    }
    let result = if output.cbData > 1024 * 1024 || output.pbData.is_null() {
        Err("Invalid Windows protected credential payload".into())
    } else {
        Ok(unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec())
    };
    unsafe {
        if !output.pbData.is_null() {
            std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
            LocalFree(output.pbData as *mut core::ffi::c_void);
        }
    }
    result
}
#[cfg(windows)]
pub fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use std::{io::Write, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let protected = protect(bytes, false)?;
    let parent = path.parent().ok_or("Invalid credential directory")?;
    std::fs::create_dir_all(parent).map_err(|_| "Cannot create credential directory")?;
    if std::fs::symlink_metadata(parent)
        .map_err(|_| "Cannot inspect credential directory")?
        .file_type()
        .is_symlink()
    {
        return Err("Credential directory cannot be a link".into());
    }
    let tmp = parent.join(format!(".credentials-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|_| "Cannot create encrypted credentials")?;
        f.write_all(&protected)
            .and_then(|_| f.sync_all())
            .map_err(|_| "Cannot write encrypted credentials")?;
        drop(f);
        let from: Vec<u16> = tmp.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err("Cannot atomically replace encrypted credentials".into());
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(tmp);
    }
    result
}
#[cfg(windows)]
pub fn read(path: &std::path::Path) -> Result<Vec<u8>, String> {
    let m = std::fs::symlink_metadata(path).map_err(|_| "Cannot inspect encrypted credentials")?;
    if !m.is_file() || m.file_type().is_symlink() || m.len() > 1024 * 1024 {
        return Err("Invalid encrypted credential file".into());
    }
    protect(
        &std::fs::read(path).map_err(|_| "Cannot read encrypted credentials")?,
        true,
    )
}
#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn current_user_roundtrip_tamper_and_atomic_replace() {
        let plain = b"desel-local-fake-credential";
        let sealed = protect(plain, false).unwrap();
        assert_ne!(sealed, plain);
        assert_eq!(protect(&sealed, true).unwrap(), plain);
        let mut changed = sealed;
        changed[20] ^= 1;
        assert!(protect(&changed, true).is_err());
        let root = std::env::temp_dir().join(format!("desel-dpapi-{}", uuid::Uuid::new_v4()));
        let p = root.join("credential");
        atomic_write(&p, plain).unwrap();
        atomic_write(&p, b"rotated-local-fake").unwrap();
        assert_eq!(read(&p).unwrap(), b"rotated-local-fake");
        assert!(!std::fs::read(&p)
            .unwrap()
            .windows(plain.len())
            .any(|w| w == plain));
        let _ = std::fs::remove_dir_all(root);
    }
}
