//! OpenAI-compatible embeddings API (local Ollama / remote).

use serde::Deserialize;
use tauri::{AppHandle, Manager};

#[derive(Deserialize)]
struct EmbedResponse {
    data: Vec<EmbedData>,
}

#[derive(Deserialize)]
struct EmbedData {
    embedding: Vec<f32>,
}

fn resolve_api_key(app: &AppHandle, api_key_env: &str) -> Result<String, String> {
    let db = app.state::<crate::desktop_db::FouDb>();
    let conn = db.0.lock().map_err(|e| format!("db lock: {e}"))?;
    crate::desktop_db::resolve_api_key(api_key_env, Some(&*conn))
}

#[tauri::command]
pub async fn xu_embed_texts(
    app: AppHandle,
    base_url: String,
    model: String,
    api_key_env: String,
    texts: Vec<String>,
) -> Result<Vec<Vec<f32>>, String> {
    let inputs: Vec<String> = texts
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .take(32)
        .collect();
    if inputs.is_empty() {
        return Err("无有效文本".into());
    }

    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("baseUrl 为空".into());
    }
    let model = model.trim();
    if model.is_empty() {
        return Err("embedding model 为空".into());
    }

    let api_key = resolve_api_key(&app, api_key_env.trim())?;
    let url = format!("{base}/embeddings");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let body = serde_json::json!({
        "model": model,
        "input": inputs,
    });

    let mut req = client.post(&url).json(&body);
    if !api_key.is_empty() {
        req = req.bearer_auth(api_key);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("embeddings 请求失败: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("embeddings HTTP {status}: {text}"));
    }

    let parsed: EmbedResponse = resp
        .json()
        .await
        .map_err(|e| format!("embeddings 解析失败: {e}"))?;
    if parsed.data.len() != inputs.len() {
        return Err(format!(
            "embeddings 数量不匹配: 期望 {} 得到 {}",
            inputs.len(),
            parsed.data.len()
        ));
    }
    Ok(parsed.data.into_iter().map(|d| d.embedding).collect())
}
