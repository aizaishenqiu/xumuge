//! Product brand strings (user-facing). Official identity lives here — Vue only displays it.

use serde::Serialize;

pub const BRAND_NAME_ZH: &str = "虚募阁";
pub const BRAND_NAME: &str = "虚募阁";
pub const BRAND_NAME_EN: &str = "Virmoor";
pub const COPYRIGHT_HOLDER: &str = "玖咖科技";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIdentity {
    pub product_name: String,
    pub product_name_en: String,
    pub version: String,
    pub copyright_holder: String,
}

#[tauri::command]
pub fn xu_app_identity() -> AppIdentity {
    AppIdentity {
        product_name: BRAND_NAME_ZH.to_string(),
        product_name_en: BRAND_NAME_EN.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        copyright_holder: COPYRIGHT_HOLDER.to_string(),
    }
}
