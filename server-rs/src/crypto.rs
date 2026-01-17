use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::Engine as _;
use std::path::{Path, PathBuf};

pub fn encrypt_to_base64(key: &[u8; 32], plaintext: &[u8]) -> anyhow::Result<String> {
    let cipher = Aes256Gcm::new_from_slice(key)?;
    let nonce_bytes = aes_gcm::aead::rand_core::RngCore::next_u64(&mut OsRng).to_le_bytes();
    let mut nonce_full = [0u8; 12];
    nonce_full[..8].copy_from_slice(&nonce_bytes);
    aes_gcm::aead::rand_core::RngCore::fill_bytes(&mut OsRng, &mut nonce_full[8..]);

    let nonce = Nonce::from_slice(&nonce_full);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| anyhow::anyhow!("encrypt failed"))?;

    let mut out = Vec::with_capacity(12 + ciphertext.len());
    out.extend_from_slice(&nonce_full);
    out.extend_from_slice(&ciphertext);
    Ok(base64::engine::general_purpose::STANDARD.encode(out))
}

pub fn decrypt_from_base64(key: &[u8; 32], b64: &str) -> anyhow::Result<Vec<u8>> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64)?;
    if bytes.len() < 12 {
        return Err(anyhow::anyhow!("ciphertext too short"));
    }
    let (nonce_bytes, ciphertext) = bytes.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    let cipher = Aes256Gcm::new_from_slice(key)?;
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| anyhow::anyhow!("decrypt failed"))
}

pub fn load_data_key_from_env() -> anyhow::Result<[u8; 32]> {
    let key_b64 = std::env::var("DATA_KEY")
        .map_err(|_| anyhow::anyhow!("missing DATA_KEY (base64 32-bytes key)"))?;
    let key_bytes = base64::engine::general_purpose::STANDARD.decode(key_b64.trim())?;
    if key_bytes.len() != 32 {
        return Err(anyhow::anyhow!("DATA_KEY must decode to 32 bytes"));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&key_bytes);
    Ok(key)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataKeySource {
    Env,
    File,
    Generated,
}

pub fn load_or_init_data_key(data_dir: &Path) -> anyhow::Result<([u8; 32], DataKeySource)> {
    if let Ok(key) = load_data_key_from_env() {
        return Ok((key, DataKeySource::Env));
    }

    let key_path = data_key_path(data_dir);
    if let Ok(text) = std::fs::read_to_string(&key_path) {
        let key_b64 = text.trim();
        let key_bytes = base64::engine::general_purpose::STANDARD.decode(key_b64)?;
        if key_bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&key_bytes);
            return Ok((key, DataKeySource::File));
        }
    }

    std::fs::create_dir_all(data_dir)?;
    let mut key = [0u8; 32];
    aes_gcm::aead::rand_core::RngCore::fill_bytes(&mut OsRng, &mut key);
    let key_b64 = base64::engine::general_purpose::STANDARD.encode(key);
    write_atomic_string(&key_path, &key_b64)?;
    Ok((key, DataKeySource::Generated))
}

fn data_key_path(data_dir: &Path) -> PathBuf {
    data_dir.join(".data_key")
}

fn write_atomic_string(path: &Path, text: &str) -> anyhow::Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, text.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}
