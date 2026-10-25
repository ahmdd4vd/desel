fn main() {
    println!("cargo:rustc-check-cfg=cfg(desel_harness)");
    println!("cargo:rustc-cfg=desel_harness");
}
