//! 聊天附件的安全校验、持久化与受限文本提取。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @version 1.1.0
//! @category Stream
//! @algo bounded-copy-sqlite-immediate-atomic-rename

use crate::desktop_db::FouDb;
use base64::Engine;
use rusqlite::TransactionBehavior;
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use tauri::State;
use uuid::Uuid;
use zip::ZipArchive;

const MAX_FILES: usize = 10;
const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 50 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 1_000;
const MAX_ARCHIVE_EXPANDED: u64 = 100 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 100;
const MAX_TEXT_TOKENS: u64 = 12_000;
const MAX_TEXT_CHARS: usize = 48_000;
const MAX_TEXT_READ_BYTES: u64 = (MAX_TEXT_CHARS as u64) * 4 + 4;
const PENDING_TTL_MS: i64 = 7 * 24 * 60 * 60 * 1_000;

const TEXT_EXTENSIONS: &[&str] = &[
    "txt",
    "md",
    "markdown",
    "csv",
    "json",
    "jsonl",
    "yaml",
    "yml",
    "xml",
    "log",
    "html",
    "htm",
    "css",
    "scss",
    "sass",
    "less",
    "svg",
    "webmanifest",
    "js",
    "mjs",
    "cjs",
    "jsx",
    "ts",
    "mts",
    "cts",
    "tsx",
    "vue",
    "svelte",
    "py",
    "pyw",
    "rs",
    "go",
    "java",
    "kt",
    "kts",
    "c",
    "h",
    "cc",
    "cpp",
    "cxx",
    "hpp",
    "cs",
    "php",
    "rb",
    "swift",
    "scala",
    "sh",
    "bash",
    "zsh",
    "fish",
    "ps1",
    "bat",
    "cmd",
    "sql",
    "toml",
    "ini",
    "conf",
    "cfg",
    "env",
    "properties",
];
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const AUDIO_EXTENSIONS: &[&str] = &["mp3", "wav", "ogg", "oga", "flac", "m4a", "aac"];
const OOXML_EXTENSIONS: &[&str] = &["docx", "xlsx", "pptx"];
const ODF_EXTENSIONS: &[&str] = &["odt", "ods", "odp"];
const LEGACY_OFFICE_EXTENSIONS: &[&str] = &["doc", "xls", "ppt"];

fn validate_size_limits(existing_bytes: u64, sizes: &[u64]) -> Result<(), String> {
    let mut total = existing_bytes;
    for size in sizes {
        if *size > MAX_FILE_BYTES {
            return Err("附件超过单文件 25 MB 限制".into());
        }
        total = total.saturating_add(*size);
        if total > MAX_TOTAL_BYTES {
            return Err("附件总大小超过 50 MB 限制".into());
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAttachment {
    pub id: String,
    pub session_id: String,
    pub message_id: Option<String>,
    pub filename: String,
    pub stored_path: String,
    pub mime: String,
    pub kind: String,
    pub size_bytes: u64,
    pub extracted_text: String,
    pub extraction_status: String,
    pub warning: Option<String>,
    pub created_at: i64,
}

fn extension(path: &Path) -> Result<String, String> {
    path.extension()
        .and_then(|v| v.to_str())
        .map(|v| v.to_ascii_lowercase())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "附件缺少可识别的扩展名".to_string())
}

fn safe_filename(path: &Path) -> Result<String, String> {
    let name = path
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or_else(|| "附件文件名无效".to_string())?;
    if name.chars().any(|c| c.is_control()) || name == "." || name == ".." {
        return Err("附件文件名包含不安全字符".into());
    }
    Ok(name.chars().take(180).collect())
}

fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(b"BM") {
        Some("image/bmp")
    } else {
        None
    }
}

fn sniff_audio(bytes: &[u8], ext: &str) -> Option<&'static str> {
    if bytes.starts_with(b"ID3") || (bytes.len() > 1 && bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0)
    {
        Some(if ext == "aac" {
            "audio/aac"
        } else {
            "audio/mpeg"
        })
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        Some("audio/wav")
    } else if bytes.starts_with(b"OggS") {
        Some("audio/ogg")
    } else if bytes.starts_with(b"fLaC") {
        Some("audio/flac")
    } else if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        Some("audio/mp4")
    } else {
        None
    }
}

fn decode_text(bytes: &[u8]) -> Result<String, String> {
    if bytes.iter().take(8_192).any(|b| *b == 0) {
        return Err("文件内容看起来是二进制，不能按文本读取".into());
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| "文本不是 UTF-8 编码，请先转换为 UTF-8".into())
}

fn xml_text(xml: &str) -> String {
    let mut out = String::with_capacity(xml.len().min(MAX_TEXT_CHARS));
    let mut in_tag = false;
    for ch in xml.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                if !out.ends_with(' ') && !out.ends_with('\n') {
                    out.push(' ');
                }
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
        if out.len() >= MAX_TEXT_CHARS {
            break;
        }
    }
    out.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn validate_archive<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Result<(), String> {
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(format!("压缩包条目过多（最多 {MAX_ARCHIVE_ENTRIES} 项）"));
    }
    let mut expanded = 0u64;
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| format!("压缩包目录损坏: {e}"))?;
        let name = entry.name();
        let path = Path::new(name);
        if path.is_absolute()
            || path
                .components()
                .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_)))
            || entry.enclosed_name().is_none()
        {
            return Err(format!("压缩包包含不安全路径：{name}"));
        }
        expanded = expanded.saturating_add(entry.size());
        if expanded > MAX_ARCHIVE_EXPANDED {
            return Err("压缩包解压后体积超过 100 MB，已阻止处理".into());
        }
        if entry.size() > 1024 * 1024
            && entry.size()
                > entry
                    .compressed_size()
                    .max(1)
                    .saturating_mul(MAX_COMPRESSION_RATIO)
        {
            return Err(format!("压缩包疑似 zip bomb：{name} 压缩比过高"));
        }
    }
    Ok(())
}

fn extract_archive_text(path: &Path, ext: &str) -> Result<(String, String), String> {
    let file = File::open(path).map_err(|e| format!("无法读取附件: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("文件不是有效压缩包: {e}"))?;
    validate_archive(&mut archive)?;

    if ext == "zip" {
        let mut lines = vec!["压缩包目录（未解压文件内容）：".to_string()];
        for i in 0..archive.len() {
            let entry = archive.by_index(i).map_err(|e| e.to_string())?;
            lines.push(format!("- {} ({} bytes)", entry.name(), entry.size()));
        }
        return Ok((lines.join("\n"), "application/zip".into()));
    }

    let expected_marker = match ext {
        "docx" => "word/document.xml",
        "xlsx" => "xl/workbook.xml",
        "pptx" => "ppt/presentation.xml",
        "odt" | "ods" | "odp" => "content.xml",
        _ => return Err("不支持的压缩文档格式".into()),
    };
    if archive.by_name(expected_marker).is_err() {
        return Err(format!(
            "文件扩展名与内部格式不一致（缺少 {expected_marker}）"
        ));
    }

    let prefixes: &[&str] = match ext {
        "docx" => &["word/document.xml", "docProps/core.xml"],
        "xlsx" => &[
            "xl/sharedStrings.xml",
            "xl/worksheets/",
            "docProps/core.xml",
        ],
        "pptx" => &["ppt/slides/", "ppt/notesSlides/", "docProps/core.xml"],
        _ => &["content.xml", "meta.xml"],
    };
    let mut parts = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() || !prefixes.iter().any(|p| entry.name().starts_with(p)) {
            continue;
        }
        if entry.size() > 8 * 1024 * 1024 {
            return Err(format!("文档内部 XML 过大：{}", entry.name()));
        }
        let mut raw = String::new();
        entry
            .read_to_string(&mut raw)
            .map_err(|_| format!("文档内部 XML 不是有效 UTF-8：{}", entry.name()))?;
        let text = xml_text(&raw);
        if !text.is_empty() {
            parts.push(format!("[来源: {}]\n{text}", entry.name()));
        }
    }
    if parts.is_empty() {
        return Err("文档中没有可提取的文字；可能只包含图片或嵌入对象".into());
    }
    let mime = match ext {
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "odt" => "application/vnd.oasis.opendocument.text",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        _ => "application/vnd.oasis.opendocument.presentation",
    };
    Ok((parts.join("\n\n"), mime.into()))
}

fn limit_text(text: String, max_tokens: u64) -> (String, Option<String>) {
    let mut out = String::new();
    let mut budget_units = 0u64;
    let max_units = max_tokens.saturating_mul(4);
    for ch in text.chars() {
        let next = if ch.is_ascii() { 1 } else { 4 };
        if budget_units.saturating_add(next) > max_units || out.len() >= MAX_TEXT_CHARS {
            return (out, Some("附件文本已按 12,000 token 上限截断".into()));
        }
        budget_units += next;
        out.push(ch);
    }
    (out, None)
}

/// 从已打开的稳定副本读取至硬上限，多读一个字节用于判断截断。
/// 复杂度: O(limit)；失败只返回用户可理解的附件读取错误，不包含本机路径。
fn read_bounded(path: &Path, limit: u64) -> Result<(Vec<u8>, bool), String> {
    let file = File::open(path).map_err(|_| "无法读取附件内容".to_string())?;
    let mut bytes = Vec::with_capacity(limit.min(256 * 1024) as usize);
    file.take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取附件内容".to_string())?;
    let truncated = bytes.len() as u64 > limit;
    if truncated {
        bytes.truncate(limit as usize);
        while std::str::from_utf8(&bytes).is_err() && !bytes.is_empty() {
            bytes.pop();
        }
    }
    Ok((bytes, truncated))
}

fn parse_attachment(
    path: &Path,
    prefix: &[u8],
    ext: &str,
) -> Result<(String, String, String, Option<String>), String> {
    if IMAGE_EXTENSIONS.contains(&ext) {
        let mime = sniff_image(prefix).ok_or_else(|| "图片扩展名与文件内容不一致".to_string())?;
        let expected = match ext {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            _ => "image/bmp",
        };
        if mime != expected {
            return Err(format!("图片扩展名 .{ext} 与实际内容类型 {mime} 不一致"));
        }
        return Ok((mime.into(), "image".into(), String::new(), None));
    }
    if AUDIO_EXTENSIONS.contains(&ext) {
        let mime =
            sniff_audio(prefix, ext).ok_or_else(|| "音频扩展名与文件内容不一致".to_string())?;
        let matches_extension = match ext {
            "mp3" => mime == "audio/mpeg",
            "aac" => mime == "audio/aac",
            "wav" => mime == "audio/wav",
            "ogg" | "oga" => mime == "audio/ogg",
            "flac" => mime == "audio/flac",
            "m4a" => mime == "audio/mp4",
            _ => false,
        };
        if !matches_extension {
            return Err(format!("音频扩展名 .{ext} 与实际内容类型 {mime} 不一致"));
        }
        return Ok((
            mime.into(),
            "audio".into(),
            String::new(),
            Some("音频已安全保存，但当前未配置附件转写 provider；不会假装识别音频内容。".into()),
        ));
    }
    if LEGACY_OFFICE_EXTENSIONS.contains(&ext) {
        if !prefix.starts_with(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) {
            return Err("旧版 Office 扩展名与文件内容不一致".into());
        }
        return Ok((
            "application/x-ole-storage".into(),
            "office-legacy".into(),
            String::new(),
            Some(format!("旧版 .{ext} 二进制格式不能可靠解析，请先用 Office/LibreOffice 转换为 OOXML 或 PDF。")),
        ));
    }
    if OOXML_EXTENSIONS.contains(&ext) || ODF_EXTENSIONS.contains(&ext) || ext == "zip" {
        if !prefix.starts_with(b"PK\x03\x04") && !prefix.starts_with(b"PK\x05\x06") {
            return Err("扩展名与 ZIP/Office 文件内容不一致".into());
        }
        let (text, mime) = extract_archive_text(path, ext)?;
        return Ok((
            mime,
            if ext == "zip" { "archive" } else { "office" }.into(),
            text,
            None,
        ));
    }
    if ext == "pdf" {
        if !prefix.starts_with(b"%PDF-") {
            return Err("PDF 扩展名与文件内容不一致".into());
        }
        let text = pdf_extract::extract_text(path).map_err(|_| {
            "无法从 PDF 提取文字；文件可能是扫描件、加密文件或已损坏，不能假装读懂".to_string()
        })?;
        if text.trim().is_empty() {
            return Err("PDF 没有可提取文字；若为扫描件，请先 OCR 后再附加".into());
        }
        return Ok(("application/pdf".into(), "document".into(), text, None));
    }
    if TEXT_EXTENSIONS.contains(&ext) {
        let (bytes, input_truncated) = read_bounded(path, MAX_TEXT_READ_BYTES)?;
        let text = decode_text(&bytes)?;
        let mime = match ext {
            "html" | "htm" => "text/html",
            "css" => "text/css",
            "json" | "jsonl" | "webmanifest" => "application/json",
            "xml" | "svg" => "application/xml",
            "csv" => "text/csv",
            _ => "text/plain",
        };
        return Ok((
            mime.into(),
            "text".into(),
            text,
            input_truncated.then(|| "附件文本较长，已按安全读取上限截取".into()),
        ));
    }
    Err(format!("暂不支持 .{ext} 附件"))
}

fn insert_row(conn: &rusqlite::Connection, row: &ChatAttachment) -> Result<(), String> {
    conn.execute(
        "INSERT INTO chat_attachments
         (id, session_id, message_id, filename, stored_path, mime, kind, size_bytes,
          extracted_text, extraction_status, warning, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        rusqlite::params![
            row.id,
            row.session_id,
            row.message_id,
            row.filename,
            row.stored_path,
            row.mime,
            row.kind,
            row.size_bytes as i64,
            row.extracted_text,
            row.extraction_status,
            row.warning,
            row.created_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatAttachment> {
    Ok(ChatAttachment {
        id: row.get(0)?,
        session_id: row.get(1)?,
        message_id: row.get(2)?,
        filename: row.get(3)?,
        stored_path: row.get(4)?,
        mime: row.get(5)?,
        kind: row.get(6)?,
        size_bytes: row.get::<_, i64>(7)?.max(0) as u64,
        extracted_text: row.get(8)?,
        extraction_status: row.get(9)?,
        warning: row.get(10)?,
        created_at: row.get(11)?,
    })
}

fn list_pending(conn: &rusqlite::Connection, session: &str) -> Result<Vec<ChatAttachment>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, message_id, filename, stored_path, mime, kind, size_bytes,
                    extracted_text, extraction_status, warning, created_at
             FROM chat_attachments WHERE session_id=?1 AND message_id IS NULL ORDER BY created_at",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![session], map_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

struct PreparedAttachment {
    id: String,
    filename: String,
    staging_dir: PathBuf,
    size_bytes: u64,
    mime: String,
    kind: String,
    extracted_text: String,
    warning: Option<String>,
}

fn copy_source_to_staging(source: &Path, target: &Path) -> Result<(u64, Vec<u8>), String> {
    let mut input = File::open(source).map_err(|_| "无法打开所选附件".to_string())?;
    if !input
        .metadata()
        .map_err(|_| "无法读取附件信息".to_string())?
        .is_file()
    {
        return Err("只能附加本机普通文件".into());
    }
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(target)
        .map_err(|_| "无法创建附件临时副本".to_string())?;
    let mut buffer = [0u8; 64 * 1024];
    let mut total = 0u64;
    let mut prefix = Vec::with_capacity(8_192);
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|_| "读取附件时发生错误".to_string())?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read as u64);
        if total > MAX_FILE_BYTES {
            return Err("附件超过单文件 25 MB 限制".into());
        }
        if prefix.len() < 8_192 {
            let take = (8_192 - prefix.len()).min(read);
            prefix.extend_from_slice(&buffer[..take]);
        }
        output
            .write_all(&buffer[..read])
            .map_err(|_| "保存附件临时副本失败".to_string())?;
    }
    output
        .sync_all()
        .map_err(|_| "保存附件临时副本失败".to_string())?;
    Ok((total, prefix))
}

fn cleanup_dirs(paths: impl IntoIterator<Item = PathBuf>) {
    for path in paths {
        let _ = std::fs::remove_dir_all(path);
    }
}

fn pending_usage(
    tx: &rusqlite::Transaction<'_>,
    session: &str,
) -> Result<(usize, u64, u64), String> {
    let (count, bytes): (i64, i64) = tx
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(size_bytes),0)
             FROM chat_attachments WHERE session_id=?1 AND message_id IS NULL",
            rusqlite::params![session],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "无法核对附件限额".to_string())?;
    let mut stmt = tx
        .prepare(
            "SELECT extracted_text FROM chat_attachments
             WHERE session_id=?1 AND message_id IS NULL",
        )
        .map_err(|_| "无法核对附件限额".to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![session], |row| row.get::<_, String>(0))
        .map_err(|_| "无法核对附件限额".to_string())?;
    let mut tokens = 0u64;
    for row in rows {
        tokens = tokens.saturating_add(crate::desktop_db::estimate_tokens(
            &row.map_err(|_| "无法核对附件限额".to_string())?,
        ));
    }
    Ok((count.max(0) as usize, bytes.max(0) as u64, tokens))
}

fn commit_prepared(
    conn: &mut rusqlite::Connection,
    root: &Path,
    session: &str,
    mut prepared: Vec<PreparedAttachment>,
) -> Result<Vec<ChatAttachment>, String> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "附件保存正忙，请稍后重试".to_string())?;
    let (existing_count, existing_bytes, existing_tokens) = pending_usage(&tx, session)?;
    if existing_count.saturating_add(prepared.len()) > MAX_FILES {
        return Err(format!("当前消息最多保留 {MAX_FILES} 个附件"));
    }
    validate_size_limits(
        existing_bytes,
        &prepared
            .iter()
            .map(|item| item.size_bytes)
            .collect::<Vec<_>>(),
    )?;
    let incoming_tokens = prepared.iter().fold(0u64, |sum, item| {
        sum.saturating_add(crate::desktop_db::estimate_tokens(&item.extracted_text))
    });
    if existing_tokens.saturating_add(incoming_tokens) > MAX_TEXT_TOKENS {
        return Err("附件提取文本总量超过 12,000 token 限制".into());
    }

    let mut moved_dirs = Vec::new();
    let mut result = Vec::new();
    let operation = (|| -> Result<(), String> {
        for item in prepared.drain(..) {
            let final_dir = root.join(&item.id);
            std::fs::rename(&item.staging_dir, &final_dir)
                .map_err(|_| "无法完成附件原子保存".to_string())?;
            moved_dirs.push(final_dir.clone());
            let stored = final_dir.join(&item.filename);
            let row = ChatAttachment {
                id: item.id,
                session_id: session.to_string(),
                message_id: None,
                filename: item.filename,
                stored_path: stored.to_string_lossy().into_owned(),
                mime: item.mime,
                kind: item.kind,
                size_bytes: item.size_bytes,
                extracted_text: item.extracted_text,
                extraction_status: if item.warning.is_some() {
                    "limited"
                } else {
                    "ready"
                }
                .into(),
                warning: item.warning,
                created_at: chrono::Utc::now().timestamp_millis(),
            };
            insert_row(&tx, &row).map_err(|_| "无法写入附件记录".to_string())?;
            result.push(row);
        }
        Ok(())
    })();
    if let Err(error) = operation {
        drop(tx);
        cleanup_dirs(moved_dirs);
        return Err(error);
    }
    if tx.commit().is_err() {
        cleanup_dirs(moved_dirs);
        return Err("无法提交附件保存，已撤销本次添加".into());
    }
    Ok(result)
}

/// 流式校验并导入本地附件；临时副本、数据库事务和同卷原子重命名构成一次提交。
/// 依赖: 本机绝对路径、xu.db；任一步失败都会移除 staging/最终目录并回滚全部附件行。
#[tauri::command]
pub fn xu_ingest_chat_attachments(
    db: State<'_, FouDb>,
    paths: Vec<String>,
    session_id: Option<String>,
) -> Result<Vec<ChatAttachment>, String> {
    if paths.is_empty() || paths.len() > MAX_FILES {
        return Err(format!("一次最多选择 {MAX_FILES} 个附件"));
    }
    let session = session_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "__draft__".into());
    let root = crate::xu_paths::xu_home()
        .map_err(|_| "无法访问附件存储目录".to_string())?
        .join("attachments");
    let staging_root = root
        .join(".staging")
        .join(format!("batch_{}", Uuid::new_v4().simple()));
    std::fs::create_dir_all(&staging_root).map_err(|_| "无法创建附件临时目录".to_string())?;

    let prepared_result = (|| -> Result<Vec<PreparedAttachment>, String> {
        let mut prepared = Vec::new();
        let mut batch_bytes = 0u64;
        let mut batch_tokens = 0u64;
        for raw in paths {
            let source = PathBuf::from(raw);
            if !source.is_absolute() {
                return Err("只能附加本机普通文件".into());
            }
            let ext = extension(&source)?;
            let filename = safe_filename(&source)?;
            let id = format!("att_{}", Uuid::new_v4().simple());
            let item_dir = staging_root.join(&id);
            std::fs::create_dir(&item_dir).map_err(|_| "无法创建附件临时目录".to_string())?;
            let staging_path = item_dir.join(&filename);
            let (size_bytes, prefix) = copy_source_to_staging(&source, &staging_path)?;
            batch_bytes = batch_bytes.saturating_add(size_bytes);
            if batch_bytes > MAX_TOTAL_BYTES {
                return Err("附件总大小超过 50 MB 限制".into());
            }
            let (mime, kind, extracted, parse_warning) =
                parse_attachment(&staging_path, &prefix, &ext)?;
            let remaining = MAX_TEXT_TOKENS.saturating_sub(batch_tokens);
            let (extracted_text, truncation) = limit_text(extracted, remaining);
            batch_tokens =
                batch_tokens.saturating_add(crate::desktop_db::estimate_tokens(&extracted_text));
            prepared.push(PreparedAttachment {
                id,
                filename,
                staging_dir: item_dir,
                size_bytes,
                mime,
                kind,
                extracted_text,
                warning: parse_warning.or(truncation),
            });
        }
        Ok(prepared)
    })();

    let prepared = match prepared_result {
        Ok(value) => value,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&staging_root);
            return Err(error);
        }
    };
    let result = {
        let mut conn =
            db.0.lock()
                .map_err(|_| "本地附件数据暂时不可用".to_string())?;
        cleanup_expired_pending(&mut conn, &root)?;
        commit_prepared(&mut conn, &root, &session, prepared)
    };
    let _ = std::fs::remove_dir_all(&staging_root);
    result
}

/// 仅删除附件根目录中的单附件目录；非法、缺失或无法删除时静默保留供后续清理。
/// 依赖: 数据库中的 stored_path；绝不删除 `{XU_HOME}/attachments` 之外的目录。
pub fn remove_stored_attachment_dir(stored_path: &str) {
    let Ok(root) = crate::xu_paths::xu_home().map(|home| home.join("attachments")) else {
        return;
    };
    remove_stored_attachment_dir_under(&root, stored_path);
}

fn remove_stored_attachment_dir_under(root: &Path, stored_path: &str) -> bool {
    let Some(parent) = Path::new(stored_path).parent() else {
        return false;
    };
    if parent != root && parent.starts_with(root) {
        return std::fs::remove_dir_all(parent).is_ok();
    }
    false
}

fn cleanup_expired_pending(conn: &mut rusqlite::Connection, root: &Path) -> Result<usize, String> {
    cleanup_stale_staging(root);
    let cutoff = chrono::Utc::now()
        .timestamp_millis()
        .saturating_sub(PENDING_TTL_MS);
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "附件清理正忙，请稍后重试".to_string())?;
    let paths = {
        let mut stmt = tx
            .prepare(
                "SELECT stored_path FROM chat_attachments
                 WHERE message_id IS NULL AND created_at < ?1",
            )
            .map_err(|_| "无法检查过期附件".to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![cutoff], |row| row.get::<_, String>(0))
            .map_err(|_| "无法检查过期附件".to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| "无法检查过期附件".to_string())?
    };
    tx.execute(
        "DELETE FROM chat_attachments WHERE message_id IS NULL AND created_at < ?1",
        rusqlite::params![cutoff],
    )
    .map_err(|_| "无法清理过期附件".to_string())?;
    tx.commit()
        .map_err(|_| "无法提交过期附件清理".to_string())?;
    for path in &paths {
        remove_stored_attachment_dir_under(root, path);
    }
    Ok(paths.len())
}

fn cleanup_stale_staging(root: &Path) {
    let staging = root.join(".staging");
    let Ok(entries) = std::fs::read_dir(&staging) else {
        return;
    };
    for entry in entries.flatten() {
        let stale = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age.as_millis() > PENDING_TTL_MS as u128);
        if stale {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// 列出当前会话尚未发送的附件，用于应用重启后恢复输入区。
/// 依赖: xu.db；数据库读取失败直接返回错误，由前端 fouAlert 展示。
#[tauri::command]
pub fn xu_list_pending_chat_attachments(
    db: State<'_, FouDb>,
    session_id: Option<String>,
) -> Result<Vec<ChatAttachment>, String> {
    let session = session_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "__draft__".into());
    let root = crate::xu_paths::xu_home()
        .map_err(|_| "无法访问附件存储目录".to_string())?
        .join("attachments");
    let mut conn =
        db.0.lock()
            .map_err(|_| "本地附件数据暂时不可用".to_string())?;
    cleanup_expired_pending(&mut conn, &root)?;
    list_pending(&conn, &session)
}

/// 删除尚未发送的附件及其本地副本。
/// 依赖: xu.db 中记录的 `{XU_HOME}` 路径；失败时保留数据库记录以便重试。
#[tauri::command]
pub fn xu_remove_pending_chat_attachment(db: State<'_, FouDb>, id: String) -> Result<(), String> {
    let mut conn =
        db.0.lock()
            .map_err(|_| "本地附件数据暂时不可用".to_string())?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "附件正忙，请稍后重试".to_string())?;
    let path: String = tx
        .query_row(
            "SELECT stored_path FROM chat_attachments WHERE id=?1 AND message_id IS NULL",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .map_err(|_| "附件不存在或已经发送".to_string())?;
    tx.execute(
        "DELETE FROM chat_attachments WHERE id=?1 AND message_id IS NULL",
        rusqlite::params![id],
    )
    .map_err(|_| "无法移除附件记录".to_string())?;
    tx.commit().map_err(|_| "无法提交附件移除".to_string())?;
    remove_stored_attachment_dir(&path);
    Ok(())
}

/// 读取已持久化图片的安全预览；只接受附件表内图片且强制 25 MB 上限。
/// 依赖: xu.db 与 `{XU_HOME}/attachments`；失败信息不返回本机路径。
#[tauri::command]
pub fn xu_read_chat_attachment_preview(
    db: State<'_, FouDb>,
    id: String,
) -> Result<String, String> {
    let conn =
        db.0.lock()
            .map_err(|_| "本地附件数据暂时不可用".to_string())?;
    let (stored_path, mime, kind): (String, String, String) = conn
        .query_row(
            "SELECT stored_path, mime, kind FROM chat_attachments WHERE id=?1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| "图片附件不存在".to_string())?;
    if kind != "image" || !mime.starts_with("image/") {
        return Err("该附件不是可预览图片".into());
    }
    let root = crate::xu_paths::xu_home()
        .map_err(|_| "无法访问附件存储目录".to_string())?
        .join("attachments");
    let path = PathBuf::from(stored_path);
    if !path.starts_with(&root) {
        return Err("图片附件存储校验失败".into());
    }
    let (bytes, truncated) = read_bounded(&path, MAX_FILE_BYTES)?;
    if truncated {
        return Err("图片附件超过 25 MB，无法预览".into());
    }
    let actual = sniff_image(&bytes).ok_or_else(|| "图片内容校验失败".to_string())?;
    if actual != mime {
        return Err("图片内容与记录类型不一致".into());
    }
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn bind_chat_attachments(
    conn: &mut rusqlite::Connection,
    attachment_ids: &[String],
    session_id: &str,
    message_id: &str,
) -> Result<(), String> {
    if attachment_ids.len() > MAX_FILES {
        return Err(format!("当前消息最多绑定 {MAX_FILES} 个附件"));
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    bind_chat_attachments_in_tx(&tx, attachment_ids, session_id, message_id)?;
    tx.commit().map_err(|e| e.to_string())
}

fn bind_chat_attachments_in_tx(
    tx: &rusqlite::Transaction<'_>,
    attachment_ids: &[String],
    session_id: &str,
    message_id: &str,
) -> Result<(), String> {
    let message_session: String = tx
        .query_row(
            "SELECT session_id FROM chat_messages WHERE id=?1",
            rusqlite::params![message_id],
            |row| row.get(0),
        )
        .map_err(|_| "目标消息不存在".to_string())?;
    if message_session != session_id {
        return Err("目标消息不属于指定会话，已拒绝附件绑定".into());
    }
    let message_count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM chat_messages WHERE session_id=?1",
            rusqlite::params![session_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    for id in attachment_ids {
        let (attachment_session, bound_message): (String, Option<String>) = tx
            .query_row(
                "SELECT session_id, message_id FROM chat_attachments WHERE id=?1",
                rusqlite::params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| format!("附件不存在：{id}"))?;
        if bound_message.is_some() {
            return Err(format!("附件已绑定，已拒绝重复绑定：{id}"));
        }
        let initial_draft = attachment_session == "__draft__" && message_count == 1;
        if attachment_session != session_id && !initial_draft {
            return Err(format!("附件不属于目标会话，已拒绝跨会话绑定：{id}"));
        }
        let changed = tx
            .execute(
                "UPDATE chat_attachments SET session_id=?1, message_id=?2
                 WHERE id=?3 AND session_id=?4 AND message_id IS NULL",
                rusqlite::params![session_id, message_id, id, attachment_session],
            )
            .map_err(|e| e.to_string())?;
        if changed != 1 {
            return Err(format!("附件状态已变化，绑定已取消：{id}"));
        }
    }
    Ok(())
}

/// 将同会话待发送附件事务绑定到最终消息。
/// 依赖: xu.db 中消息/会话/附件关系；跨会话、未知或已绑定附件会整批回滚并硬拒绝。
#[tauri::command]
pub fn xu_bind_chat_attachments(
    db: State<'_, FouDb>,
    attachment_ids: Vec<String>,
    session_id: String,
    message_id: String,
) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    bind_chat_attachments(&mut conn, &attachment_ids, &session_id, &message_id)
}

/// 在同一事务内写入用户消息并绑定附件，避免消息成功而附件绑定失败的半状态。
/// 依赖: 已存在会话与同会话/初始草稿附件；任一步失败时消息和附件状态全部回滚。
#[tauri::command]
pub fn xu_append_chat_message_with_attachments(
    db: State<'_, FouDb>,
    session_id: String,
    role: String,
    content: String,
    attachment_ids: Vec<String>,
) -> Result<String, String> {
    if attachment_ids.is_empty() || attachment_ids.len() > MAX_FILES {
        return Err(format!("附件数量必须在 1 到 {MAX_FILES} 之间"));
    }
    let mut conn =
        db.0.lock()
            .map_err(|_| "本地附件数据暂时不可用".to_string())?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "消息保存正忙，请稍后重试".to_string())?;
    let session_exists: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM chat_sessions WHERE id=?1",
            rusqlite::params![session_id],
            |row| row.get(0),
        )
        .map_err(|_| "无法确认目标会话".to_string())?;
    if session_exists != 1 {
        return Err("目标会话不存在".into());
    }
    let message_id = format!("cm_{}", Uuid::new_v4().simple());
    let now = chrono::Utc::now().timestamp_millis();
    tx.execute(
        "INSERT INTO chat_messages
         (id,session_id,role,content,tool_name,tool_call_id,created_at)
         VALUES(?1,?2,?3,?4,NULL,NULL,?5)",
        rusqlite::params![message_id, session_id, role, content, now],
    )
    .map_err(|_| "无法保存消息".to_string())?;
    bind_chat_attachments_in_tx(&tx, &attachment_ids, &session_id, &message_id)?;
    tx.execute(
        "UPDATE chat_sessions SET updated_at=?1 WHERE id=?2",
        rusqlite::params![now, session_id],
    )
    .map_err(|_| "无法更新会话".to_string())?;
    tx.commit().map_err(|_| "无法提交消息和附件".to_string())?;
    Ok(message_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use std::sync::{Arc, Barrier, Mutex};
    use std::thread;
    use zip::write::SimpleFileOptions;

    fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut cursor);
            for (name, body) in entries {
                writer
                    .start_file(
                        name,
                        SimpleFileOptions::default()
                            .compression_method(zip::CompressionMethod::Deflated),
                    )
                    .unwrap();
                writer.write_all(body).unwrap();
            }
            writer.finish().unwrap();
        }
        cursor.into_inner()
    }

    fn attachment_schema(conn: &rusqlite::Connection) {
        conn.execute_batch(
            "CREATE TABLE chat_attachments (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT,
                filename TEXT NOT NULL, stored_path TEXT NOT NULL, mime TEXT NOT NULL,
                kind TEXT NOT NULL, size_bytes INTEGER NOT NULL, extracted_text TEXT NOT NULL,
                extraction_status TEXT NOT NULL, warning TEXT, created_at INTEGER NOT NULL
            );",
        )
        .unwrap();
    }

    fn fake_prepared(root: &Path, batch: &str, sizes: &[u64]) -> Vec<PreparedAttachment> {
        sizes
            .iter()
            .enumerate()
            .map(|(index, size)| {
                let id = format!("att_{batch}_{index}");
                let staging_dir = root.join(".staging").join(batch).join(&id);
                std::fs::create_dir_all(&staging_dir).unwrap();
                std::fs::write(staging_dir.join("sample.txt"), b"ok").unwrap();
                PreparedAttachment {
                    id,
                    filename: "sample.txt".into(),
                    staging_dir,
                    size_bytes: *size,
                    mime: "text/plain".into(),
                    kind: "text".into(),
                    extracted_text: String::new(),
                    warning: None,
                }
            })
            .collect()
    }

    #[test]
    fn extracts_ooxml_text_with_source() {
        let bytes = zip_bytes(&[
            (
                "word/document.xml",
                br#"<w:p><w:t>Hello Office</w:t></w:p>"#,
            ),
            ("docProps/core.xml", br#"<dc:title>Quarterly</dc:title>"#),
        ]);
        let dir = std::env::temp_dir().join(format!("xu-att-{}.docx", Uuid::new_v4()));
        std::fs::write(&dir, bytes).unwrap();
        let (text, _) = extract_archive_text(&dir, "docx").unwrap();
        let _ = std::fs::remove_file(&dir);
        assert!(text.contains("Hello Office"));
        assert!(text.contains("word/document.xml"));
    }

    #[test]
    fn rejects_zip_path_traversal() {
        let bytes = zip_bytes(&[("../escape.txt", b"bad")]);
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert!(validate_archive(&mut archive)
            .unwrap_err()
            .contains("不安全路径"));
    }

    #[test]
    fn rejects_zip_bomb_ratio() {
        let body = vec![b'A'; 2 * 1024 * 1024];
        let bytes = zip_bytes(&[("huge.txt", &body)]);
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert!(validate_archive(&mut archive)
            .unwrap_err()
            .contains("zip bomb"));
    }

    #[test]
    fn rejects_binary_disguised_as_text() {
        assert!(decode_text(b"hello\0binary").is_err());
        assert!(parse_attachment(Path::new("bad.png"), b"not-png", "png").is_err());
        assert!(
            parse_attachment(Path::new("renamed.jpg"), b"\x89PNG\r\n\x1a\npayload", "jpg").is_err()
        );
    }

    #[test]
    fn enforces_per_file_and_total_size_limits() {
        assert!(validate_size_limits(0, &[MAX_FILE_BYTES + 1]).is_err());
        assert!(validate_size_limits(MAX_TOTAL_BYTES - 10, &[11]).is_err());
        assert!(validate_size_limits(0, &[MAX_FILE_BYTES, MAX_FILE_BYTES]).is_ok());
    }

    #[test]
    fn bounded_copy_rejects_growth_beyond_file_limit() {
        let base = std::env::temp_dir().join(format!("xu-att-copy-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        let source = base.join("growing.txt");
        let source_file = File::create(&source).unwrap();
        source_file.set_len(MAX_FILE_BYTES + 1).unwrap();
        let target = base.join("staged.txt");
        let error = copy_source_to_staging(&source, &target).unwrap_err();
        let _ = std::fs::remove_dir_all(&base);
        assert!(error.contains("25 MB"));
    }

    #[test]
    fn concurrent_thirty_mb_batches_recheck_transactional_total() {
        let root = std::env::temp_dir().join(format!("xu-att-race-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let conn = Arc::new(Mutex::new(rusqlite::Connection::open_in_memory().unwrap()));
        attachment_schema(&conn.lock().unwrap());
        let barrier = Arc::new(Barrier::new(3));
        let mut handles = Vec::new();
        for batch in ["a", "b"] {
            let conn = Arc::clone(&conn);
            let barrier = Arc::clone(&barrier);
            let root = root.clone();
            handles.push(thread::spawn(move || {
                let prepared = fake_prepared(&root, batch, &[15 * 1024 * 1024, 15 * 1024 * 1024]);
                barrier.wait();
                commit_prepared(&mut conn.lock().unwrap(), &root, "session", prepared)
            }));
        }
        barrier.wait();
        let outcomes = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();
        let stored: i64 = conn
            .lock()
            .unwrap()
            .query_row(
                "SELECT COALESCE(SUM(size_bytes),0) FROM chat_attachments",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(outcomes.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(stored as u64, 30 * 1024 * 1024);
    }

    #[test]
    fn database_failure_rolls_back_rows_and_final_directory() {
        let root = std::env::temp_dir().join(format!("xu-att-db-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        attachment_schema(&conn);
        conn.execute_batch(
            "CREATE TRIGGER reject_attachment BEFORE INSERT ON chat_attachments
             BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
        )
        .unwrap();
        let prepared = fake_prepared(&root, "failure", &[1]);
        let final_dir = root.join(&prepared[0].id);
        assert!(commit_prepared(&mut conn, &root, "session", prepared).is_err());
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM chat_attachments", [], |row| {
                row.get(0)
            })
            .unwrap();
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(count, 0);
        assert!(!final_dir.exists());
    }

    #[test]
    fn expired_pending_rows_and_files_are_cleaned() {
        let root = std::env::temp_dir().join(format!("xu-att-expire-{}", Uuid::new_v4()));
        let item_dir = root.join("att_old");
        std::fs::create_dir_all(&item_dir).unwrap();
        let stored = item_dir.join("old.txt");
        std::fs::write(&stored, b"old").unwrap();
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        attachment_schema(&conn);
        conn.execute(
            "INSERT INTO chat_attachments VALUES
             ('att_old','__draft__',NULL,'old.txt',?1,'text/plain','text',3,'old','ready',NULL,1)",
            rusqlite::params![stored.to_string_lossy()],
        )
        .unwrap();
        assert_eq!(cleanup_expired_pending(&mut conn, &root).unwrap(), 1);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM chat_attachments", [], |row| {
                row.get(0)
            })
            .unwrap();
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(count, 0);
        assert!(!item_dir.exists());
    }

    #[test]
    fn committed_session_delete_safely_removes_attachment_directory() {
        let root = std::env::temp_dir().join(format!("xu-att-delete-{}", Uuid::new_v4()));
        let item_dir = root.join("att_delete");
        std::fs::create_dir_all(&item_dir).unwrap();
        let stored = item_dir.join("file.txt");
        std::fs::write(&stored, b"test").unwrap();
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE chat_sessions(id TEXT PRIMARY KEY);
             CREATE TABLE chat_messages(
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
                FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
             );
             CREATE TABLE chat_attachments (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT,
                filename TEXT NOT NULL, stored_path TEXT NOT NULL, mime TEXT NOT NULL,
                kind TEXT NOT NULL, size_bytes INTEGER NOT NULL, extracted_text TEXT NOT NULL,
                extraction_status TEXT NOT NULL, warning TEXT, created_at INTEGER NOT NULL
             );
             INSERT INTO chat_sessions(id) VALUES('session');
             INSERT INTO chat_messages(id,session_id) VALUES('message','session');",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO chat_attachments VALUES
             ('att_delete','session','message','file.txt',?1,'text/plain','text',4,'test','ready',NULL,1)",
            rusqlite::params![stored.to_string_lossy()],
        )
        .unwrap();
        let paths = crate::desktop_db::delete_chat_session(&mut conn, "session").unwrap();
        for path in paths {
            assert!(remove_stored_attachment_dir_under(&root, &path));
        }
        let _ = std::fs::remove_dir_all(&root);
        assert!(!item_dir.exists());
    }

    #[test]
    fn pending_attachment_survives_connection_reopen() {
        let db_path = std::env::temp_dir().join(format!("xu-att-{}.db", Uuid::new_v4()));
        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE chat_attachments (
                    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT,
                    filename TEXT NOT NULL, stored_path TEXT NOT NULL, mime TEXT NOT NULL,
                    kind TEXT NOT NULL, size_bytes INTEGER NOT NULL, extracted_text TEXT NOT NULL,
                    extraction_status TEXT NOT NULL, warning TEXT, created_at INTEGER NOT NULL
                );",
            )
            .unwrap();
            insert_row(
                &conn,
                &ChatAttachment {
                    id: "att_test".into(),
                    session_id: "__draft__".into(),
                    message_id: None,
                    filename: "notes.md".into(),
                    stored_path: "attachments/att_test/notes.md".into(),
                    mime: "text/plain".into(),
                    kind: "text".into(),
                    size_bytes: 5,
                    extracted_text: "hello".into(),
                    extraction_status: "ready".into(),
                    warning: None,
                    created_at: 1,
                },
            )
            .unwrap();
        }
        let reopened = rusqlite::Connection::open(&db_path).unwrap();
        let rows = list_pending(&reopened, "__draft__").unwrap();
        drop(reopened);
        let _ = std::fs::remove_file(db_path);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].extracted_text, "hello");
    }

    #[test]
    fn rejects_cross_session_attachment_binding_transactionally() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE chat_messages (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL
             );
             CREATE TABLE chat_attachments (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT
             );
             INSERT INTO chat_messages(id, session_id) VALUES
                ('msg_b', 'session_b');
             INSERT INTO chat_attachments(id, session_id, message_id) VALUES
                ('att_a', 'session_a', NULL);",
        )
        .unwrap();

        let error = bind_chat_attachments(&mut conn, &["att_a".to_string()], "session_b", "msg_b")
            .unwrap_err();
        let still_unbound: Option<String> = conn
            .query_row(
                "SELECT message_id FROM chat_attachments WHERE id='att_a'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert!(error.contains("跨会话"));
        assert!(still_unbound.is_none());
    }

    #[test]
    fn send_transaction_failure_keeps_attachment_pending() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE chat_sessions(id TEXT PRIMARY KEY, updated_at INTEGER NOT NULL);
             CREATE TABLE chat_messages (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
                content TEXT NOT NULL, tool_name TEXT, tool_call_id TEXT, created_at INTEGER NOT NULL
             );
             CREATE TABLE chat_attachments (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT
             );
             INSERT INTO chat_sessions(id,updated_at) VALUES('session',1);
             INSERT INTO chat_attachments(id,session_id,message_id)
             VALUES('att_pending','session',NULL);",
        )
        .unwrap();
        {
            let tx = conn.transaction().unwrap();
            tx.execute(
                "INSERT INTO chat_messages VALUES('message','session','user','hello',NULL,NULL,1)",
                [],
            )
            .unwrap();
            assert!(bind_chat_attachments_in_tx(
                &tx,
                &["missing".to_string()],
                "session",
                "message"
            )
            .is_err());
        }
        let message_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM chat_messages", [], |row| row.get(0))
            .unwrap();
        let still_pending: Option<String> = conn
            .query_row(
                "SELECT message_id FROM chat_attachments WHERE id='att_pending'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(message_count, 0);
        assert!(still_pending.is_none());
    }
}
