//! Mechanical quality checks for generated slides.
//!
//! The system prompt tells the model what "AI slop" looks like. This module is
//! how that stops being a request and becomes a rule: every slide is inspected
//! and the findings are handed straight back to the model as tool output, so it
//! can fix the slide in the same turn instead of shipping it.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// Must be fixed: the document will not render or export correctly.
    Error,
    /// Design smell: legal, but it is what generated decks look like.
    Warn,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub rule: String,
    pub severity: Severity,
    pub message: String,
}

fn warn(rule: &str, message: impl Into<String>) -> Issue {
    Issue {
        rule: rule.into(),
        severity: Severity::Warn,
        message: message.into(),
    }
}

fn error(rule: &str, message: impl Into<String>) -> Issue {
    Issue {
        rule: rule.into(),
        severity: Severity::Error,
        message: message.into(),
    }
}

fn lower(html: &str) -> String {
    html.to_lowercase()
}

fn strip_style_and_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    // Drop <style>…</style>
    loop {
        let Some(start) = rest.to_lowercase().find("<style") else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..start]);
        let Some(end) = rest[start..].to_lowercase().find("</style>") else {
            break;
        };
        rest = &rest[start + end + 8..];
    }
    // Drop remaining tags.
    let mut text = String::new();
    let mut inside = false;
    for ch in out.chars() {
        match ch {
            '<' => inside = true,
            '>' => inside = false,
            c if !inside => text.push(c),
            _ => {}
        }
    }
    text
}

fn hex_colors(html: &str) -> Vec<(u8, u8, u8)> {
    let bytes: Vec<char> = html.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == '#' {
            let take = |start: usize, len: usize| -> Option<String> {
                let slice: String = bytes.get(start..start + len)?.iter().collect();
                if slice.chars().all(|c| c.is_ascii_hexdigit()) {
                    Some(slice)
                } else {
                    None
                }
            };
            if let Some(six) = take(i + 1, 6) {
                let r = u8::from_str_radix(&six[0..2], 16).ok();
                let g = u8::from_str_radix(&six[2..4], 16).ok();
                let b = u8::from_str_radix(&six[4..6], 16).ok();
                if let (Some(r), Some(g), Some(b)) = (r, g, b) {
                    out.push((r, g, b));
                    i += 7;
                    continue;
                }
            }
            if let Some(three) = take(i + 1, 3) {
                let expand = |c: &str| u8::from_str_radix(&c.repeat(2), 16).ok();
                if let (Some(r), Some(g), Some(b)) = (
                    expand(&three[0..1]),
                    expand(&three[1..2]),
                    expand(&three[2..3]),
                ) {
                    out.push((r, g, b));
                    i += 4;
                    continue;
                }
            }
        }
        i += 1;
    }
    out
}

/// Hue in degrees, for the "purple-blue gradient" check.
fn hue((r, g, b): (u8, u8, u8)) -> f32 {
    let (r, g, b) = (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let d = max - min;
    if d.abs() < f32::EPSILON {
        return 0.0;
    }
    let h = if (max - r).abs() < f32::EPSILON {
        60.0 * (((g - b) / d) % 6.0)
    } else if (max - g).abs() < f32::EPSILON {
        60.0 * ((b - r) / d + 2.0)
    } else {
        60.0 * ((r - g) / d + 4.0)
    };
    if h < 0.0 {
        h + 360.0
    } else {
        h
    }
}

fn saturation((r, g, b): (u8, u8, u8)) -> f32 {
    let (r, g, b) = (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    if max <= 0.0 {
        return 0.0;
    }
    (max - min) / max
}

fn numbers_after(html: &str, needle: &str) -> Vec<f32> {
    let mut out = Vec::new();
    let hay = html.to_lowercase();
    let mut from = 0;
    while let Some(pos) = hay[from..].find(needle) {
        let start = from + pos + needle.len();
        let tail: String = hay[start..].chars().take(24).collect();
        let digits: String = tail
            .chars()
            .skip_while(|c| !c.is_ascii_digit() && *c != '.')
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        if let Ok(v) = digits.parse::<f32>() {
            out.push(v);
        }
        from = start;
    }
    out
}

fn count(hay: &str, needle: &str) -> usize {
    hay.matches(needle).count()
}

/// Canvas size for an aspect id, matching the frontend.
pub fn canvas(aspect: &str) -> (f32, f32) {
    match aspect {
        "1:1" => (1080.0, 1080.0),
        "9:16" => (1080.0, 1920.0),
        _ => (1080.0, 1350.0),
    }
}

/// Inspects one slide. `w`/`h` are the canvas dimensions for this deck.
pub fn lint(html: &str, w: f32, h: f32) -> Vec<Issue> {
    let mut issues = Vec::new();
    if html.trim().is_empty() {
        return vec![error("empty", "HTML kosong.")];
    }
    let hay = lower(html);

    /* ---- hard rules ---------------------------------------------------- */

    if hay.contains("<script") {
        issues.push(error("no-script", "Ada <script>. Slide harus statis."));
    }
    if hay.contains("@import") {
        issues.push(error(
            "no-import",
            "Ada @import font/CSS. Font eksternal tidak akan load.",
        ));
    }
    for needle in ["src=\"http", "src='http", "href=\"http", "href='http", "url(http", "url('http", "url(\"http"] {
        if hay.contains(needle) {
            issues.push(error(
                "external-asset",
                "Ada aset eksternal (http). Gambar harus CSS atau inline SVG.",
            ));
            break;
        }
    }
    if hay.contains("position:fixed") || hay.contains("position: fixed") {
        issues.push(error(
            "no-fixed",
            "position:fixed dilarang; pakai position:absolute di dalam kanvas.",
        ));
    }

    let has_w = numbers_after(html, "width:").iter().any(|v| (*v - w).abs() < 1.0);
    let has_h = numbers_after(html, "height:").iter().any(|v| (*v - h).abs() < 1.0);
    if !(has_w && has_h) {
        issues.push(warn(
            "canvas-size",
            format!("Kanvas tidak dinyatakan eksplisit (harus {w:.0}×{h:.0}px di body)."),
        ));
    }
    if numbers_after(html, "margin:").is_empty() && !hay.contains("margin") {
        issues.push(warn("no-reset", "Tidak ada reset margin; body akan menyisakan tepi putih."));
    }

    /* ---- design smells ------------------------------------------------- */

    let colors = hex_colors(html);
    let mut distinct: Vec<(u8, u8, u8)> = Vec::new();
    for c in &colors {
        if !distinct.contains(c) {
            distinct.push(*c);
        }
    }
    if distinct.len() > 7 {
        issues.push(warn(
            "too-many-colors",
            format!(
                "{} warna berbeda. Palet harus maksimal 3 warna + 1 aksen.",
                distinct.len()
            ),
        ));
    }
    let purples = colors
        .iter()
        .filter(|c| {
            let h = hue(**c);
            (232.0..=292.0).contains(&h) && saturation(**c) > 0.25
        })
        .count();
    if purples >= 2 && (hay.contains("linear-gradient") || hay.contains("radial-gradient")) {
        issues.push(warn(
            "purple-blue",
            "Ada gradient ungu/biru. Itu tanda paling khas desain AI.",
        ));
    }
    let emojis = strip_style_and_tags(html).chars().filter(|c| {
        matches!(*c as u32, 0x1F300..=0x1FAFF | 0x2600..=0x27BF | 0x1F000..=0x1F2FF)
    }).count();
    if emojis > 0 {
        issues.push(warn(
            "emoji",
            format!("{emojis} emoji di dalam slide. Pakai bentuk/ikon SVG."),
        ));
    }

    let texture = hay.contains("feturbulence")
        || hay.contains("repeating-linear-gradient")
        || hay.contains("repeating-radial-gradient")
        || hay.contains("repeating-conic-gradient")
        || hay.contains("data:image/svg+xml")
        || (hay.contains("radial-gradient") && hay.contains("background-size"));
    if !texture {
        issues.push(warn(
            "no-texture",
            "Tidak ada tekstur (grain/halftone/paper). Kanvas polos terasa generat.",
        ));
    }

    let centered = count(&hay, "text-align:center")
        + count(&hay, "text-align: center")
        + count(&hay, "align-items:center")
        + count(&hay, "align-items: center")
        + count(&hay, "justify-content:center")
        + count(&hay, "justify-content: center")
        + count(&hay, "place-items:center")
        + count(&hay, "margin:0 auto")
        + count(&hay, "margin: 0 auto");
    if centered >= 4 {
        issues.push(warn(
            "centered",
            format!("{centered} elemen dipusatkan. Hierarki nyata butuh ketegangan, bukan simetri."),
        ));
    }

    let radii: Vec<f32> = numbers_after(html, "border-radius:");
    let big_uniform = radii.iter().filter(|v| **v >= 8.0).count();
    if radii.len() >= 4 && big_uniform >= 3 {
        let first = radii[0];
        if radii.iter().filter(|v| (**v - first).abs() < 0.6).count() >= 3 {
            issues.push(warn(
                "uniform-radius",
                "Banyak elemen ber-radius sama. Kartu seragam = template, bukan desain.",
            ));
        }
    }

    let font_sizes = numbers_after(html, "font-size:");
    let max_font = font_sizes.iter().cloned().fold(0.0f32, f32::max);
    let reference = w;
    if max_font < reference * 0.085 {
        issues.push(warn(
            "no-dominance",
            format!(
                "Teks terbesar cuma {max_font:.0}px di kanvas {w:.0}px. Tidak ada elemen yang jelas dominan."
            ),
        ));
    }

    let body_text = strip_style_and_tags(html);
    let chars = body_text.split_whitespace().collect::<Vec<_>>().join(" ").chars().count();
    if chars > 900 {
        issues.push(warn(
            "text-wall",
            format!("{chars} karakter teks. Satu slide satu ide; sisanya pindah ke slide lain."),
        ));
    }

    let shadows = count(&hay, "box-shadow");
    if shadows >= 3 {
        issues.push(warn(
            "soft-shadows",
            "Banyak box-shadow generik. Pakai satu bayangan tegas atau tidak sama sekali.",
        ));
    }

    let has_svg = hay.contains("<svg");
    let has_art = hay.contains("linear-gradient") || hay.contains("radial-gradient") || hay.contains("conic-gradient");
    if !has_svg && !has_art && !texture && chars < 420 && max_font < reference * 0.12 {
        issues.push(warn(
            "empty",
            "Slide terasa kosong: tanpa artwork, tanpa tekstur, tanpa tipografi besar, tanpa banyak teks.",
        ));
    }

    issues
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideLint {
    pub slide_id: String,
    pub issues: Vec<Issue>,
}

/// Every slide in a deck, in order.
pub fn lint_deck(deck: &crate::model::Deck) -> Vec<SlideLint> {
    let (w, h) = canvas(&deck.aspect);
    deck.slides
        .iter()
        .map(|s| SlideLint {
            slide_id: s.id.clone(),
            issues: lint(&s.html, w, h),
        })
        .collect()
}

/// Compact form for tool output.
pub fn summarise(issues: &[Issue]) -> String {
    issues
        .iter()
        .map(|i| {
            let tag = if i.severity == Severity::Error { "ERROR" } else { "saran" };
            format!("- [{tag}] {}: {}", i.rule, i.message)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = r#"<!doctype html><html><head><style>
        html,body{margin:0;width:1080px;height:1350px;overflow:hidden;background:#0d0c0b;color:#f2ece1}
        .grain{position:absolute;inset:0;opacity:.12;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.8'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
        .rule{position:absolute;left:96px;right:96px;top:110px;height:1px;background:#f2ece133}
        h1{position:absolute;left:92px;top:250px;margin:0;width:880px;font-size:150px;line-height:.92;color:#f2ece1}
        h1 em{color:#b8412f}
        .foot{position:absolute;left:96px;bottom:96px;font-size:22px;color:#6d655c}
    </style></head><body>
        <div class="grain"></div><div class="rule"></div>
        <h1>Kerja bagus<br><em>tidak</em> cukup.</h1>
        <div class="foot">Desel Studio</div>
    </body></html>"#;

    #[test]
    fn a_crafted_editorial_slide_passes_clean() {
        let issues = lint(GOOD, 1080.0, 1350.0);
        assert!(issues.is_empty(), "{}", summarise(&issues));
    }

    #[test]
    fn the_example_shown_to_the_model_passes_review() {
        // The worked example in the system prompt is what the model imitates, so
        // it has to satisfy the same rules its own output is judged by.
        let issues = lint(crate::agent::EXAMPLE_SLIDE, 1080.0, 1350.0);
        assert!(issues.is_empty(), "contoh di prompt gagal: {}", summarise(&issues));
    }

    #[test]
    fn the_assembled_prompt_contains_the_example_once() {
        let prompt = crate::agent::system_prompt();
        assert_eq!(prompt.matches(crate::agent::EXAMPLE_SLIDE).count(), 1);
        assert!(prompt.contains("Kerangka yang lolos"));
        assert!(prompt.contains("Pemeriksaan otomatis"));
    }

    #[test]
    fn catches_the_classic_ai_slop_slide() {
        let slop = r#"<!doctype html><html><body style="margin:0;width:1080px;height:1350px;background:linear-gradient(#6a5cff,#3aa0ff)">
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
          <h1 style="text-align:center;font-size:64px;color:#7b61ff">5 Tips Produktivitas 🚀</h1>
          <div style="border-radius:16px;background:#8b5cf6;box-shadow:0 10px 30px #0003">A</div>
          <div style="border-radius:16px;background:#a78bfa;box-shadow:0 10px 30px #0003">B</div>
          <div style="border-radius:16px;background:#c4b5fd;box-shadow:0 10px 30px #0003">C</div>
          <p style="text-align:center">Belajar hal baru setiap hari agar kamu bisa jadi lebih produktif dan lebih baik lagi dari sebelumnya.</p>
        </div></body></html>"#;
        let issues = lint(slop, 1080.0, 1350.0);
        let rules: Vec<&str> = issues.iter().map(|i| i.rule.as_str()).collect();
        for expected in ["purple-blue", "emoji", "no-texture", "centered", "no-dominance"] {
            assert!(rules.contains(&expected), "harus menandai {expected}, dapat {rules:?}");
        }
    }

    #[test]
    fn rejects_executable_and_external_content() {
        let bad = r#"<html><body style="margin:0;width:1080px;height:1350px">
            <script>alert(1)</script><img src="https://example.com/a.png">
            <style>@import url("https://fonts.googleapis.com/css2?family=Inter")</style>
        </body></html>"#;
        let issues = lint(bad, 1080.0, 1350.0);
        let rules: Vec<&str> = issues.iter().map(|i| i.rule.as_str()).collect();
        for expected in ["no-script", "external-asset", "no-import"] {
            assert!(rules.contains(&expected), "harus menandai {expected}, dapat {rules:?}");
        }
        assert!(issues.iter().any(|i| i.severity == Severity::Error));
    }


    #[test]
    fn a_big_type_cta_with_texture_is_not_empty() {
        let cta = r#"<!doctype html><html><head><style>
            html,body{margin:0;width:1080px;height:1350px;overflow:hidden;background:#0d0c0b;color:#f2ece1}
            .grain{position:absolute;inset:0;opacity:.14;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
            h1{position:absolute;left:88px;top:300px;margin:0;font-size:120px;line-height:.94}
            .cta{position:absolute;left:96px;bottom:180px;font-size:26px;background:#f2ece1;color:#0d0c0b;padding:22px 34px}
        </style></head><body><div class="grain"></div><h1>Simpan ini<br>untuk nanti.</h1><div class="cta">Save this post</div></body></html>"#;
        let issues = lint(cta, 1080.0, 1350.0);
        let rules: Vec<&str> = issues.iter().map(|i| i.rule.as_str()).collect();
        assert!(!rules.contains(&"empty"), "CTA bertipografi besar bukan slide kosong: {}", summarise(&issues));
    }
    #[test]
    fn flags_canvas_size_mismatch() {
        let issues = lint("<html><body style=\"margin:0;width:1080px;height:1920px\">x</body></html>", 1080.0, 1350.0);
        let rules: Vec<&str> = issues.iter().map(|i| i.rule.as_str()).collect();
        assert!(rules.contains(&"canvas-size"), "{rules:?}");
    }
}
