fn main() {
    use std::{path::Path,io::Read};
    for (name,expected) in [("magpie-linux-amd64","614af55d482331fe7b2a864572d12529a072354b19879b77628a82605b2066cf"),("magpie-windows-amd64.exe","610e7e1484355db361a6651445d1659672fbc573953f024eb4c1f17e8943f881")] {
        use sha2::{Sha256,Digest};
        let path=Path::new("binaries").join(name);println!("cargo:rerun-if-changed={}",path.display());
        let mut file=std::fs::File::open(path).expect("bundled provider binary missing: run npm run prepare:runtime before cargo commands");let mut hash=Sha256::new();let mut buf=[0;65536];loop{let n=file.read(&mut buf).unwrap();if n==0{break}hash.update(&buf[..n]);}
        assert_eq!(format!("{:x}",hash.finalize()),expected,"bundled provider binary digest mismatch");
    }
    tauri_build::build()
}
