fn main() {
    use pinyin::ToPinyin;
    for c in "你好虚幕阁助手御姐语气试听".chars() {
        if let Some(py) = c.to_pinyin() {
            println!("{} {}", c, py.with_tone_num_end());
        }
    }
}
