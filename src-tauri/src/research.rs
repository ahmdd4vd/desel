//! Web research helpers: a search engine query and a readable-text extractor.
//!
//! Search uses DuckDuckGo's HTML endpoint (no API key required). Fetching strips
//! HTML down to readable text with `scraper`, so the model receives prose rather
//! than markup soup.

use regex::Regex;
use scraper::{Html, Selector};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                  (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())
}

/// One search result, before formatting.
#[derive(Debug, Clone)]
struct Hit {
    title: String,
    url: String,
    snippet: String,
}

async fn get(url: &str) -> Result<String, String> {
    let res = client()?
        .get(url)
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("request gagal: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("server mengembalikan {}", res.status()));
    }
    res.text().await.map_err(|e| e.to_string())
}

/// Returns a compact, model-friendly result list.
///
/// Two engines are tried, because a single HTML endpoint is one block away from
/// being useless: DuckDuckGo lite (fast, no JS) then Bing.
pub async fn search(query: &str, limit: usize) -> Result<String, String> {
    if query.trim().is_empty() {
        return Err("query kosong".into());
    }
    let q = urlencoding::encode(query);

    let mut hits = Vec::new();
    let mut tried: Vec<String> = Vec::new();

    match get(&format!("https://lite.duckduckgo.com/lite/?q={q}")).await {
        Ok(body) => hits = parse_ddg_lite(&body, limit),
        Err(e) => tried.push(format!("duckduckgo: {e}")),
    }

    if hits.is_empty() {
        match get(&format!("https://www.bing.com/search?q={q}&count=20")).await {
            Ok(body) => hits = parse_bing(&body, limit),
            Err(e) => tried.push(format!("bing: {e}")),
        }
    }

    if hits.is_empty() {
        return Ok(format!(
            "Tidak ada hasil untuk \"{query}\".{}\nCoba kata kunci lain, atau pakai fetch_url ke halaman yang kamu tahu.",
            if tried.is_empty() { String::new() } else { format!("\n({})", tried.join("; ")) }
        ));
    }

    let mut out = format!("Hasil pencarian untuk \"{query}\":\n\n");
    for (i, hit) in hits.iter().enumerate() {
        out.push_str(&format!("{}. {}\n   {}\n", i + 1, hit.title, hit.url));
        if !hit.snippet.is_empty() {
            out.push_str(&format!("   {}\n", truncate(&hit.snippet, 320)));
        }
        out.push('\n');
    }
    Ok(out)
}

fn parse_ddg_lite(body: &str, limit: usize) -> Vec<Hit> {
    let doc = Html::parse_document(body);
    let link_sel = Selector::parse("a.result-link").unwrap();
    let snippet_sel = Selector::parse("td.result-snippet").unwrap();

    let snippets: Vec<String> = doc
        .select(&snippet_sel)
        .map(|el| collapse_ws(&el.text().collect::<String>()))
        .collect();

    doc.select(&link_sel)
        .enumerate()
        .filter_map(|(i, el)| {
            let href = el.value().attr("href")?;
            let title = collapse_ws(&el.text().collect::<String>());
            if title.is_empty() {
                return None;
            }
            Some(Hit {
                title,
                url: clean_ddg_url(href),
                snippet: snippets.get(i).cloned().unwrap_or_default(),
            })
        })
        .take(limit)
        .collect()
}

fn parse_bing(body: &str, limit: usize) -> Vec<Hit> {
    let doc = Html::parse_document(body);
    let item_sel = Selector::parse("li.b_algo").unwrap();
    let link_sel = Selector::parse("h2 a").unwrap();
    let cap_sel = Selector::parse(".b_caption p, .b_lineclamp2, .b_lineclamp3, .b_lineclamp").unwrap();

    doc.select(&item_sel)
        .filter_map(|item| {
            let link = item.select(&link_sel).next()?;
            let href = link.value().attr("href")?.to_string();
            if !href.starts_with("http") {
                return None;
            }
            let title = collapse_ws(&link.text().collect::<String>());
            if title.is_empty() {
                return None;
            }
            let snippet = item
                .select(&cap_sel)
                .next()
                .map(|el| collapse_ws(&el.text().collect::<String>()))
                .unwrap_or_default();
            Some(Hit { title, url: href, snippet })
        })
        .take(limit)
        .collect()
}
fn clean_ddg_url(href: &str) -> String {
    // DuckDuckGo wraps results as /l/?uddg=<encoded>
    if let Some(idx) = href.find("uddg=") {
        let rest = &href[idx + 5..];
        let encoded = rest.split('&').next().unwrap_or(rest);
        return urlencoding::decode(encoded)
            .map(|c| c.into_owned())
            .unwrap_or_else(|_| encoded.to_string());
    }
    if href.starts_with("//") {
        return format!("https:{href}");
    }
    href.to_string()
}

/// Sniffs the real image type from magic bytes; hosts lie in headers.
pub fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if bytes.starts_with(b"GIF8") {
        return Some("image/gif");
    }
    None
}

/// Download an image (e.g. a pasted Pinterest / Dribbble link).
///
/// Returns the sniffed mime type and the bytes. Rejects HTML so the user gets a
/// clear "that is a page, not an image" message instead of a broken thumbnail.
pub async fn fetch_image(url: &str) -> Result<(&'static str, Vec<u8>), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("link harus dimulai http(s)://".into());
    }

    let res = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("gagal mengambil link: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("server mengembalikan {}", res.status()));
    }

    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("gagal membaca gambar: {e}"))?
        .to_vec();

    match sniff_image(&bytes) {
        Some(mime) => Ok((mime, bytes)),
        None => Err(
            "Link ini halaman web, bukan file gambar. Buka gambarnya, klik kanan → Copy image address, lalu tempel itu."
                .into(),
        ),
    }
}

/// Fetch a URL and return readable text, capped so it cannot blow the context.
pub async fn fetch_text(url: &str) -> Result<String, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("url harus http(s)".into());
    }

    let res = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request gagal: {e}"))?;

    let status = res.status();
    if !status.is_success() {
        return Err(format!("server mengembalikan {status}"));
    }

    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let body = res.text().await.map_err(|e| e.to_string())?;

    if content_type.contains("text/plain") || content_type.contains("json") {
        return Ok(truncate(&collapse_ws(&body), 12000));
    }

    let text = html_to_text(&body);
    Ok(truncate(&text, 12000))
}

/// Strip a page down to readable prose.
fn html_to_text(html: &str) -> String {
    // Drop the elements that never contain useful prose.
    let mut cleaned = html.to_string();
    for tag in [
        "script", "style", "noscript", "svg", "head", "nav", "footer", "aside", "form",
    ] {
        let re = Regex::new(&format!(r"(?is)<{tag}\b[^>]*>.*?</{tag}>")).unwrap();
        cleaned = re.replace_all(&cleaned, " ").to_string();
    }

    let doc2 = Html::parse_document(&cleaned);
    let body_sel = Selector::parse("body").unwrap();

    let mut text = String::new();
    if let Some(body) = doc2.select(&body_sel).next() {
        for node in body.descendants() {
            if let Some(t) = node.value().as_text() {
                let t = collapse_ws(t);
                if !t.is_empty() {
                    text.push_str(&t);
                    text.push('\n');
                }
            }
        }
    } else {
        for node in doc2.tree.root().descendants() {
            if let Some(t) = node.value().as_text() {
                let t = collapse_ws(t);
                if !t.is_empty() {
                    text.push_str(&t);
                    text.push('\n');
                }
            }
        }
    }

    // Collapse runs of blank lines.
    let re_blank = Regex::new(r"\n{3,}").unwrap();
    re_blank.replace_all(&text, "\n\n").trim().to_string()
}

fn collapse_ws(input: &str) -> String {
    let re = Regex::new(r"[ \t\r\f\v]+").unwrap();
    let s = re.replace_all(input, " ");
    let re2 = Regex::new(r"\n{3,}").unwrap();
    re2.replace_all(&s, "\n\n").trim().to_string()
}

fn truncate(input: &str, max: usize) -> String {
    if input.chars().count() <= max {
        return input.to_string();
    }
    let cut: String = input.chars().take(max).collect();
    format!("{cut}\n\n[…dipotong]")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Hits the real internet, so it is opt-in: `cargo test --lib -- --ignored`.
    #[tokio::test]
    #[ignore = "butuh jaringan"]
    async fn live_search_returns_usable_results() {
        let out = super::search("tauri 2 release notes", 3).await.expect("search");
        println!("{out}");
        assert!(out.contains("http"), "hasil kosong: {out}");
    }

    #[test]
    fn sniffs_image_types_from_magic_bytes() {
        assert_eq!(super::sniff_image(&[0x89, b'P', b'N', b'G', 0x0D]), Some("image/png"));
        assert_eq!(super::sniff_image(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(super::sniff_image(b"RIFF1234WEBPVP8 "), Some("image/webp"));
        assert_eq!(super::sniff_image(b"GIF89a..."), Some("image/gif"));
        assert_eq!(super::sniff_image(b"<!doctype html>"), None);
    }

    #[tokio::test]
    #[ignore = "butuh jaringan"]
    async fn live_fetch_image_rejects_pages_and_accepts_png() {
        let page = super::fetch_image("https://example.com").await;
        assert!(page.is_err(), "halaman web harus ditolak");
        let (mime, bytes) = super::fetch_image(
            "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png",
        )
        .await
        .expect("gambar");
        assert_eq!(mime, "image/png");
        assert!(bytes.len() > 500, "{} bytes", bytes.len());
    }

    #[tokio::test]
    #[ignore = "butuh jaringan"]
    async fn live_fetch_returns_prose() {
        let text = super::fetch_text("https://example.com").await.expect("fetch");
        assert!(text.to_lowercase().contains("example"), "{text}");
    }
}