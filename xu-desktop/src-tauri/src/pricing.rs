//! Model pricing manifest (CNY reference rates). Not vendor invoices.

use chrono::{FixedOffset, Timelike, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::desktop_db::{setting_get, setting_set};

pub const PRICING_MANIFEST_SETTING: &str = "pricing.manifest_json";
pub const PRICING_LAST_SYNC_SETTING: &str = "pricing.last_sync_at";
pub const PRICING_MANIFEST_URL_SETTING: &str = "pricing.manifest_url";
pub const PRICING_SYNC_INTERVAL_MS: i64 = 3 * 24 * 60 * 60 * 1000;

const DEFAULT_MANIFEST_JSON: &str = include_str!("../resources/model-pricing.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PricingTierRates {
    pub input_per_m_tok_cny: f64,
    pub output_per_m_tok_cny: f64,
    #[serde(default)]
    pub cache_read_per_m_tok_cny: Option<f64>,
    /// Local hours range e.g. "09:00-23:00"
    #[serde(default)]
    pub hours_local: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetPricing {
    pub input_per_m_tok_cny: f64,
    pub output_per_m_tok_cny: f64,
    #[serde(default)]
    pub cache_read_per_m_tok_cny: Option<f64>,
    #[serde(default)]
    pub peak: Option<PricingTierRates>,
    #[serde(default)]
    pub off_peak: Option<PricingTierRates>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PricingManifest {
    pub version: u32,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub presets: HashMap<String, PresetPricing>,
}

impl Default for PricingManifest {
    fn default() -> Self {
        serde_json::from_str(DEFAULT_MANIFEST_JSON).unwrap_or_else(|_| Self {
            version: 1,
            updated_at: String::new(),
            presets: HashMap::new(),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PricingTier {
    Default,
    Peak,
    OffPeak,
}

impl PricingTier {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Peak => "peak",
            Self::OffPeak => "off_peak",
        }
    }
}

pub fn load_pricing_manifest(conn: &Connection) -> Result<PricingManifest, String> {
    if let Some(raw) = setting_get(conn, PRICING_MANIFEST_SETTING)? {
        if let Ok(m) = serde_json::from_str::<PricingManifest>(&raw) {
            return Ok(m);
        }
    }
    Ok(PricingManifest::default())
}

pub fn save_pricing_manifest(conn: &Connection, manifest: &PricingManifest) -> Result<(), String> {
    let raw = serde_json::to_string(manifest).map_err(|e| e.to_string())?;
    setting_set(conn, PRICING_MANIFEST_SETTING, &raw)?;
    setting_set(
        conn,
        PRICING_LAST_SYNC_SETTING,
        &Utc::now().timestamp_millis().to_string(),
    )?;
    Ok(())
}

pub fn parse_pricing_manifest_json(text: &str) -> Result<PricingManifest, String> {
    serde_json::from_str(text).map_err(|e| format!("价格 JSON 无效: {e}"))
}

pub fn pricing_sync_due(conn: &Connection) -> bool {
    let last: i64 = setting_get(conn, PRICING_LAST_SYNC_SETTING)
        .ok()
        .flatten()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let now = Utc::now().timestamp_millis();
    now - last >= PRICING_SYNC_INTERVAL_MS
}

fn parse_hour(h: &str) -> Option<u32> {
    let parts: Vec<&str> = h.split(':').collect();
    if parts.len() < 2 {
        return None;
    }
    let hr: u32 = parts[0].parse().ok()?;
    let min: u32 = parts[1].parse().ok()?;
    Some(hr * 60 + min)
}

fn minutes_in_range(now_min: u32, range: &str) -> bool {
    let parts: Vec<&str> = range.split('-').collect();
    if parts.len() != 2 {
        return false;
    }
    let Some(start) = parse_hour(parts[0].trim()) else {
        return false;
    };
    let Some(end) = parse_hour(parts[1].trim()) else {
        return false;
    };
    if start <= end {
        now_min >= start && now_min < end
    } else {
        now_min >= start || now_min < end
    }
}

fn pick_tier(preset: &PresetPricing, ts_ms: i64) -> (PricingTier, &PresetPricing) {
    let tz = FixedOffset::east_opt(8 * 3600).unwrap();
    let dt = chrono::DateTime::<Utc>::from_timestamp_millis(ts_ms)
        .unwrap_or_else(Utc::now)
        .with_timezone(&tz);
    let now_min = dt.hour() * 60 + dt.minute();

    if let Some(peak) = preset.peak.as_ref() {
        if let Some(hours) = peak.hours_local.as_deref() {
            if minutes_in_range(now_min, hours) {
                return (PricingTier::Peak, preset);
            }
        }
    }
    if let Some(off) = preset.off_peak.as_ref() {
        if let Some(hours) = off.hours_local.as_deref() {
            if minutes_in_range(now_min, hours) {
                return (PricingTier::OffPeak, preset);
            }
        }
    }
    (PricingTier::Default, preset)
}

fn tier_rates(preset: &PresetPricing, tier: PricingTier) -> (f64, f64, f64) {
    let rates = match tier {
        PricingTier::Peak => preset.peak.as_ref(),
        PricingTier::OffPeak => preset.off_peak.as_ref(),
        PricingTier::Default => None,
    };
    if let Some(r) = rates {
        let cache = r
            .cache_read_per_m_tok_cny
            .unwrap_or(r.input_per_m_tok_cny * 0.1);
        return (r.input_per_m_tok_cny, r.output_per_m_tok_cny, cache);
    }
    let cache = preset
        .cache_read_per_m_tok_cny
        .unwrap_or(preset.input_per_m_tok_cny * 0.1);
    (
        preset.input_per_m_tok_cny,
        preset.output_per_m_tok_cny,
        cache,
    )
}

/// Returns (cost_cny_micros, pricing_tier).
pub fn compute_cost_cny_micros(
    conn: &Connection,
    preset_id: &str,
    prompt_tokens: u64,
    completion_tokens: u64,
    cached_tokens: u64,
    ts_ms: i64,
) -> (i64, PricingTier) {
    let manifest = load_pricing_manifest(conn).unwrap_or_default();
    let key = preset_id.trim();
    let lookup_key = if key.is_empty() { "local" } else { key };
    let Some(preset) = manifest.presets.get(lookup_key) else {
        // Try match by model id substring in presets — fallback zero cost
        return (0, PricingTier::Default);
    };

    let (tier, _) = pick_tier(preset, ts_ms);
    let (input_rate, output_rate, cache_rate) = tier_rates(preset, tier);

    let cached = cached_tokens.min(prompt_tokens);
    let uncached_in = prompt_tokens.saturating_sub(cached);
    let cost_yuan = (uncached_in as f64 / 1_000_000.0) * input_rate
        + (cached as f64 / 1_000_000.0) * cache_rate
        + (completion_tokens as f64 / 1_000_000.0) * output_rate;
    let micros = (cost_yuan * 1_000_000.0).round() as i64;
    (micros, tier)
}
