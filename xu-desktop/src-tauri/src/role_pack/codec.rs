use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const XUPACK_MAGIC: &[u8; 8] = b"XUPACK\x01\x00";
pub const XUPACK_VERSION: u8 = 1;
pub const XUPACK_FLAG_DEMO: u8 = 1;

/// Demo key — matches `scripts/lib/xupack.mjs` DEMO_PACK_KEY.
pub fn demo_pack_key() -> [u8; 32] {
    let digest = Sha256::digest(b"xu-virmoor-demo-role-pack-v1");
    let mut key = [0u8; 32];
    key.copy_from_slice(&digest);
    key
}

pub fn derive_commercial_key(pack_id: &str, license_id: &str) -> [u8; 32] {
    use hkdf::Hkdf;
    let hk = Hkdf::<Sha256>::new(None, &demo_pack_key());
    let mut okm = [0u8; 32];
    let info = format!("{pack_id}:{license_id}");
    hk.expand(info.as_bytes(), &mut okm).expect("hkdf expand");
    okm
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XupackHeader {
    pub locale: String,
    pub version: u32,
    #[serde(rename = "packId")]
    pub pack_id: String,
    #[serde(rename = "builtAt")]
    pub built_at: Option<String>,
    #[serde(rename = "roleCount")]
    pub role_count: Option<u32>,
    #[serde(rename = "contentVersion", default)]
    pub content_version: Option<String>,
    #[serde(default)]
    pub demo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XupackRole {
    pub id: String,
    pub slug: String,
    #[serde(default)]
    pub name: String,
    #[serde(rename = "nameZh")]
    pub name_zh: String,
    #[serde(default)]
    pub emoji: String,
    pub division: String,
    #[serde(rename = "divisionZh", default)]
    pub division_zh: String,
    #[serde(default)]
    pub description: String,
    #[serde(rename = "roleKind", default)]
    pub role_kind: String,
    #[serde(rename = "brainSlot", default)]
    pub brain_slot: String,
    /// Comma-separated server.tool allowlist, or "*"
    #[serde(rename = "mcpTools", default)]
    pub mcp_tools: String,
    #[serde(rename = "kickoffWave", default)]
    pub kickoff_wave: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub source: String,
    #[serde(
        rename = "industryId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub industry_id: Option<String>,
    #[serde(
        rename = "industryZh",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub industry_zh: Option<String>,
    #[serde(
        rename = "positionId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub position_id: Option<String>,
    #[serde(
        rename = "positionZh",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub position_zh: Option<String>,
    #[serde(
        rename = "positionCategory",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub position_category: Option<String>,
    #[serde(
        rename = "positionCategoryZh",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub position_category_zh: Option<String>,
    #[serde(rename = "bodyMd", default)]
    pub body_md: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XupackPayload {
    pub header: XupackHeader,
    pub roles: Vec<XupackRole>,
}

pub fn decode_xupack(data: &[u8], key: &[u8; 32]) -> Result<(XupackPayload, u8), String> {
    if data.len() < 8 + 1 + 1 + 32 + 12 + 16 {
        return Err("xupack too small".into());
    }
    if &data[0..8] != XUPACK_MAGIC {
        return Err("invalid xupack magic".into());
    }
    let version = data[8];
    if version != XUPACK_VERSION {
        return Err(format!("unsupported xupack version {version}"));
    }
    let flags = data[9];
    let expected_sha = &data[10..42];
    let nonce_bytes = &data[42..54];
    let tag_start = data.len() - 16;
    let ciphertext = &data[54..tag_start];
    let tag = &data[tag_start..];

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let mut ct = ciphertext.to_vec();
    ct.extend_from_slice(tag);
    let plaintext = cipher
        .decrypt(nonce, ct.as_ref())
        .map_err(|_| "xupack decrypt failed (wrong key or corrupt file)".to_string())?;

    let actual_sha = Sha256::digest(&plaintext);
    if actual_sha.as_slice() != expected_sha {
        return Err("xupack sha256 mismatch".into());
    }

    let payload: XupackPayload =
        serde_json::from_slice(&plaintext).map_err(|e| format!("xupack json invalid: {e}"))?;
    Ok((payload, flags))
}

pub fn try_decode_with_keys(
    data: &[u8],
    keys: &[[u8; 32]],
) -> Result<(XupackPayload, u8), String> {
    let mut last_err = String::from("no keys");
    for key in keys {
        match decode_xupack(data, key) {
            Ok(v) => return Ok(v),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

pub fn parse_key_hex(hex: &str) -> Result<[u8; 32], String> {
    let s = hex.trim().trim_start_matches("0x");
    let bytes = hex::decode(s).map_err(|e| format!("invalid key hex: {e}"))?;
    if bytes.len() != 32 {
        return Err(format!("key must be 32 bytes, got {}", bytes.len()));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}
