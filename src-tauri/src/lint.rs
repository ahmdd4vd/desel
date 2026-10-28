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
    html.to_ascii_lowercase()
}

fn strip_style_and_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    // Drop <style>…</style>
    loop {
        let Some(start) = rest.to_ascii_lowercase().find("<style") else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..start]);
        let Some(end) = rest[start..].to_ascii_lowercase().find("</style>") else {
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
    let hay = html.to_ascii_lowercase();
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
        "16:9" => (1920.0,1080.0),
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

    // Decoration can invert the claim even when every word is sourced.
    // Conservative warning, not a semantic correctness verdict.
    if hay.contains("line-through") || hay.contains("strike:after") || hay.contains("strike::after") || hay.contains("<s>") || hay.contains("<del") {
        issues.push(warn("semantic-decoration", "Coretan/penghapusan dapat membalik makna, terutama tanpa/tidak/no/without. Periksa kalimat yang dibaca dari render; hapus dekorasi bila negasi menjadi ambigu. Ini peringatan, bukan bukti klaim salah."));
    }

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
                "Aset remote (http) gagal diunduh otomatis; slide bisa tampil tanpa gambar saat diekspor. Ganti dengan URL lain atau artwork CSS/SVG.",
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

    /* ---- layout: text-on-text collisions (heuristic) -------------------- */
    for issue in overlap_issues(html, w) {
        issues.push(issue);
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


/* --------------------------------------------------------------------------
 * Text overlap heuristic.
 *
 * Slides position almost everything with `position:absolute` rules inside
 * <style>. A string linter cannot run layout, but it can estimate boxes well
 * enough to catch the gross failure: two readable text blocks occupying the
 * same space. Conservative by design - it only fires when both elements are
 * absolutely positioned with explicit top/left/font-size, ghost-type and tiny
 * labels are ignored, and anything ambiguous (right/bottom anchoring, nested
 * markup games) is skipped rather than guessed.
 * ------------------------------------------------------------------------ */

#[derive(Default, Clone)]
struct TextBox {
    left: f32,
    top: f32,
    width: f32,
    height: f32,
    font_size: f32,
    text: String,
}

fn decls(block: &str) -> Vec<(String, String)> {
    block
        .split(';')
        .filter_map(|d| {
            let (k, v) = d.split_once(':')?;
            Some((k.trim().to_lowercase(), v.trim().to_lowercase()))
        })
        .collect()
}

fn px(v: &str) -> Option<f32> {
    v.trim().trim_end_matches("px").trim().parse::<f32>().ok()
}

/// Simple selectors only: `.class`, `tag`, or `tag.class`.
fn style_rules(html: &str) -> Vec<(String, Vec<(String, String)>)> {
    let mut rules = Vec::new();
    let lc = html.to_ascii_lowercase();
    let mut search_from = 0usize;
    while let Some(off) = lc[search_from..].find("<style") {
        let start = search_from + off;
        let Some(open_end) = lc[start..].find('>') else { break };
        let content_start = start + open_end + 1;
        let Some(close) = lc[content_start..].find("</style>") else { break };
        let css = &html[content_start..content_start + close];
        for rule in css.split('}') {
            let Some((sel, body)) = rule.split_once('{') else { continue };
            let sel = sel.trim().to_lowercase();
            if sel.is_empty()
                || sel.contains(|c: char| c == ' ' || c == ',' || c == ':' || c == '@' || c == '>' || c == '+')
            {
                continue;
            }
            rules.push((sel, decls(body)));
        }
        search_from = content_start + close + 8;
    }
    rules
}

fn matching_props(
    rules: &[(String, Vec<(String, String)>)],
    tag: &str,
    classes: &[String],
    inline: &str,
) -> Vec<(String, String)> {
    let mut props: Vec<(String, String)> = Vec::new();
    let mut apply = |list: &[(String, String)], props: &mut Vec<(String, String)>| {
        for (k, v) in list {
            props.retain(|(pk, _)| pk != k);
            props.push((k.clone(), v.clone()));
        }
    };
    for (sel, list) in rules {
        let hit = if let Some(cls) = sel.strip_prefix('.') {
            classes.iter().any(|c| c == cls)
        } else if let Some((t, cls)) = sel.split_once('.') {
            t == tag && classes.iter().any(|c| c == cls)
        } else {
            *sel == tag
        };
        if hit {
            apply(list, &mut props);
        }
    }
    apply(&decls(inline), &mut props);
    props
}

fn color_alpha(v: &str) -> Option<f32> {
    let v = v.trim();
    if let Some(hex) = v.strip_prefix('#') {
        if hex.len() == 8 {
            return u8::from_str_radix(&hex[6..8], 16).ok().map(|a| a as f32 / 255.0);
        }
        return None;
    }
    if v.starts_with("rgba") {
        let inner = v.trim_start_matches("rgba").trim_matches(|c| c == '(' || c == ')');
        return inner.split(',').nth(3).and_then(|a| a.trim().parse::<f32>().ok());
    }
    None
}

fn text_boxes(html: &str, canvas_w: f32) -> Vec<TextBox> {
    let rules = style_rules(html);
    let mut boxes = Vec::new();
    let lower = html.to_ascii_lowercase();
    let tags = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "li", "a", "blockquote", "pre", "div"];
    let mut i = 0usize;
    while i < lower.len() {
        if lower.as_bytes()[i] != b'<' {
            i += 1;
            continue;
        }
        let rest = &lower[i + 1..];
        let tag = tags.iter().find(|t| {
            rest.starts_with(*t)
                && rest[t.len()..].starts_with(|c: char| c == ' ' || c == '>' || c == '\t' || c == '\n')
        });
        let Some(tag) = tag else {
            i += 1;
            continue;
        };
        let Some(gt) = rest.find('>') else { break };
        let attrs = &rest[tag.len()..gt];
        let get_attr = |name: &str, attrs: &str| -> String {
            for m in attrs.match_indices(name) {
                let after = &attrs[m.0 + name.len()..];
                let after = after.trim_start();
                if let Some(stripped) = after.strip_prefix('=') {
                    let stripped = stripped.trim_start();
                    if let Some(q) = stripped.chars().next() {
                        if q == '"' || q == '\'' {
                            if let Some(end) = stripped[1..].find(q) {
                                return stripped[1..1 + end].to_string();
                            }
                        }
                    }
                }
            }
            String::new()
        };
        let class_attr = get_attr("class", attrs);
        let inline = get_attr("style", attrs);
        let classes: Vec<String> = class_attr.split_whitespace().map(|s| s.to_lowercase()).collect();
        let props = matching_props(&rules, tag, &classes, &inline);

        let get = |k: &str| props.iter().find(|(pk, _)| pk == k).map(|(_, v)| v.clone());
        let absolute = get("position").map(|v| v == "absolute").unwrap_or(false);
        let anchored = (get("top").and_then(|v| px(&v)), get("left").and_then(|v| px(&v)));
        let (Some(top), Some(left)) = anchored else {
            i += gt + 1;
            continue;
        };
        if !absolute {
            i += gt + 1;
            continue;
        }
        let font_size = get("font-size").and_then(|v| px(&v)).unwrap_or(16.0);
        if font_size < 20.0 {
            i += gt + 1;
            continue;
        }
        if get("opacity").and_then(|v| v.parse::<f32>().ok()).map(|o| o < 0.4).unwrap_or(false)
            || get("color").and_then(|v| color_alpha(&v)).map(|a| a < 0.3).unwrap_or(false)
        {
            i += gt + 1;
            continue; // ghost type is intentional layering
        }
        let content_start = i + 1 + gt + 1;
        let close_pat = format!("</{tag}>");
        let open_pat = format!("<{tag}");
        let mut depth = 1usize;
        let mut j = content_start;
        let mut end = None;
        while j < lower.len() {
            if lower[j..].starts_with(&close_pat) {
                depth -= 1;
                if depth == 0 {
                    end = Some(j);
                    break;
                }
                j += close_pat.len();
            } else if lower[j..].starts_with(&open_pat)
                && lower[j + open_pat.len()..].starts_with(|c: char| c == ' ' || c == '>')
            {
                depth += 1;
                j += open_pat.len();
            } else {
                j += lower[j..].chars().next().map(char::len_utf8).unwrap_or(1);
            }
        }
        let Some(close_at) = end else { break };
        let inner = strip_style_and_tags(&html[content_start..close_at]);
        let text = inner.split_whitespace().collect::<Vec<_>>().join(" ");
        i = close_at + close_pat.len();
        if text.chars().count() < 3 {
            continue;
        }
        let line_height = get("line-height")
            .and_then(|v| {
                let v = v.trim().to_string();
                if let Some(p) = px(&v) {
                    Some(p / font_size.max(1.0))
                } else {
                    v.parse::<f32>().ok()
                }
            })
            .unwrap_or(1.2)
            .max(0.7);
        let declared_w = get("width").and_then(|v| px(&v));
        let text_w = text.chars().count() as f32 * font_size * 0.52;
        let max_w = (canvas_w - left - 60.0).max(80.0);
        let width = declared_w.unwrap_or(text_w.min(max_w)).min(max_w).max(20.0);
        let lines = (text_w / width).ceil().max(1.0);
        // Estimates overshoot; discount half a line so only real collisions fire.
        let height = ((lines - 0.5).max(0.5) * font_size * line_height).max(font_size * 0.8);
        boxes.push(TextBox { left, top, width, height, font_size, text });
    }
    boxes
}

fn overlap_issues(html: &str, canvas_w: f32) -> Vec<Issue> {
    let boxes = text_boxes(html, canvas_w);
    let mut issues = Vec::new();
    'outer: for a in 0..boxes.len() {
        for b in (a + 1)..boxes.len() {
            let (x, y) = (&boxes[a], &boxes[b]);
            let ix = (x.left + x.width).min(y.left + y.width) - x.left.max(y.left);
            let iy = (x.top + x.height).min(y.top + y.height) - x.top.max(y.top);
            if ix <= 0.0 || iy <= 0.0 {
                continue;
            }
            let inter = ix * iy;
            let min_area = (x.width * x.height).min(y.width * y.height);
            if min_area > 0.0 && inter / min_area > 0.3 {
                let snip = |s: &str| {
                    let s: String = s.chars().take(22).collect();
                    if s.chars().count() < 22 { s } else { format!("{s}…") }
                };
                issues.push(warn(
                    "overlap",
                    format!(
                        "Teks bertumpuk: \"{}\" ({:.0}px di top {:.0}) menimpa \"{}\" ({:.0}px di top {:.0}). Hitung ruang nyata tiap blok.",
                        snip(&x.text), x.font_size, x.top, snip(&y.text), y.font_size, y.top
                    ),
                ));
                if issues.len() >= 3 {
                    break 'outer;
                }
            }
        }
    }
    issues
}

#[cfg(test)]

mod tests {
    use super::*;
    #[test]
    fn unicode_text_never_panics_or_shifts_html_offsets() {
        let html = r#"<!doctype html><html><style>.title{position:absolute;left:80px;top:80px;font-size:70px;width:800px}</style><body><h1 class="title">İde → 日本語 🦀</h1></body></html>"#;
        let boxes = text_boxes(html, 1080.0);
        assert_eq!(boxes.len(), 1);
        let _ = overlap_issues(html, 1080.0);
    }

    #[test]
    fn gross_text_overlap_is_flagged() {
        let html = r#"<!doctype html><html><head><style>
            html,body{margin:0;width:1080px;height:1350px;background:#151515;color:#f5f2ec;font-family:Georgia}
            h1{position:absolute;left:76px;top:200px;font-size:140px;line-height:.9;margin:0;width:900px}
            .sub{position:absolute;left:76px;top:230px;font-size:34px;line-height:1.4;width:800px}
            </style></head><body><h1>Judul Besar Sekali</h1>
            <p class="sub">Subjudul panjang yang menjelaskan isi slide</p></body></html>"#;
        let issues = lint(html, 1080.0, 1350.0);
        assert!(issues.iter().any(|i| i.rule == "overlap"), "overlap harus terdeteksi: {issues:?}");
    }

    #[test]
    fn separated_blocks_and_ghost_type_stay_legal() {
        let html = r#"<!doctype html><html><head><style>
            html,body{margin:0;width:1080px;height:1350px;background:#EDE4D2;color:#16130F;font-family:Georgia}
            h1{position:absolute;left:76px;top:200px;font-size:140px;line-height:.9;margin:0;width:900px}
            .sub{position:absolute;left:76px;top:600px;font-size:34px;line-height:1.4;width:800px}
            .ghost{position:absolute;left:200px;top:220px;font-size:400px;line-height:.8;color:#16130f0a}
            .num{position:absolute;left:76px;top:76px;font-size:150px;line-height:.8;color:#D9301E}
            .kick{position:absolute;left:246px;top:104px;font-size:17px;letter-spacing:.24em;color:#8C8474}
            </style></head><body><div class="ghost">f</div><div class="num">01</div>
            <p class="kick">TOOL · JUNEGUNN</p><h1>Judul Besar Sekali</h1>
            <p class="sub">Subjudul panjang yang menjelaskan isi slide</p></body></html>"#;
        let issues = lint(html, 1080.0, 1350.0);
        assert!(!issues.iter().any(|i| i.rule == "overlap"), "false positive: {issues:?}");
    }

    #[test]
    fn agent_rewritten_slide_after_geometry_feedback_is_clean() {
        // output of the live5 self-correction run: the model rewrote an
        // overlapping slide after receiving the geometry finding
        let html = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../desel-live/out/live5-geometry-slide-1.html"));
        let Ok(html) = html else { return };
        let issues = lint(&html, 1080.0, 1350.0);
        assert!(!issues.iter().any(|i| i.rule == "overlap"), "slide hasil perbaikan masih overlap: {issues:?}");
    }

    #[test]
    fn real_world_overlapping_slide_is_flagged() {
        // slide-2 from the audited live1 deck (class-based absolute layout,
        // the case the string linter missed entirely)
        let html = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../desel-live/out/live1-full-slide-2.html"));
        let Ok(html) = html else { return }; // evidence file absent in CI checkouts
        let issues = lint(&html, 1080.0, 1350.0);
        assert!(issues.iter().any(|i| i.rule == "overlap"), "slide nyata dengan overlap harus terdeteksi");
    }

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
    fn the_assembled_prompt_has_no_style_anchoring_example() {
        let prompt = crate::agent::system_prompt();
        assert_eq!(prompt.matches(crate::agent::EXAMPLE_SLIDE).count(), 0);
        assert!(prompt.contains("Acuan user mengalahkan resep"));
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
    fn strike_decorations_require_semantic_review() {
        for html in ["<style>.strike:after{height:9px}</style><span>tanpa</span>", "<p style='text-decoration:line-through'>without</p>", "<s>tidak</s>"] {
            assert!(lint(html,1080.0,1350.0).iter().any(|i|i.rule=="semantic-decoration"));
        }
        assert!(!lint("<p>tanpa cloud</p>",1080.0,1350.0).iter().any(|i|i.rule=="semantic-decoration"));
    }
    #[test]
    fn flags_canvas_size_mismatch() {
        let issues = lint("<html><body style=\"margin:0;width:1080px;height:1920px\">x</body></html>", 1080.0, 1350.0);
        let rules: Vec<&str> = issues.iter().map(|i| i.rule.as_str()).collect();
        assert!(rules.contains(&"canvas-size"), "{rules:?}");
    }
}

#[cfg(test)]mod landscape_tests{#[test]fn landscape_canvas_is_not_portrait_fallback(){assert_eq!(super::canvas("16:9"),(1920.0,1080.0));}}


/// Coarse photo-placement signature of a slide ("full", "band-top", "col-right", "inset", ...), None when no photo or unknown.
pub fn photo_layout(html:&str)->Option<String>{
    let doc=scraper::Html::parse_document(html);
    let img_sel=scraper::Selector::parse("img").ok()?;
    let img=doc.select(&img_sel).max_by_key(|e|e.value().attr("src").map_or(0,|s|s.len()))?;
    if img.value().attr("src").map_or(true,|s|s.len()<2000&&!s.starts_with("asset:")){return None}
    // css blocks by class
    let mut rules:Vec<(String,String)>=vec![];
    let mut rest=html;
    while let Some(i)=rest.find('{'){let Some(j)=rest[i..].find('}')else{break};let sel=rest[..i].rsplit(['}','>']).next().unwrap_or("").trim().to_string();rules.push((sel,rest[i+1..i+j].to_string()));rest=&rest[i+j+1..];}
    let mut props=String::new();
    // element chain: img + up to 2 ancestors
    let mut chain:Vec<scraper::ElementRef>=vec![img];
    let mut cur=img.parent().and_then(scraper::ElementRef::wrap);
    for _ in 0..2{if let Some(p)=cur{if p.value().name()!="body"{chain.push(p)}cur=p.parent().and_then(scraper::ElementRef::wrap)}}
    for e in &chain{
        if let Some(st)=e.value().attr("style"){props.push_str(st);props.push(';')}
        for c in e.value().classes(){for (sel,body) in &rules{if sel.split(',').any(|s|{let s=s.trim();s==format!(".{c}")||s.ends_with(&format!(" .{c}"))}){props.push_str(body);props.push(';')}}}
    }
    let get=|name:&str|->Option<f32>{
        let (mut px,mut pc)=(None,None);
        for decl in props.split(';'){let d=decl.trim();if let Some((k,v))=d.split_once(':'){if k.trim()==name{let v=v.trim();let n:String=v.chars().take_while(|c|c.is_ascii_digit()||*c=='.'||*c=='-').collect();if let Ok(x)=n.parse::<f32>(){if v[n.len()..].starts_with('%'){if pc.is_none(){pc=Some(x*10.8)}}else if (v[n.len()..].starts_with("px")||x==0.0)&&px.is_none(){px=Some(x)}}}}}
        px.or(pc)
    };
    if props.contains("inset:0")||props.contains("inset: 0"){return Some("full".into())}
    let (w,h)=(get("width"),get("height"));
    let wf=w.map_or(false,|x|x>=970.0);let hf=h.map_or(false,|x|x>=1215.0);
    let has0=|n:&str|get(n).map_or(false,|x|x.abs()<1.0);
    let (l0,r0,t0,b0)=(has0("left"),has0("right"),has0("top"),has0("bottom"));
    if wf&&hf{return Some("full".into())}
    if wf{return Some(if b0&&!t0{"band-bottom".into()}else{"band-top".into()})}
    if hf{return Some(if r0&&!l0{"col-right".into()}else{"col-left".into()})}
    if w.is_some()||h.is_some()||props.contains("position"){return Some("inset".into())}
    None
}
#[test]#[ignore]fn photo_layout_dirs(){for d in std::env::var("DECK_DIRS").unwrap_or_default().split(',').filter(|x|!x.is_empty()){let mut sigs=vec![];for i in 0..12{if let Ok(h)=std::fs::read_to_string(format!("{d}/{i}.html")){sigs.push(photo_layout(&h).unwrap_or("-".into()))}}println!("[sig] {d}: {}",sigs.join(" "));}}
#[test]fn dark_background_detected(){assert_eq!(dark_background("<style>body{background:#0D0B09}</style>"),Some(true));assert_eq!(dark_background("<style>.stage{position:absolute;background:#f3ece0}</style>"),Some(false));assert_eq!(dark_background("<body></body>"),None);}
#[test]fn tone_monotone_fires_on_fourth_dark(){let mk=|bg:&str|serde_json::json!({"id":bg,"html":format!("<style>body{{background:{bg}}}</style><body>x</body>")});let d:crate::model::Deck=serde_json::from_value(serde_json::json!({"id":"d","aspect":"4:5","slides":[mk("#0d0b09"),mk("#0d0b09"),mk("#111"),mk("#0d0b09"),mk("#f3ece0")]})).unwrap();assert!(!deck_lint(&d,2).iter().any(|i|i.rule=="tone-monotone"));assert!(deck_lint(&d,3).iter().any(|i|i.rule=="tone-monotone"));assert!(!deck_lint(&d,4).iter().any(|i|i.rule=="tone-monotone"));}
#[test]fn photo_layout_signatures(){let big="a".repeat(2500);
 let full=format!("<style>.p{{position:absolute;inset:0}}</style><body><div class=p><img src=\"data:image/jpeg;base64,{big}\"></div></body>");assert_eq!(photo_layout(&full).as_deref(),Some("full"));
 let band=format!("<style>.p{{position:absolute;left:0;top:0;width:1080px;height:640px}}</style><body><div class=p><img src=\"data:image/jpeg;base64,{big}\"></div></body>");assert_eq!(photo_layout(&band).as_deref(),Some("band-top"));
 let col=format!("<style>.p{{position:absolute;right:0;top:0;width:480px;height:1350px}}</style><body><div class=p><img src=\"data:image/jpeg;base64,{big}\"></div></body>");assert_eq!(photo_layout(&col).as_deref(),Some("col-right"));
 assert_eq!(photo_layout("<body>none</body>"),None);}

/// True when the slide's base background colour is dark (first hex colour on html/body/.stage/.slide/.canvas/.frame).
pub fn dark_background(html:&str)->Option<bool>{
    let re=regex::Regex::new(r"(?s)(?:html|body|\.stage|\.slide|\.canvas|\.frame)[^{}]*\{[^}]*?background(?:-color)?:\s*#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b").ok()?;
    let h=re.captures(html)?.get(1)?.as_str().to_string();
    let h=if h.len()==3{h.chars().flat_map(|c|[c,c]).collect::<String>()}else{h};
    let v=|i:usize|u8::from_str_radix(&h[i..i+2],16).unwrap_or(0) as f64/255.0;
    Some(0.2126*v(0)+0.7152*v(2)+0.0722*v(4)<0.25)
}

/// Photo/credit rules that need the whole deck. Rebuilt in run 125b after a workspace loss.
pub fn deck_lint(deck:&crate::model::Deck,index:usize)->Vec<Issue>{
    let mut out=vec![];
    let Some(slide)=deck.slides.get(index) else{return out};
    out.extend(credit_issues(&slide.html));
    out.extend(divider_issues(&slide.html));
    if let Some(sig)=photo_layout(&slide.html){
        let vis:Vec<&crate::model::Slide>=deck.slides.iter().take(index+1).filter(|s|!s.hidden).collect();
        if vis.len()>=3{let n=vis.len();if (n-3..n-1).all(|i|photo_layout(&vis[i].html).as_deref()==Some(sig.as_str())){out.push(error("layout-monotone",format!("3 slide berturut-turut memakai penempatan foto yang sama ({sig}). Ubah slide ini: pilih salah satu: (a) foto penuh kanvas + panel teks gelap di bawah, (b) kolom foto 45% tinggi penuh di kiri/kanan, (c) band foto atas 55% (bila yang lain bukan band), (d) foto inset miring 60% lebar di atas latar krem, (e) foto potong diagonal clip-path. Jangan ulangi struktur slide sebelumnya.")))}}
    }
    {let vis:Vec<&crate::model::Slide>=deck.slides.iter().take(index+1).filter(|s|!s.hidden).collect();
     if vis.len()>=4&&vis.len()==deck.slides.iter().take(index+1).filter(|s|!s.hidden).count(){let n=vis.len();if vis[n-4..].iter().all(|s|dark_background(&s.html)==Some(true)){out.push(error("tone-monotone",format!("4 slide berturut-turut berlatar gelap. Slide ini harus berlatar TERANG (krem/putih, mis. #F3ECE0) dengan teks gelap dan foto sebagai band/inset atau kolom, supaya ritme terang-gelap berganti.")))}}}
    if let Some((kk,n))=page_marker(&slide.html){let total=deck.slides.iter().filter(|s|!s.hidden).count();if n==total&&kk!=index+1{out.push(error("slide-order",format!("Penanda halaman \"{kk}/{n}\" tidak sama dengan posisi slide ({}/{total}). Urutan slide salah: tulis ulang slide dengan index yang benar atau perbaiki nomornya.",index+1)))}}
    // repeated photo: identical asset id or identical data-URI body on another slide
    let keys=|html:&str|->std::collections::HashSet<String>{
        let doc=scraper::Html::parse_document(html);
        let sel=scraper::Selector::parse("img").unwrap();
        doc.select(&sel).filter_map(|i|i.value().attr("src")).map(|s|if s.starts_with("data:"){s.chars().skip(60).take(120).collect::<String>()}else{s.to_string()}).filter(|s|s.len()>=6).collect()
    };
    let mine=keys(&slide.html);
    let dup:Vec<String>=deck.slides.iter().enumerate().filter(|(j,s)|*j!=index&&!s.hidden&&!keys(&s.html).is_disjoint(&mine)).map(|(j,_)|(j+1).to_string()).collect();
    if !dup.is_empty(){out.push(error("repeated-photo",format!("Foto identik juga dipakai di slide {}. Satu foto hanya boleh muncul sekali per carousel (crop berbeda bukan foto baru): panggil search_commons untuk foto lain, atau ganti dengan angka/diagram bila tidak ada foto yang relevan.",dup.join(", "))))}
    // photo-sparse: most slides lack any <img>
    let visible=deck.slides.iter().filter(|s|!s.hidden).count();
    let with_img=deck.slides.iter().filter(|s|!s.hidden&&s.html.to_ascii_lowercase().contains("<img")).count();
    if visible>=5&&with_img*2<visible&&index>0&&index+1<deck.slides.len()&&!slide.html.to_ascii_lowercase().contains("<img"){
        out.push(warn("photo-sparse",format!("Hanya {with_img} dari {visible} slide yang berfoto; slide {} tanpa foto. Bila brief meminta carousel image-led atau foto per slide, panggil search_commons (kata kunci 2 kata sesuai subjek slide) lalu pasang <img> foto >=45% kanvas dengan kredit. Ilustrasi SVG bukan foto.",index+1)))
    }
    out
}

/// Credit-line checks on any element whose text starts with "Foto:".
/// Static check for empty accent rules: a declaration block with a 1-6px height, a width and a background (no text-bearing use).
pub fn divider_issues(html:&str)->Vec<Issue>{
    let mut out=vec![];
    let mut blocks:Vec<String>=vec![];
    let mut rest=html;
    while let Some(i)=rest.find('{'){let Some(j)=rest[i..].find('}')else{break};blocks.push(rest[i+1..i+j].to_string());rest=&rest[i+j+1..];}
    let doc=scraper::Html::parse_document(html);
    if let Ok(sel)=scraper::Selector::parse("[style]"){for e in doc.select(&sel){if e.children().next().is_none(){if let Some(s)=e.value().attr("style"){blocks.push(s.to_string())}}}}
    let num=|b:&str,prop:&str|->Option<f32>{let mut from=0;while let Some(p)=b[from..].find(prop){let at=from+p;let pre=b[..at].chars().last();from=at+prop.len();if pre.map_or(false,|c|c.is_ascii_alphanumeric()||c=='-'){continue}let r=b[from..].trim_start();let r=r.strip_prefix(':')?.trim_start();let n:String=r.chars().take_while(|c|c.is_ascii_digit()||*c=='.').collect();if r[n.len()..].starts_with("px"){return n.parse().ok()}return None}None};
    for b in &blocks{
        let (Some(h),Some(w))=(num(b,"height"),num(b,"width"))else{continue};
        if h>=1.0&&h<=6.0&&w>=h*8.0&&w<=500.0&&(b.contains("background")||b.contains("border")){out.push(error("decorative-divider",format!("Garis dekoratif {w}x{h}px. Hapus. Pisahkan blok dengan jarak, ukuran huruf, atau warna, bukan garis.")));break}
    }
    out
}

/// "NN / MM" page marker in slide text (first match, 1<=NN<=MM<=30).
pub fn page_marker(html:&str)->Option<(usize,usize)>{
    let doc=scraper::Html::parse_document(html);let text:String=doc.root_element().text().collect::<Vec<_>>().join(" ");
    let re=regex::Regex::new(r"(?:^|\D)(\d{1,2})\s*/\s*(\d{1,2})(?:\D|$)").ok()?;
    for c in re.captures_iter(&text){let a:usize=c[1].parse().ok()?;let b:usize=c[2].parse().ok()?;if a>=1&&a<=b&&b>=2&&b<=30{return Some((a,b))}}None
}
#[test]fn page_marker_and_order(){assert_eq!(page_marker("<body><div>05 / 06</div></body>"),Some((5,6)));assert_eq!(page_marker("<body>3/4 cup</body>"),Some((3,4)));assert_eq!(page_marker("<body>no</body>"),None);}

pub fn credit_issues(html:&str)->Vec<Issue>{
    let mut out=vec![];
    let doc=scraper::Html::parse_document(html);
    let sel=scraper::Selector::parse("div,p,span,small,figcaption").unwrap();
    let px=|style:&str|->Option<f32>{let i=style.find("font-size")?;let rest=&style[i+9..];let rest=rest.trim_start_matches([':',' ']);let n:String=rest.chars().take_while(|c|c.is_ascii_digit()||*c=='.').collect();n.parse().ok()};
    for e in doc.select(&sel){
        let own:String=e.children().filter_map(|c|c.value().as_text().map(|t|t.to_string())).collect::<Vec<_>>().join(" ");
        let t=own.split_whitespace().collect::<Vec<_>>().join(" ");
        if !t.to_lowercase().starts_with("foto:"){continue}
        if t.to_lowercase().matches("foto:").count()>=2{out.push(error("credit-duplicated-text",format!("Kredit ganda dalam satu elemen: \"{}\". Tulis satu baris kredit saja.",t.chars().take(80).collect::<String>())))}
        let low=t.to_lowercase();
        if low.contains("wikimedia")&&!["cc by","cc0","cc-by","public domain","pd","gfdl","cc "].iter().any(|k|low.contains(k)){out.push(error("credit-no-license",format!("Kredit tanpa lisensi: \"{}\". Pakai persis baris KREDIT TERVERIFIKASI dari import_image, lengkap dengan lisensi dalam kurung, mis. (CC BY-SA 4.0).",t.chars().take(80).collect::<String>())))}
        if low.starts_with("foto: wikimedia")||low.starts_with("foto: commons")||low.starts_with("foto: via wikimedia")||low.contains("unknown")||low.contains("terverifikasi")||low.contains("unverified")||low.contains("tidak diketahui")||low.contains("anonim")||t.trim().len()<8{out.push(error("credit-no-name",format!("Kredit tanpa nama fotografer nyata: \"{}\". Pakai persis baris KREDIT TERVERIFIKASI dari import_image atau hapus kredit; jangan mengarang.",t.chars().take(80).collect::<String>())))}
        if let Some(size)=e.value().attr("style").and_then(px){if size<16.0{out.push(error("credit-tiny",format!("Kredit \"{}\" hanya {size}px; minimal 16px (target 18px) di kanvas 1080px agar terbaca.",t.chars().take(60).collect::<String>())))}}
    }
    out
}

/// Raise credit text under 18px to 18px, in the opening tag of any element whose own text starts with "Foto:".
pub fn fix_credit_size(html:&str)->String{
    let mut out=String::with_capacity(html.len());let mut rest=html;
    while let Some(p)=rest.find("Foto:"){
        let (head,tail)=rest.split_at(p);
        let open=head.rfind('<').unwrap_or(0);
        let tag=&head[open..];
        let fixed=match tag.find("font-size:"){
            Some(i)if tag[..tag.len()].ends_with(|c:char|c!='<')&&tag.contains('>')&&!tag[tag.find('>').unwrap()+1..].contains('<')=>{
                let s=i+10;let num:String=tag[s..].trim_start().chars().take_while(|c|c.is_ascii_digit()||*c=='.').collect();
                let off=tag[s..].len()-tag[s..].trim_start().len();
                match num.parse::<f32>(){Ok(n)if n<18.0=>{let a=s+off;format!("{}18{}",&tag[..a],&tag[a+num.len()..])},_=>tag.to_string()}
            }
            _=>tag.to_string()
        };
        out.push_str(&head[..open]);out.push_str(&fixed);out.push_str("Foto:");rest=&tail[5..];
    }
    out.push_str(rest);out
}
#[test]fn credit_autofix(){let h="<div style=\"position:absolute;font-size:12px;color:#fff\">Foto: A / Wikimedia</div><p style=\"font-size:12px\">lain</p>";let f=fix_credit_size(h);assert!(f.contains("font-size:18px;color:#fff\">Foto:"));assert!(f.contains("<p style=\"font-size:12px\">lain"));assert_eq!(fix_credit_size("<p>x</p>"),"<p>x</p>");}

#[test]fn divider_rule(){assert!(!divider_issues("<style>.rule{width:96px;height:3px;background:#c8452b}</style><div class=rule></div>").is_empty());assert!(!divider_issues("<div style=\"width:60px;height:2px;background:#fff\"></div>").is_empty());assert!(divider_issues("<style>.p{width:600px;height:900px;background:#000}.l{line-height:3px}</style>").is_empty());}

#[cfg(test)]
mod deck_lint_tests{use super::*;
fn deck(htmls:&[&str])->crate::model::Deck{let sl:Vec<serde_json::Value>=htmls.iter().enumerate().map(|(i,h)|serde_json::json!({"id":format!("s{i}"),"html":h})).collect();serde_json::from_value(serde_json::json!({"id":"d","aspect":"4:5","slides":sl})).unwrap()}
#[test]fn repeated_photo_is_an_error(){let d=deck(&["<body><img src=\"asset:a1\"></body>","<body><img src=\"asset:a1\"></body>","<body><img src=\"asset:a2\"></body>"]);assert!(deck_lint(&d,0).iter().any(|i|i.rule=="repeated-photo"&&i.severity==Severity::Error));assert!(!deck_lint(&d,2).iter().any(|i|i.rule=="repeated-photo"));}
#[test]fn credit_unverified_text_is_error(){let h="<body><div style=\"font-size:18px\">Foto: Wikimedia Commons, nama fotografer belum terverifikasi</div></body>";assert!(credit_issues(h).iter().any(|i|i.rule=="credit-no-name"));}
#[test]fn credit_generic_wikimedia_is_error(){let h="<body><div style=\"font-size:18px\">Foto: Wikimedia Commons (CC BY-SA)</div></body>";assert!(credit_issues(h).iter().any(|i|i.rule=="credit-no-name"));let ok="<body><div style=\"font-size:18px\">Foto: Hiart / Wikimedia (CC0)</div></body>";assert!(credit_issues(ok).is_empty());}
#[test]fn credit_without_license_is_error(){assert!(credit_issues("<body><div style=\"font-size:18px\">Foto: Gunawan Kartapranata / Wikimedia</div></body>").iter().any(|i|i.rule=="credit-no-license"));assert!(credit_issues("<body><div style=\"font-size:18px\">Foto: Gunawan / Wikimedia (Public domain)</div></body>").is_empty());}
#[test]fn credit_rules(){let bad="<body><div style=\"font-size:12px\">Foto: Unknown author / Wikimedia</div><div>Foto: A / Wikimedia Foto: A / Wikimedia</div></body>";let r:Vec<String>=credit_issues(bad).into_iter().map(|i|i.rule).collect();assert!(r.contains(&"credit-tiny".to_string()));assert!(r.contains(&"credit-no-name".to_string()));assert!(r.contains(&"credit-duplicated-text".to_string()));assert!(credit_issues("<body><div style=\"font-size:18px\">Foto: Adilarmaya / Wikimedia (CC BY-SA 4.0)</div></body>").is_empty());}
#[test]fn photo_sparse_warns_on_photoless_middle_slides(){let p="<body><img src=\"asset:x\"></body>";let n="<body><p>x</p></body>";let d=deck(&[p,n,n,n,n,n,n]);assert!(deck_lint(&d,3).iter().any(|i|i.rule=="photo-sparse"));assert!(!deck_lint(&d,0).iter().any(|i|i.rule=="photo-sparse"));assert!(!deck_lint(&d,6).iter().any(|i|i.rule=="photo-sparse"));}}
