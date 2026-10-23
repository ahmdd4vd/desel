//! Reference-image analysis.
//!
//! The studio lets users attach covers they like. Not every model can see
//! images, so every reference is reduced to a compact descriptor — dominant
//! palette, brightness, contrast, aspect — that always travels with the prompt.
//! Models with vision additionally receive the pixels themselves.

use image::imageops::FilterType;

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageProfile {
    pub width: u32,
    pub height: u32,
    /// Most present colours, most dominant first, as `#rrggbb`.
    pub palette: Vec<String>,
    /// Mean relative luminance, 0 (black) to 1 (white).
    pub luminance: f32,
    /// Spread between the darkest and brightest decile, 0..1.
    pub contrast: f32,
    /// Share of pixels that are near-paper (light backgrounds read editorial).
    pub light_ratio: f32,
}

fn to_hex(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

fn rel_lum(r: u8, g: u8, b: u8) -> f32 {
    let f = |v: u8| {
        let s = v as f32 / 255.0;
        if s <= 0.039_28 {
            s / 12.92
        } else {
            ((s + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/// Analyses raw image bytes. Returns `None` when the format is unsupported.
pub fn analyse(bytes: &[u8]) -> Option<ImageProfile> {
    let img = image::load_from_memory(bytes).ok()?;
    let (width, height) = (img.width(), img.height());

    // Downscale: palette statistics do not need full resolution.
    let small = img.resize_exact(64, 64, FilterType::Triangle).to_rgb8();

    let mut buckets: std::collections::HashMap<(u8, u8, u8), u32> =
        std::collections::HashMap::new();
    let mut lum_sum = 0.0f32;
    let mut lums: Vec<f32> = Vec::with_capacity(64 * 64);
    let mut light = 0u32;
    let total = 64u32 * 64u32;

    for px in small.pixels() {
        let (r, g, b) = (px[0], px[1], px[2]);
        lum_sum += rel_lum(r, g, b);
        lums.push(rel_lum(r, g, b));
        if rel_lum(r, g, b) > 0.72 {
            light += 1;
        }
        // Quantise to 5 bits so near-identical shades collapse.
        let key = (r & 0b1111_1000, g & 0b1111_1000, b & 0b1111_1000);
        *buckets.entry(key).or_insert(0) += 1;
    }

    let mut ranked: Vec<((u8, u8, u8), u32)> = buckets.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1));

    // Keep the strongest colours, skipping shades that are too close to one kept.
    let mut palette: Vec<String> = Vec::new();
    for ((r, g, b), _) in ranked {
        let hex = to_hex(r, g, b);
        let too_close = palette.iter().any(|kept| {
            let (kr, kg, kb) = (
                u8::from_str_radix(&kept[1..3], 16).unwrap_or(0),
                u8::from_str_radix(&kept[3..5], 16).unwrap_or(0),
                u8::from_str_radix(&kept[5..7], 16).unwrap_or(0),
            );
            let d = (r as i32 - kr as i32).abs()
                + (g as i32 - kg as i32).abs()
                + (b as i32 - kb as i32).abs();
            d < 90
        });
        if too_close {
            continue;
        }
        palette.push(hex);
        if palette.len() >= 5 {
            break;
        }
    }

    lums.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    // Percentiles, not the extremes: a single white pixel should not read as contrast.
    let low = lums.get(lums.len() * 3 / 100).copied().unwrap_or(0.0);
    let high = lums.get(lums.len() * 97 / 100).copied().unwrap_or(1.0);

    Some(ImageProfile {
        width,
        height,
        palette,
        luminance: lum_sum / total as f32,
        contrast: (high - low).clamp(0.0, 1.0),
        light_ratio: light as f32 / total as f32,
    })
}

/// A one-line description for the prompt, e.g.
/// `1080×1350, palet #101010 #f2ece1 #b8412f; gelap (0.11), kontras tinggi (0.82), bidang terang 4%`.
pub fn describe(profile: &ImageProfile) -> String {
    let tone = if profile.luminance < 0.18 {
        "gelap"
    } else if profile.luminance < 0.4 {
        "remang"
    } else if profile.luminance < 0.65 {
        "sedang"
    } else {
        "terang"
    };
    let contrast = if profile.contrast > 0.6 {
        "kontras tinggi"
    } else if profile.contrast > 0.35 {
        "kontras sedang"
    } else {
        "kontras rendah"
    };
    format!(
        "{}×{}, palet {}; {} ({:.2}), {} ({:.2}), bidang terang {:.0}%",
        profile.width,
        profile.height,
        profile.palette.join(" "),
        tone,
        profile.luminance,
        contrast,
        profile.contrast,
        profile.light_ratio * 100.0
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analyses_a_generated_png() {
        // Two-tone image: dark background, bright block.
        let mut img = image::RgbImage::new(64, 64);
        for (x, y, px) in img.enumerate_pixels_mut() {
            *px = if x < 32 {
                image::Rgb([12, 12, 14])
            } else {
                image::Rgb([240, 236, 225])
            };
            let _ = y;
        }
        let mut buf = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut buf, image::ImageFormat::Png)
            .unwrap();

        let profile = analyse(buf.get_ref()).expect("png analysed");
        assert_eq!(profile.width, 64);
        assert!(profile.palette.len() >= 2);
        assert!(profile.light_ratio > 0.2);
        assert!(describe(&profile).contains("×64"));
    }
}

#[cfg(test)]
mod real_references {
    use super::*;

    /// Runs against the covers shipped in `referensi/` when present.
    /// Prints the same descriptor the model receives.
    #[test]
    fn describes_the_supplied_covers() {
        for dir in ["ref1", "ref2"] {
            let path = std::path::Path::new("..").join("referensi").join(dir).join("cover1.jpg");
            let path = if path.exists() {
                path
            } else {
                std::path::Path::new("..")
                    .join("referensi")
                    .join(dir)
                    .join("cover2.jpg")
            };
            if !path.exists() {
                eprintln!("{dir}: tidak ada, dilewati");
                continue;
            }
            let bytes = std::fs::read(&path).expect("baca gambar");
            let profile = analyse(&bytes).expect("gambar terbaca");
            println!("{dir}: {}", describe(&profile));
            assert!(profile.palette.len() >= 2, "{dir} harus punya palet");
            assert!(profile.width > 100 && profile.height > 100);
        }
    }
}