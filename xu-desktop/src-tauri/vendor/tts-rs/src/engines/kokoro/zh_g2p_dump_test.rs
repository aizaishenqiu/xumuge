#[test]
fn dump_preview() {
    let t = "你好，我是虚幕阁助手，当前是御姐语气。这是一段试听。";
    let ipa = crate::engines::kokoro::zh_g2p::chinese_to_ipa(t);
    println!("OURS: {ipa}");
    assert!(!ipa.is_empty());
    assert!(ipa.contains('↓') || ipa.contains('→') || ipa.contains('↗') || ipa.contains('↘'));
}
