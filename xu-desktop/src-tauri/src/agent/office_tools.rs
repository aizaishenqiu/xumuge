//! Microsoft Office–format tools (docx / xlsx / pptx) inside PathSandbox.
//! Create real OOXML files without requiring MS Office installed.
//! Optional: open with the system default app (Word/WPS/Excel…).
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @updated 2026-09-06
//! @version 1.2.0
//! @category ToolPolicy
//! @algo ooxml-sandbox-office-tools

use std::collections::HashMap;
use std::fs::File;
use std::io::{Cursor, Write};
use std::path::Path;
use std::process::Command;

use calamine::{open_workbook_auto, Data, Reader};
use docx_rs::{Docx, Paragraph, Run};
use rust_xlsxwriter::Workbook;
use serde_json::Value;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use super::tools::{snapshot_write_path, PathSandbox};

const MAX_PARAS: usize = 400;
const MAX_ROWS: usize = 5_000;
const MAX_COLS: usize = 64;
const MAX_EDIT_CELLS: usize = 500;
const MAX_DOCX_CHARS: usize = 80_000;

pub fn tool_office_write_docx(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(raw) = args.get("path").and_then(|v| v.as_str()) else {
        return "缺少 path（如 PM_需求.md → 请用 .docx 路径）".into();
    };
    if !raw.to_lowercase().ends_with(".docx") {
        return "path 必须以 .docx 结尾".into();
    }
    let path = match sandbox.resolve_write(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("");
    let body = args.get("body").and_then(|v| v.as_str()).unwrap_or("");
    let paragraphs: Vec<String> =
        if let Some(arr) = args.get("paragraphs").and_then(|v| v.as_array()) {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .take(MAX_PARAS)
                .collect()
        } else {
            body.lines()
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty())
                .take(MAX_PARAS)
                .collect()
        };
    if title.is_empty() && paragraphs.is_empty() {
        return "需要 title 和/或 body/paragraphs".into();
    }
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return format!("创建目录失败: {e}");
        }
    }
    snapshot_write_path(sandbox, &path);

    let mut doc = Docx::new();
    if !title.is_empty() {
        doc = doc.add_paragraph(Paragraph::new().add_run(Run::new().add_text(title).bold()));
        doc = doc.add_paragraph(Paragraph::new().add_run(Run::new().add_text("")));
    }
    for p in &paragraphs {
        doc = doc.add_paragraph(Paragraph::new().add_run(Run::new().add_text(p)));
    }

    let file = match File::create(&path) {
        Ok(f) => f,
        Err(e) => return format!("创建文件失败: {e}"),
    };
    match doc.build().pack(file) {
        Ok(()) => format!(
            "✅ 已写入 Word 文档 {}（{} 段）",
            path.display(),
            paragraphs.len() + if title.is_empty() { 0 } else { 1 }
        ),
        Err(e) => format!("写 docx 失败: {e}"),
    }
}

pub fn tool_office_write_xlsx(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(raw) = args.get("path").and_then(|v| v.as_str()) else {
        return "缺少 path（.xlsx）".into();
    };
    if !raw.to_lowercase().ends_with(".xlsx") {
        return "path 必须以 .xlsx 结尾".into();
    }
    let path = match sandbox.resolve_write(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let sheet = args
        .get("sheet")
        .and_then(|v| v.as_str())
        .unwrap_or("Sheet1");
    let Some(rows) = args.get("rows").and_then(|v| v.as_array()) else {
        return "缺少 rows：二维数组，如 [[\"A\",\"B\"],[1,2]]".into();
    };
    if rows.len() > MAX_ROWS {
        return format!("行数过多（> {MAX_ROWS}）");
    }
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return format!("创建目录失败: {e}");
        }
    }
    snapshot_write_path(sandbox, &path);

    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    if let Err(e) = worksheet.set_name(sheet) {
        return format!("设置表名失败: {e}");
    }

    let mut written = 0usize;
    for (r, row) in rows.iter().enumerate() {
        let Some(cols) = row.as_array() else {
            continue;
        };
        if cols.len() > MAX_COLS {
            return format!("列数过多（> {MAX_COLS}）");
        }
        for (c, cell) in cols.iter().enumerate() {
            let rr = r as u32;
            let cc = c as u16;
            let res: Result<(), _> = if let Some(n) = cell.as_f64() {
                worksheet.write_number(rr, cc, n).map(|_| ())
            } else if let Some(b) = cell.as_bool() {
                worksheet.write_boolean(rr, cc, b).map(|_| ())
            } else if let Some(s) = cell.as_str() {
                worksheet.write_string(rr, cc, s).map(|_| ())
            } else if cell.is_null() {
                Ok(())
            } else {
                worksheet
                    .write_string(rr, cc, &cell.to_string())
                    .map(|_| ())
            };
            if let Err(e) = res {
                return format!("写单元格 ({r},{c}) 失败: {e}");
            }
            written += 1;
        }
    }

    match workbook.save(&path) {
        Ok(()) => format!(
            "✅ 已写入 Excel {}（表「{sheet}」，约 {written} 格）",
            path.display()
        ),
        Err(e) => format!("保存 xlsx 失败: {e}"),
    }
}

pub fn tool_office_read_xlsx(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(raw) = args.get("path").and_then(|v| v.as_str()) else {
        return "缺少 path".into();
    };
    let path = match sandbox.resolve_read(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if !path.is_file() {
        return format!("文件不存在: {}", path.display());
    }
    let mut workbook = match open_workbook_auto(&path) {
        Ok(w) => w,
        Err(e) => return format!("打开表格失败: {e}"),
    };
    let sheet_name = args
        .get("sheet")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| workbook.sheet_names().first().cloned());
    let Some(sheet_name) = sheet_name else {
        return "工作簿无工作表".into();
    };
    let range = match workbook.worksheet_range(&sheet_name) {
        Ok(r) => r,
        Err(e) => return format!("读表失败: {e}"),
    };
    let max_r = args
        .get("max_rows")
        .and_then(|v| v.as_u64())
        .unwrap_or(80)
        .clamp(1, 500) as usize;
    let mut lines = vec![format!("# sheet={sheet_name}")];
    for (i, row) in range.rows().take(max_r).enumerate() {
        let cells: Vec<String> = row
            .iter()
            .map(|c| match c {
                Data::Empty => String::new(),
                Data::String(s) => s.clone(),
                Data::Float(f) => f.to_string(),
                Data::Int(n) => n.to_string(),
                Data::Bool(b) => b.to_string(),
                other => format!("{other:?}"),
            })
            .collect();
        lines.push(format!("{i}\t{}", cells.join("\t")));
    }
    if range.rows().count() > max_r {
        lines.push("…(已截断)".into());
    }
    lines.join("\n")
}

/// Minimal one-title + bullet slides PPTX (OOXML zip).
pub fn tool_office_write_pptx(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(raw) = args.get("path").and_then(|v| v.as_str()) else {
        return "缺少 path（.pptx）".into();
    };
    if !raw.to_lowercase().ends_with(".pptx") {
        return "path 必须以 .pptx 结尾".into();
    }
    let path = match sandbox.resolve_write(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let title = args
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("演示文稿");
    let bullets: Vec<String> = args
        .get("bullets")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .take(40)
                .collect()
        })
        .unwrap_or_default();
    let body = args.get("body").and_then(|v| v.as_str()).unwrap_or("");
    let mut items = bullets;
    if items.is_empty() && !body.is_empty() {
        items = body
            .lines()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .take(40)
            .collect();
    }
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return format!("创建目录失败: {e}");
        }
    }
    snapshot_write_path(sandbox, &path);
    match write_minimal_pptx(&path, title, &items) {
        Ok(()) => format!(
            "✅ 已写入 PPT {}（标题 + {} 条）",
            path.display(),
            items.len()
        ),
        Err(e) => format!("写 pptx 失败: {e}"),
    }
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn write_minimal_pptx(path: &Path, title: &str, bullets: &[String]) -> Result<(), String> {
    let file = File::create(path).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

    zip.start_file("[Content_Types].xml", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
</Types>"#,
    )
    .map_err(|e| e.to_string())?;

    zip.start_file("_rels/.rels", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>"#,
    )
    .map_err(|e| e.to_string())?;

    zip.start_file("ppt/_rels/presentation.xml.rels", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
</Relationships>"#,
    )
    .map_err(|e| e.to_string())?;

    zip.start_file("ppt/presentation.xml", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
  </p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>"#,
    )
    .map_err(|e| e.to_string())?;

    // Minimal empty master/layout so PowerPoint opens
    zip.start_file("ppt/slideMasters/slideMaster1.xml", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>"#,
    )
    .map_err(|e| e.to_string())?;

    zip.start_file("ppt/slideMasters/_rels/slideMaster1.xml.rels", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>"#,
    )
    .map_err(|e| e.to_string())?;

    zip.start_file("ppt/slideLayouts/slideLayout1.xml", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>"#,
    )
    .map_err(|e| e.to_string())?;

    zip.start_file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>"#,
    )
    .map_err(|e| e.to_string())?;

    zip.start_file("ppt/slides/_rels/slide1.xml.rels", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>"#,
    )
    .map_err(|e| e.to_string())?;

    let mut text_xml = String::new();
    text_xml.push_str(&format!(
        r#"<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-CN" sz="3200" b="1"/><a:t>{}</a:t></a:r></a:p>"#,
        xml_escape(title)
    ));
    for b in bullets {
        text_xml.push_str(&format!(
            r#"<a:p><a:pPr marL="342900"/><a:r><a:rPr lang="zh-CN" sz="1800"/><a:t>• {}</a:t></a:r></a:p>"#,
            xml_escape(b)
        ));
    }

    let slide = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="457200" y="457200"/><a:ext cx="11277600" cy="5943600"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square"/><a:lstStyle/>
          {text_xml}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>"#
    );

    zip.start_file("ppt/slides/slide1.xml", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(slide.as_bytes()).map_err(|e| e.to_string())?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Open a workspace Office file with the OS default app (Word / WPS / Excel…).
pub fn tool_office_open(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(raw) = args.get("path").and_then(|v| v.as_str()) else {
        return "缺少 path".into();
    };
    let path = match sandbox.resolve_read(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if !path.is_file() {
        return format!("文件不存在: {}", path.display());
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !matches!(
        ext.as_str(),
        "docx" | "xlsx" | "pptx" | "doc" | "xls" | "ppt" | "csv" | "pdf"
    ) {
        return format!("不支持的办公扩展名: .{ext}");
    }
    #[cfg(windows)]
    {
        match Command::new("cmd")
            .args(["/C", "start", "", &path.to_string_lossy()])
            .spawn()
        {
            Ok(_) => format!("已调用系统打开：{}", path.display()),
            Err(e) => format!("打开失败: {e}"),
        }
    }
    #[cfg(target_os = "macos")]
    {
        match Command::new("open").arg(&path).spawn() {
            Ok(_) => format!("已调用系统打开：{}", path.display()),
            Err(e) => format!("打开失败: {e}"),
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        match Command::new("xdg-open").arg(&path).spawn() {
            Ok(_) => format!("已调用系统打开：{}", path.display()),
            Err(e) => format!("打开失败: {e}"),
        }
    }
}

/// Replace text in an existing .docx via unzip/rezip of document.xml (best-effort).
pub fn tool_office_docx_replace(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(raw) = args.get("path").and_then(|v| v.as_str()) else {
        return "缺少 path".into();
    };
    let Some(find) = args.get("find").and_then(|v| v.as_str()) else {
        return "缺少 find".into();
    };
    let replace = args.get("replace").and_then(|v| v.as_str()).unwrap_or("");
    if find.is_empty() {
        return "find 为空".into();
    }
    let path = match sandbox.resolve_write(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if !path.is_file() {
        return format!("文件不存在: {}", path.display());
    }
    snapshot_write_path(sandbox, &path);
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => return format!("读取失败: {e}"),
    };
    let cursor = Cursor::new(bytes);
    let mut archive = match zip::ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(e) => return format!("不是有效 docx/zip: {e}"),
    };
    let mut document_xml = String::new();
    {
        let mut file = match archive.by_name("word/document.xml") {
            Ok(f) => f,
            Err(e) => return format!("缺少 word/document.xml: {e}"),
        };
        use std::io::Read;
        if let Err(e) = file.read_to_string(&mut document_xml) {
            return format!("读 document.xml 失败: {e}");
        }
    }
    let find_esc = xml_escape(find);
    let replace_esc = xml_escape(replace);
    if !document_xml.contains(find) && !document_xml.contains(&find_esc) {
        return "未找到要替换的文本（docx 可能把字拆到多个 run 里，请用 office_write_docx 重写）"
            .into();
    }
    let new_xml = document_xml
        .replace(find, replace)
        .replace(&find_esc, &replace_esc);

    // Rebuild zip
    let mut out_buf: Vec<u8> = Vec::new();
    {
        let cursor_in = Cursor::new(std::fs::read(&path).unwrap_or_default());
        let mut zin = match zip::ZipArchive::new(cursor_in) {
            Ok(a) => a,
            Err(e) => return format!("重开 zip 失败: {e}"),
        };
        let mut zout = ZipWriter::new(Cursor::new(&mut out_buf));
        let opts =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for i in 0..zin.len() {
            let mut file = match zin.by_index(i) {
                Ok(f) => f,
                Err(_) => continue,
            };
            let name = file.name().to_string();
            let mut data = Vec::new();
            use std::io::Read;
            let _ = file.read_to_end(&mut data);
            if name == "word/document.xml" {
                data = new_xml.as_bytes().to_vec();
            }
            if zout.start_file(name, opts).is_ok() {
                let _ = zout.write_all(&data);
            }
        }
        let _ = zout.finish();
    }
    match std::fs::write(&path, &out_buf) {
        Ok(()) => format!("✅ 已在 {} 替换文本", path.display()),
        Err(e) => format!("写回失败: {e}"),
    }
}

/// Duty: 读取 .docx 纯文本摘要（段落列表）。
pub fn tool_office_read_docx(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(raw) = args.get("path").and_then(|v| v.as_str()) else {
        return "缺少 path".into();
    };
    let path = match sandbox.resolve_read(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if !path.is_file() {
        return format!("文件不存在: {}", path.display());
    }
    if !raw.to_lowercase().ends_with(".docx") && !path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("docx"))
        .unwrap_or(false)
    {
        return "path 须为 .docx".into();
    }
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => return format!("读取失败: {e}"),
    };
    let cursor = Cursor::new(bytes);
    let mut archive = match zip::ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(e) => return format!("不是有效 docx/zip: {e}"),
    };
    let mut document_xml = String::new();
    {
        let mut file = match archive.by_name("word/document.xml") {
            Ok(f) => f,
            Err(e) => return format!("缺少 word/document.xml: {e}"),
        };
        use std::io::Read;
        if let Err(e) = file.read_to_string(&mut document_xml) {
            return format!("读 document.xml 失败: {e}");
        }
    }
    let paras = extract_docx_paragraphs(&document_xml);
    if paras.is_empty() {
        return format!("# docx={}（无可见段落文本）", path.display());
    }
    let max_paras = args
        .get("max_paragraphs")
        .and_then(|v| v.as_u64())
        .unwrap_or(200)
        .clamp(1, 800) as usize;
    let mut out = vec![format!("# docx={} paragraphs={}", path.display(), paras.len())];
    let mut chars = 0usize;
    for (i, p) in paras.iter().take(max_paras).enumerate() {
        chars = chars.saturating_add(p.len());
        if chars > MAX_DOCX_CHARS {
            out.push(format!("[{i}] …(已截断，超字数上限)"));
            break;
        }
        out.push(format!("[{i}] {p}"));
    }
    if paras.len() > max_paras {
        out.push("…(段落已截断)".into());
    }
    out.join("\n")
}

fn extract_docx_paragraphs(xml: &str) -> Vec<String> {
    let mut paras = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<w:p") {
        let after = &rest[start..];
        let Some(end_rel) = after.find("</w:p>") else {
            break;
        };
        let block = &after[..end_rel + "</w:p>".len()];
        let mut text = String::new();
        let mut s = block;
        while let Some(t0) = s.find("<w:t") {
            let after_t = &s[t0..];
            let Some(gt) = after_t.find('>') else {
                break;
            };
            let content = &after_t[gt + 1..];
            let Some(close) = content.find("</w:t>") else {
                break;
            };
            text.push_str(&xml_unescape(&content[..close]));
            s = &content[close + "</w:t>".len()..];
        }
        let t = text.trim();
        if !t.is_empty() {
            paras.push(t.to_string());
        }
        rest = &after[end_rel + "</w:p>".len()..];
    }
    paras
}

fn xml_unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

#[derive(Clone, Debug)]
enum CellVal {
    Empty,
    Str(String),
    Float(f64),
    Bool(bool),
    Formula(String),
}

fn data_to_cell(d: &Data) -> CellVal {
    match d {
        Data::Empty => CellVal::Empty,
        Data::String(s) => CellVal::Str(s.clone()),
        Data::Float(f) => CellVal::Float(*f),
        Data::Int(n) => CellVal::Float(*n as f64),
        Data::Bool(b) => CellVal::Bool(*b),
        other => CellVal::Str(format!("{other:?}")),
    }
}

fn parse_col_letters(s: &str) -> Result<u16, String> {
    let mut col: u32 = 0;
    for c in s.chars() {
        if !c.is_ascii_alphabetic() {
            return Err(format!("无效列字母: {s}"));
        }
        col = col * 26 + (c.to_ascii_uppercase() as u32 - b'A' as u32 + 1);
        if col > 16384 {
            return Err("列号过大".into());
        }
    }
    if col == 0 {
        return Err("缺少列字母".into());
    }
    Ok((col - 1) as u16)
}

/// Duty: 解析 A1 / AB12 → (row0, col0)。
fn parse_a1(a1: &str) -> Result<(u32, u16), String> {
    let t = a1.trim();
    if t.is_empty() {
        return Err("空单元格引用".into());
    }
    let mut i = 0;
    let bytes = t.as_bytes();
    while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
        i += 1;
    }
    if i == 0 || i == bytes.len() {
        return Err(format!("无效引用: {a1}"));
    }
    let col = parse_col_letters(&t[..i])?;
    let row_s = &t[i..];
    let row_1: u32 = row_s
        .parse()
        .map_err(|_| format!("无效行号: {a1}"))?;
    if row_1 == 0 {
        return Err("行号从 1 开始".into());
    }
    Ok((row_1 - 1, col))
}

fn parse_a1_range(range: &str) -> Result<(u32, u16, u32, u16), String> {
    let t = range.trim();
    let (a, b) = if let Some((l, r)) = t.split_once(':') {
        (l.trim(), r.trim())
    } else {
        (t, t)
    };
    let (r1, c1) = parse_a1(a)?;
    let (r2, c2) = parse_a1(b)?;
    Ok((r1.min(r2), c1.min(c2), r1.max(r2), c1.max(c2)))
}

fn load_sheet_grid(
    workbook: &mut calamine::Sheets<std::io::BufReader<File>>,
    sheet_name: &str,
) -> Result<HashMap<(u32, u16), CellVal>, String> {
    let range = workbook
        .worksheet_range(sheet_name)
        .map_err(|e| format!("读表失败: {e}"))?;
    let mut grid = HashMap::new();
    for (r, row) in range.rows().enumerate() {
        if r >= MAX_ROWS {
            break;
        }
        for (c, cell) in row.iter().enumerate() {
            if c >= MAX_COLS {
                break;
            }
            let v = data_to_cell(cell);
            if !matches!(v, CellVal::Empty) {
                grid.insert((r as u32, c as u16), v);
            }
        }
    }
    Ok(grid)
}

fn write_grid_to_workbook(
    path: &Path,
    sheets: &[(String, HashMap<(u32, u16), CellVal>)],
) -> Result<(), String> {
    let mut workbook = Workbook::new();
    for (name, grid) in sheets {
        let worksheet = workbook.add_worksheet();
        worksheet.set_name(name).map_err(|e| e.to_string())?;
        for ((r, c), v) in grid {
            let res = match v {
                CellVal::Empty => Ok(()),
                CellVal::Str(s) => worksheet.write_string(*r, *c, s).map(|_| ()),
                CellVal::Float(n) => worksheet.write_number(*r, *c, *n).map(|_| ()),
                CellVal::Bool(b) => worksheet.write_boolean(*r, *c, *b).map(|_| ()),
                CellVal::Formula(f) => {
                    let formula = f.strip_prefix('=').unwrap_or(f.as_str());
                    worksheet.write_formula(*r, *c, formula).map(|_| ())
                }
            };
            res.map_err(|e| format!("写单元格失败 ({r},{c}): {e}"))?;
        }
    }
    workbook.save(path).map_err(|e| format!("保存 xlsx 失败: {e}"))
}

fn preview_grid(grid: &HashMap<(u32, u16), CellVal>, max_rows: u32) -> String {
    let mut max_r = 0u32;
    let mut max_c = 0u16;
    for (r, c) in grid.keys() {
        max_r = max_r.max(*r);
        max_c = max_c.max(*c);
    }
    let mut lines = Vec::new();
    for r in 0..=max_r.min(max_rows.saturating_sub(1)) {
        let mut cells = Vec::new();
        for c in 0..=max_c.min(31) {
            let s = match grid.get(&(r, c)) {
                None | Some(CellVal::Empty) => String::new(),
                Some(CellVal::Str(s)) => s.clone(),
                Some(CellVal::Float(n)) => n.to_string(),
                Some(CellVal::Bool(b)) => b.to_string(),
                Some(CellVal::Formula(f)) => f.clone(),
            };
            cells.push(s);
        }
        lines.push(format!("{r}\t{}", cells.join("\t")));
    }
    lines.join("\n")
}

/// Duty: 按 A1 范围读取 xlsx，返回 TSV。
pub fn tool_office_read_xlsx_range(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(raw) = args.get("path").and_then(|v| v.as_str()) else {
        return "缺少 path".into();
    };
    let Some(range_s) = args.get("range").and_then(|v| v.as_str()) else {
        return "缺少 range（如 A1:D20）".into();
    };
    let path = match sandbox.resolve_read(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if !path.is_file() {
        return format!("文件不存在: {}", path.display());
    }
    let (r0, c0, r1, c1) = match parse_a1_range(range_s) {
        Ok(v) => v,
        Err(e) => return e,
    };
    if (r1 - r0) as usize >= MAX_ROWS || (c1 - c0) as usize >= MAX_COLS {
        return format!("范围过大（行<{MAX_ROWS} 列<{MAX_COLS}）");
    }
    let mut workbook = match open_workbook_auto(&path) {
        Ok(w) => w,
        Err(e) => return format!("打开表格失败: {e}"),
    };
    let sheet_name = args
        .get("sheet")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| workbook.sheet_names().first().cloned());
    let Some(sheet_name) = sheet_name else {
        return "工作簿无工作表".into();
    };
    let range = match workbook.worksheet_range(&sheet_name) {
        Ok(r) => r,
        Err(e) => return format!("读表失败: {e}"),
    };
    let mut lines = vec![format!("# sheet={sheet_name} range={range_s}")];
    for r in r0..=r1 {
        let mut cells = Vec::new();
        for c in c0..=c1 {
            let s = range
                .get((r as usize, c as usize))
                .map(|d| match d {
                    Data::Empty => String::new(),
                    Data::String(s) => s.clone(),
                    Data::Float(f) => f.to_string(),
                    Data::Int(n) => n.to_string(),
                    Data::Bool(b) => b.to_string(),
                    other => format!("{other:?}"),
                })
                .unwrap_or_default();
            cells.push(s);
        }
        lines.push(cells.join("\t"));
    }
    lines.join("\n")
}

/// Duty: 按 A1 增量改写 xlsx 单元格（读值重建；格式/原公式可能丢失）。
pub fn tool_office_edit_xlsx_cells(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(raw) = args.get("path").and_then(|v| v.as_str()) else {
        return "缺少 path（.xlsx）".into();
    };
    if !raw.to_lowercase().ends_with(".xlsx") {
        return "path 必须以 .xlsx 结尾".into();
    }
    let Some(cells) = args.get("cells").and_then(|v| v.as_array()) else {
        return "缺少 cells 数组，如 [{{\"ref\":\"A1\",\"value\":\"x\"}}]".into();
    };
    if cells.is_empty() {
        return "cells 不能为空".into();
    }
    if cells.len() > MAX_EDIT_CELLS {
        return format!("单次最多改 {MAX_EDIT_CELLS} 格");
    }
    let path = match sandbox.resolve_write(raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let create_if_missing = args
        .get("create_if_missing")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let want_sheet = args
        .get("sheet")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    if !path.is_file() {
        if !create_if_missing {
            return format!("文件不存在: {}（可设 create_if_missing=true）", path.display());
        }
        if let Some(parent) = path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                return format!("创建目录失败: {e}");
            }
        }
        let sheet = if want_sheet.is_empty() {
            "Sheet1"
        } else {
            want_sheet
        };
        let mut grid: HashMap<(u32, u16), CellVal> = HashMap::new();
        let mut edited = 0usize;
        for (i, cell) in cells.iter().enumerate() {
            match apply_cell_edit(&mut grid, cell) {
                Ok(()) => edited += 1,
                Err(e) => return format!("cells[{i}]: {e}"),
            }
        }
        snapshot_write_path(sandbox, &path);
        if let Err(e) = write_grid_to_workbook(&path, &[(sheet.to_string(), grid.clone())]) {
            return e;
        }
        return format!(
            "✅ 已新建 Excel {}（表「{sheet}」，写入 {edited} 格）。\n{}",
            path.display(),
            preview_grid(&grid, 12)
        );
    }

    let mut workbook = match open_workbook_auto(&path) {
        Ok(w) => w,
        Err(e) => return format!("打开表格失败: {e}"),
    };
    let names = workbook.sheet_names().to_vec();
    if names.is_empty() {
        return "工作簿无工作表".into();
    }
    let target = if want_sheet.is_empty() {
        names[0].clone()
    } else if names.iter().any(|n| n == want_sheet) {
        want_sheet.to_string()
    } else {
        // 新表：先载入已有，再追加空表
        want_sheet.to_string()
    };

    let mut sheets: Vec<(String, HashMap<(u32, u16), CellVal>)> = Vec::new();
    for name in &names {
        match load_sheet_grid(&mut workbook, name) {
            Ok(g) => sheets.push((name.clone(), g)),
            Err(e) => return e,
        }
    }
    if !sheets.iter().any(|(n, _)| n == &target) {
        sheets.push((target.clone(), HashMap::new()));
    }

    let mut edited = 0usize;
    {
        let grid = match sheets.iter_mut().find(|(n, _)| n == &target) {
            Some((_, g)) => g,
            None => return "内部错误：找不到目标表".into(),
        };
        for (i, cell) in cells.iter().enumerate() {
            match apply_cell_edit(grid, cell) {
                Ok(()) => edited += 1,
                Err(e) => return format!("cells[{i}]: {e}"),
            }
        }
    }

    snapshot_write_path(sandbox, &path);
    if let Err(e) = write_grid_to_workbook(&path, &sheets) {
        return e;
    }
    let preview = sheets
        .iter()
        .find(|(n, _)| n == &target)
        .map(|(_, g)| preview_grid(g, 12))
        .unwrap_or_default();
    format!(
        "✅ 已更新 Excel {}（表「{target}」，改 {edited} 格）。注意：重建工作簿时原有格式/公式可能丢失，已保留单元格值。\n{preview}",
        path.display()
    )
}

fn apply_cell_edit(grid: &mut HashMap<(u32, u16), CellVal>, cell: &Value) -> Result<(), String> {
    let ref_s = cell
        .get("ref")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 ref（如 A1）".to_string())?;
    let (r, c) = parse_a1(ref_s)?;
    if r as usize >= MAX_ROWS || c as usize >= MAX_COLS {
        return Err("单元格超出限制".into());
    }
    if let Some(f) = cell.get("formula").and_then(|v| v.as_str()) {
        let formula = if f.trim().starts_with('=') {
            f.trim().to_string()
        } else {
            format!("={}", f.trim())
        };
        grid.insert((r, c), CellVal::Formula(formula));
        return Ok(());
    }
    let Some(val) = cell.get("value") else {
        return Err("缺少 value 或 formula".into());
    };
    let cv = if val.is_null() {
        CellVal::Empty
    } else if let Some(n) = val.as_f64() {
        CellVal::Float(n)
    } else if let Some(b) = val.as_bool() {
        CellVal::Bool(b)
    } else if let Some(s) = val.as_str() {
        CellVal::Str(s.to_string())
    } else {
        CellVal::Str(val.to_string())
    };
    if matches!(cv, CellVal::Empty) {
        grid.remove(&(r, c));
    } else {
        grid.insert((r, c), cv);
    }
    Ok(())
}

const MAX_TEMPLATE_VARS: usize = 100;
const MAX_VAR_KEY_CHARS: usize = 128;
const MAX_VAR_VAL_CHARS: usize = 4_000;

fn parse_template_vars(args: &Value) -> Result<Vec<(String, String)>, String> {
    let Some(obj) = args.get("vars").and_then(|v| v.as_object()) else {
        return Err("缺少 vars：对象，如 {\"{{公司名}}\":\"虚募阁\"}".into());
    };
    if obj.is_empty() {
        return Err("vars 为空".into());
    }
    if obj.len() > MAX_TEMPLATE_VARS {
        return Err(format!("vars 过多（> {MAX_TEMPLATE_VARS}）"));
    }
    let mut pairs: Vec<(String, String)> = Vec::with_capacity(obj.len());
    for (k, v) in obj {
        let key = k.trim();
        if key.is_empty() {
            return Err("vars 含空键".into());
        }
        if key.chars().count() > MAX_VAR_KEY_CHARS {
            return Err(format!("占位符过长（> {MAX_VAR_KEY_CHARS}）: {key}"));
        }
        let val = if let Some(s) = v.as_str() {
            s.to_string()
        } else if v.is_null() {
            String::new()
        } else {
            v.to_string()
        };
        if val.chars().count() > MAX_VAR_VAL_CHARS {
            return Err(format!("替换值过长（> {MAX_VAR_VAL_CHARS}）：{key}"));
        }
        pairs.push((key.to_string(), val));
    }
    // Longer keys first so "{{公司全称}}" beats "{{公司}}"
    pairs.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
    Ok(pairs)
}

fn apply_vars_to_text(mut text: String, vars: &[(String, String)]) -> (String, usize) {
    let mut hits = 0usize;
    for (find, replace) in vars {
        let find_esc = xml_escape(find);
        let replace_esc = xml_escape(replace);
        if text.contains(find) {
            hits += text.matches(find).count();
            text = text.replace(find, replace);
        }
        if find_esc != *find && text.contains(&find_esc) {
            hits += text.matches(find_esc.as_str()).count();
            text = text.replace(&find_esc, &replace_esc);
        }
    }
    (text, hits)
}

fn zip_entry_is_template_text(name: &str, kind: &str) -> bool {
    let n = name.replace('\\', "/");
    match kind {
        "docx" => {
            n == "word/document.xml"
                || n.starts_with("word/header")
                || n.starts_with("word/footer")
                || n == "word/footnotes.xml"
                || n == "word/endnotes.xml"
                || n == "word/comments.xml"
        }
        "xlsx" => {
            n == "xl/sharedStrings.xml"
                || (n.starts_with("xl/worksheets/") && n.ends_with(".xml"))
                || n.starts_with("xl/drawings/")
        }
        _ => false,
    }
}

fn apply_placeholders_in_ooxml(
    template_bytes: &[u8],
    vars: &[(String, String)],
    kind: &str,
) -> Result<(Vec<u8>, usize), String> {
    let cursor = Cursor::new(template_bytes);
    let mut zin = zip::ZipArchive::new(cursor).map_err(|e| format!("不是有效 OOXML/zip: {e}"))?;
    let mut out_buf: Vec<u8> = Vec::new();
    let mut total_hits = 0usize;
    {
        let mut zout = ZipWriter::new(Cursor::new(&mut out_buf));
        let opts =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for i in 0..zin.len() {
            let mut file = zin
                .by_index(i)
                .map_err(|e| format!("读 zip 条目失败: {e}"))?;
            let name = file.name().to_string();
            let mut data = Vec::new();
            use std::io::Read;
            file.read_to_end(&mut data)
                .map_err(|e| format!("读条目 {name} 失败: {e}"))?;
            if zip_entry_is_template_text(&name, kind) {
                if let Ok(s) = std::str::from_utf8(&data) {
                    let (new_s, hits) = apply_vars_to_text(s.to_string(), vars);
                    total_hits += hits;
                    data = new_s.into_bytes();
                }
            }
            zout
                .start_file(&name, opts)
                .map_err(|e| format!("写 zip 条目失败: {e}"))?;
            zout
                .write_all(&data)
                .map_err(|e| format!("写 zip 数据失败: {e}"))?;
        }
        zout
            .finish()
            .map_err(|e| format!("完成 zip 失败: {e}"))?;
    }
    Ok((out_buf, total_hits))
}

/// Duty: 复制工作区模板 docx/xlsx，按 vars 占位符替换后写出（保留版式，尽力而为）。
pub fn tool_office_apply_template(sandbox: &PathSandbox, args: &Value) -> String {
    let Some(tpl_raw) = args
        .get("template")
        .or_else(|| args.get("path"))
        .and_then(|v| v.as_str())
    else {
        return "缺少 template（工作区内 .docx/.xlsx）".into();
    };
    let Some(out_raw) = args.get("out").and_then(|v| v.as_str()) else {
        return "缺少 out（输出路径）".into();
    };
    let vars = match parse_template_vars(args) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let tpl_path = match sandbox.resolve_read(tpl_raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if !tpl_path.is_file() {
        return format!("模板不存在: {}", tpl_path.display());
    }
    let out_path = match sandbox.resolve_write(out_raw) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let tpl_ext = tpl_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let out_ext = out_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let kind = match tpl_ext.as_str() {
        "docx" => "docx",
        "xlsx" => "xlsx",
        _ => return "template 仅支持 .docx 或 .xlsx".into(),
    };
    if out_ext != tpl_ext {
        return format!("out 扩展名须与模板一致（.{tpl_ext}）");
    }
    if let Some(parent) = out_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return format!("创建目录失败: {e}");
        }
    }
    snapshot_write_path(sandbox, &out_path);
    let bytes = match std::fs::read(&tpl_path) {
        Ok(b) => b,
        Err(e) => return format!("读模板失败: {e}"),
    };
    let (out_bytes, hits) = match apply_placeholders_in_ooxml(&bytes, &vars, kind) {
        Ok(v) => v,
        Err(e) => return e,
    };
    match std::fs::write(&out_path, &out_bytes) {
        Ok(()) => {
            let note = if hits == 0 {
                "（未命中任何占位符：请确认模板里是完整连续字符串，如 {{公司名}}；若 Word 把占位符拆到多个 run，请改模板或改用 office_docx_replace）"
            } else {
                ""
            };
            format!(
                "✅ 已套用模板 → {}（替换命中约 {hits} 处，vars={}）{note}",
                out_path.display(),
                vars.len()
            )
        }
        Err(e) => format!("写出失败: {e}"),
    }
}
