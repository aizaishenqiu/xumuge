//! Mandarin G2P aligned with misaki `ZHG2P` legacy (pinyin → IPA + tone arrows).
//!
//! Kokoro `zf_*` / `zm_*` voices expect these phonemes; raw espeak-ng IPA is wrong.

use pinyin::ToPinyin;

/// Convert Mandarin (and mixed punctuation) text to Kokoro phoneme string.
pub fn chinese_to_ipa(text: &str) -> String {
    let text = map_punctuation(text.trim());
    if text.is_empty() {
        return String::new();
    }

    let mut out = String::new();
    let mut zh_buf = String::new();

    let flush_zh = |buf: &mut String, out: &mut String| {
        if buf.is_empty() {
            return;
        }
        let ipa = zh_segment_to_ipa(buf);
        if !ipa.is_empty() {
            if !out.is_empty()
                && !out.ends_with(|c: char| c.is_whitespace() || matches!(c, ',' | '.' | '!' | '?' | ':' | ';'))
            {
                // 中文段与前一段之间留空格（对齐 misaki 分词空格）
                if !out.ends_with(' ') {
                    out.push(' ');
                }
            }
            out.push_str(&ipa);
        }
        buf.clear();
    };

    for ch in text.chars() {
        if is_cjk(ch) {
            zh_buf.push(ch);
            continue;
        }
        flush_zh(&mut zh_buf, &mut out);
        if ch.is_whitespace() {
            if !out.is_empty() && !out.ends_with(' ') {
                out.push(' ');
            }
        } else {
            out.push(ch);
        }
    }
    flush_zh(&mut zh_buf, &mut out);
    out.replace('\u{032f}', "").trim().to_string()
}

fn is_cjk(ch: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&ch)
}

fn map_punctuation(text: &str) -> String {
    text.replace('、', ", ")
        .replace('，', ", ")
        .replace('。', ". ")
        .replace('．', ". ")
        .replace('！', "! ")
        .replace('：', ": ")
        .replace('；', "; ")
        .replace('？', "? ")
        .replace('«', " “")
        .replace('»', "” ")
        .replace('《', " “")
        .replace('》', "” ")
        .replace('「', " “")
        .replace('」', "” ")
        .replace('【', " “")
        .replace('】', "” ")
        .replace('（', " (")
        .replace('）', ") ")
}

fn zh_segment_to_ipa(segment: &str) -> String {
    let mut ipa = String::new();
    for ch in segment.chars() {
        if let Some(py) = ch.to_pinyin() {
            let tone3 = py.with_tone_num_end();
            if let Some(s) = pinyin_tone3_to_ipa(&tone3) {
                // 音节间空格 ≈ misaki 分词空格，利于 Kokoro 停顿与咬字
                if !ipa.is_empty() {
                    ipa.push(' ');
                }
                ipa.push_str(&s);
            }
        }
    }
    ipa
}

fn retone(p: &str) -> String {
    p.replace("˧˩˧", "↓")
        .replace("˧˥", "↗")
        .replace("˥˩", "↘")
        .replace("˥", "→")
        .replace("ɻ\u{0329}", "ɨ")
        .replace("ɹ\u{0329}", "ɨ")
}

fn tone_mark(tone: u8) -> &'static str {
    match tone {
        1 => "˥",
        2 => "˧˥",
        3 => "˧˩˧",
        4 => "˥˩",
        _ => "",
    }
}

fn apply_tone_phonemes(parts: &[&str], tone: u8) -> String {
    let mark = tone_mark(tone);
    parts
        .iter()
        .map(|p| p.replace('0', mark))
        .collect::<String>()
}

fn pinyin_tone3_to_ipa(py: &str) -> Option<String> {
    let py = py.trim();
    if py.is_empty() {
        return None;
    }
    let (body, tone) = split_tone3(py)?;
    let mut normal = body.replace('v', "ü").replace('V', "ü");

    // j/q/x + u → ü（除 ua/uo/uai…）
    if matches!(normal.chars().next(), Some('j' | 'q' | 'x')) {
        let prefix = normal.chars().next().unwrap();
        let rest: String = normal.chars().skip(1).collect();
        if rest.starts_with('u')
            && !rest.starts_with("ua")
            && !rest.starts_with("uo")
            && !rest.starts_with("uai")
            && !rest.starts_with("uei")
            && !rest.starts_with("uen")
            && !rest.starts_with("uang")
            && !rest.starts_with("ueng")
        {
            normal = format!("{prefix}ü{}", &rest[1..]);
        }
    }

    if let Some(parts) = interjection(&normal) {
        return Some(finish_ipa(parts, tone));
    }
    if let Some(parts) = syllabic(&normal) {
        return Some(finish_ipa(parts, tone));
    }

    let (initial, final_) = split_initial_final(&normal)?;
    let mut phones: Vec<&str> = Vec::new();
    if !initial.is_empty() {
        phones.extend_from_slice(initial_ipa(&initial)?);
    }
    let fin = if matches!(initial.as_str(), "zh" | "ch" | "sh" | "r") && final_ == "i" {
        &["ɻ\u{0329}0"][..]
    } else if matches!(initial.as_str(), "z" | "c" | "s") && final_ == "i" {
        &["ɹ\u{0329}0"][..]
    } else {
        final_ipa(rewrite_final(&initial, &final_))?
    };
    phones.extend_from_slice(fin);
    Some(finish_ipa(&phones, tone))
}

fn finish_ipa(parts: &[&str], tone: u8) -> String {
    retone(&apply_tone_phonemes(parts, tone)).replace('\u{032f}', "")
}

fn split_tone3(py: &str) -> Option<(&str, u8)> {
    let last = py.chars().last()?;
    if last.is_ascii_digit() {
        let tone = last.to_digit(10)? as u8;
        let body = &py[..py.len() - last.len_utf8()];
        if body.is_empty() {
            return None;
        }
        Some((body, tone.clamp(1, 5)))
    } else {
        Some((py, 5))
    }
}

fn rewrite_final<'a>(initial: &str, final_: &'a str) -> &'a str {
    match (initial, final_) {
        (_, "iu") => "iou",
        (_, "ui") => "uei",
        ("j" | "q" | "x", "un") => "ün",
        ("j" | "q" | "x", "u") => "ü",
        ("j" | "q" | "x", "ue") => "üe",
        ("j" | "q" | "x", "uan") => "üan",
        (i, "un") if !i.is_empty() => "uen",
        _ => final_,
    }
}

fn split_initial_final(normal: &str) -> Option<(String, String)> {
    static INITIALS: &[&str] = &[
        "zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x",
        "z", "c", "s", "r",
    ];
    for ini in INITIALS {
        if let Some(rest) = normal.strip_prefix(ini) {
            if !rest.is_empty() {
                return Some(((*ini).to_string(), rest.to_string()));
            }
        }
    }
    if let Some(rest) = normal.strip_prefix('w') {
        let final_ = match rest {
            "a" => "ua",
            "ai" => "uai",
            "an" => "uan",
            "ang" => "uang",
            "eng" => "ueng",
            "o" => "uo",
            "u" => "u",
            "ei" => "uei",
            "en" => "uen",
            other => other,
        };
        return Some((String::new(), final_.to_string()));
    }
    if let Some(rest) = normal.strip_prefix('y') {
        let final_ = match rest {
            "i" | "" => "i",
            "a" => "ia",
            "an" => "ian",
            "ang" => "iang",
            "ao" => "iao",
            "e" => "ie",
            "ong" => "iong",
            "ou" => "iou",
            "u" => "ü",
            "ue" => "üe",
            "uan" => "üan",
            "un" => "ün",
            "in" => "in",
            "ing" => "ing",
            other => other,
        };
        return Some((String::new(), final_.to_string()));
    }
    Some((String::new(), normal.to_string()))
}

fn initial_ipa(initial: &str) -> Option<&'static [&'static str]> {
    Some(match initial {
        "b" => &["p"],
        "c" => &["ʦʰ"],
        "ch" => &["\u{AB67}ʰ"],
        "d" => &["t"],
        "f" => &["f"],
        "g" => &["k"],
        "h" => &["x"],
        "j" => &["ʨ"],
        "k" => &["kʰ"],
        "l" => &["l"],
        "m" => &["m"],
        "n" => &["n"],
        "p" => &["pʰ"],
        "q" => &["ʨʰ"],
        "r" => &["ɻ"],
        "s" => &["s"],
        "sh" => &["ʂ"],
        "t" => &["tʰ"],
        "x" => &["ɕ"],
        "z" => &["ʦ"],
        "zh" => &["\u{AB67}"],
        _ => return None,
    })
}

fn final_ipa(final_: &str) -> Option<&'static [&'static str]> {
    Some(match final_ {
        "a" => &["a0"],
        "ai" => &["ai̯0"],
        "an" => &["a0", "n"],
        "ang" => &["a0", "ŋ"],
        "ao" => &["au̯0"],
        "e" => &["ɤ0"],
        "ei" => &["ei̯0"],
        "en" => &["ə0", "n"],
        "eng" => &["ə0", "ŋ"],
        "i" => &["i0"],
        "ia" => &["j", "a0"],
        "ian" => &["j", "ɛ0", "n"],
        "iang" => &["j", "a0", "ŋ"],
        "iao" => &["j", "au̯0"],
        "ie" => &["j", "e0"],
        "in" => &["i0", "n"],
        "iou" => &["j", "ou̯0"],
        "ing" => &["i0", "ŋ"],
        "iong" => &["j", "ʊ0", "ŋ"],
        "ong" => &["ʊ0", "ŋ"],
        "ou" => &["ou̯0"],
        "u" => &["u0"],
        "uei" => &["w", "ei̯0"],
        "ua" => &["w", "a0"],
        "uai" => &["w", "ai̯0"],
        "uan" => &["w", "a0", "n"],
        "uen" => &["w", "ə0", "n"],
        "uang" => &["w", "a0", "ŋ"],
        "ueng" => &["w", "ə0", "ŋ"],
        "uo" | "o" => &["w", "o0"],
        "ü" => &["y0"],
        "üe" => &["ɥ", "e0"],
        "üan" => &["ɥ", "ɛ0", "n"],
        "ün" => &["y0", "n"],
        "er" => &["ɚ0"],
        "ê" => &["ɛ0"],
        _ => return None,
    })
}

fn interjection(normal: &str) -> Option<&'static [&'static str]> {
    match normal {
        "io" => Some(&["j", "ɔ0"]),
        "ê" => Some(&["ɛ0"]),
        "er" => Some(&["ɚ0"]),
        "o" => Some(&["ɔ0"]),
        _ => None,
    }
}

fn syllabic(normal: &str) -> Option<&'static [&'static str]> {
    match normal {
        "hm" => Some(&["h", "m0"]),
        "hng" => Some(&["h", "ŋ0"]),
        "m" => Some(&["m0"]),
        "n" => Some(&["n0"]),
        "ng" => Some(&["ŋ0"]),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nihao() {
        assert_eq!(chinese_to_ipa("你好"), "ni↓ xau↓");
    }

    #[test]
    fn xumuge() {
        assert_eq!(zh_segment_to_ipa("虚幕阁"), "ɕy→ mu↘ kɤ↗");
    }

    #[test]
    fn shiting() {
        assert_eq!(zh_segment_to_ipa("试听"), "ʂɨ↘ tʰi→ŋ");
    }

    #[test]
    fn preview_sentence_has_tones() {
        let t = "你好，我是虚幕阁助手，当前是御姐语气。这是一段试听。";
        let ipa = chinese_to_ipa(t);
        eprintln!("OURS: {ipa}");
        assert!(ipa.contains("ni↓"));
        assert!(ipa.contains("xau↓"));
        assert!(ipa.contains("ɕy→"));
        assert!(ipa.contains("ʂɨ↘") || ipa.contains("ɻ"));
    }
}
