//! Keyword Top-K scoring for memory injection (no FTS5 — rusqlite is bundled without it).

const STOP: &[&str] = &[
    "the", "and", "for", "with", "this", "that", "from", "please", "你", "我", "的", "了", "是",
    "在", "和", "与", "请", "把", "将", "一下", "这个", "那个",
];

/// Split a task hint into searchable tokens (latin words + CJK 2/3-grams).
pub fn tokenize_query(hint: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut latin = String::new();
    let mut cjk = String::new();
    let flush_latin = |buf: &mut String, out: &mut Vec<String>| {
        let w = buf.trim().to_lowercase();
        buf.clear();
        if w.chars().count() < 2 {
            return;
        }
        if STOP.iter().any(|s| *s == w) {
            return;
        }
        if !out.iter().any(|x| x == &w) {
            out.push(w);
        }
    };
    let flush_cjk = |buf: &mut String, out: &mut Vec<String>| {
        let s = std::mem::take(buf);
        let chars: Vec<char> = s.chars().filter(|c| !c.is_whitespace()).collect();
        if chars.is_empty() {
            return;
        }
        if chars.len() == 1 {
            let t = chars[0].to_string();
            if !STOP.iter().any(|s| *s == t) && !out.iter().any(|x| x == &t) {
                out.push(t);
            }
            return;
        }
        for n in [2usize, 3] {
            if chars.len() < n {
                continue;
            }
            for i in 0..=chars.len() - n {
                let gram: String = chars[i..i + n].iter().collect();
                if STOP.iter().any(|s| *s == gram) {
                    continue;
                }
                if !out.iter().any(|x| x == &gram) {
                    out.push(gram);
                }
            }
        }
    };
    for ch in hint.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            if !cjk.is_empty() {
                flush_cjk(&mut cjk, &mut out);
            }
            latin.push(ch);
        } else if is_cjk(ch) {
            if !latin.is_empty() {
                flush_latin(&mut latin, &mut out);
            }
            cjk.push(ch);
        } else {
            if !latin.is_empty() {
                flush_latin(&mut latin, &mut out);
            }
            if !cjk.is_empty() {
                flush_cjk(&mut cjk, &mut out);
            }
        }
    }
    if !latin.is_empty() {
        flush_latin(&mut latin, &mut out);
    }
    if !cjk.is_empty() {
        flush_cjk(&mut cjk, &mut out);
    }
    out.truncate(48);
    out
}

fn is_cjk(ch: char) -> bool {
    matches!(ch as u32,
        0x4E00..=0x9FFF
            | 0x3400..=0x4DBF
            | 0xF900..=0xFAFF
            | 0x3040..=0x30FF
    )
}

/// Higher is better. Tokens should already be lowercased where applicable.
pub fn score_haystack(hay: &str, tokens: &[String], pinned: bool, tags: &str) -> i32 {
    if tokens.is_empty() {
        return if pinned { 20 } else { 0 };
    }
    let hay_l = hay.to_lowercase();
    let mut s = 0i32;
    for t in tokens {
        let q = t.to_lowercase();
        if q.is_empty() {
            continue;
        }
        if hay_l.contains(&q) {
            let n = q.chars().count();
            s += if n >= 4 {
                14
            } else if n >= 2 {
                8
            } else {
                3
            };
        }
    }
    if pinned {
        s += 25;
    }
    let tags_l = tags.to_lowercase();
    if tags_l.contains("constraint") {
        s += 12;
    }
    if tags_l.contains("decision") {
        s += 10;
    }
    if tags_l.contains("pref") {
        s += 8;
    }
    if tags_l.contains("playbook") {
        s += 6;
    }
    if tags_l.contains("outline") {
        // 用户大脑：问题大纲优先于普通事实，便于跨会话续聊
        s += 16;
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenizes_cjk_and_latin() {
        let toks = tokenize_query("确认技术方案后开始写 login 页");
        assert!(toks
            .iter()
            .any(|t| t.contains("技术") || t.contains("方案")));
        assert!(toks.iter().any(|t| t == "login"));
    }

    #[test]
    fn scores_matching_chunk_higher() {
        let toks = tokenize_query("登录页用中文文案");
        let hit = score_haystack(
            "交付必须用中文。登录页文案已拍板。",
            &toks,
            false,
            "decision",
        );
        let miss = score_haystack("改了一下 Dockerfile", &toks, false, "");
        assert!(hit > miss);
    }
}
