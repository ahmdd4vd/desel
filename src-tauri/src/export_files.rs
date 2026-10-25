//! Validate first, stage the complete batch, then rename into a fresh directory.
use std::{collections::HashSet,path::{Path,PathBuf},io::Write};
use base64::Engine;use fs2::FileExt;
use crate::commands::{ExportFile,ExportOutcome};
fn validate(files:Vec<ExportFile>)->Result<Vec<(String,Vec<u8>)>,String>{
 if files.is_empty()||files.len()>205{return Err("Export needs1to205files".into())}
 let mut seen=HashSet::new();let mut total=0usize;let mut result=vec![];
 for f in files{
  if f.name.is_empty()||f.name.len()>180||f.name.starts_with('.')||f.name.contains(['/', '\\', ':','\0'])||f.name.chars().any(|c|c.is_control())||f.name.ends_with(['.',' '])||!seen.insert(f.name.to_lowercase()){return Err("Invalid or duplicate export filename".into())}
  let stem=f.name.split('.').next().unwrap_or("").to_uppercase();if ["CON","PRN","AUX","NUL"].contains(&stem.as_str())||(1..=9).any(|i|stem==format!("COM{i}")||stem==format!("LPT{i}")){return Err("Reserved export filename".into())}
  if f.data.len()>180*1024*1024{return Err("Export file exceeds memory limit".into())}
  let bytes=match f.encoding.as_str(){"utf8"=>f.data.into_bytes(),"base64"=>base64::engine::general_purpose::STANDARD.decode(f.data).map_err(|_|"Invalid export base64")?,_=>return Err("Unsupported export encoding".into())};
  total=total.checked_add(bytes.len()).ok_or("Export too large")?;if total>256*1024*1024{return Err("Export batch exceeds256MB limit".into())}result.push((f.name,bytes));
 }Ok(result)
}
pub fn write_batch(directory:&str,files:Vec<ExportFile>)->Result<ExportOutcome,String>{write_batch_with(directory,files,|_,_|Ok(()))}
fn write_batch_with(directory:&str,files:Vec<ExportFile>,mut before:impl FnMut(usize,&Path)->Result<(),String>)->Result<ExportOutcome,String>{
 let files=validate(files)?;let requested=PathBuf::from(directory);let basename=requested.file_name().and_then(|s|s.to_str()).filter(|s|!s.is_empty()).ok_or("Invalid export directory")?;
 let parent=requested.parent().filter(|p|!p.as_os_str().is_empty()).unwrap_or(Path::new("."));std::fs::create_dir_all(parent).map_err(|e|format!("Cannot prepare export directory: {e}"))?;
 let lock=std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(parent.join(".desel-export.lock")).map_err(|e|e.to_string())?;lock.lock_exclusive().map_err(|e|e.to_string())?;
 let mut target=requested.clone();let mut suffix=2;while target.exists(){if suffix>10000{return Err("Too many export folders".into())}target=parent.join(format!("{basename}-{suffix}"));suffix+=1;}
 let stage=parent.join(format!(".desel-export-{}",uuid::Uuid::new_v4()));std::fs::create_dir(&stage).map_err(|e|e.to_string())?;
 let result=(||{for(index,(name,bytes))in files.iter().enumerate(){before(index,&stage)?;let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(stage.join(name)).map_err(|e|format!("Cannot stage {name}: {e}"))?;file.write_all(bytes).and_then(|_|file.sync_all()).map_err(|e|format!("Cannot write {name}: {e}"))?;}
  if target.exists(){return Err("Export destination appeared while writing; retry".into())}std::fs::rename(&stage,&target).map_err(|e|format!("Cannot publish export folder: {e}"))?;
  Ok(ExportOutcome{directory:target.to_string_lossy().into(),files:files.iter().map(|(n,_)|target.join(n).to_string_lossy().into()).collect()})})();
 if result.is_err(){let _=std::fs::remove_dir_all(&stage);}let _=FileExt::unlock(&lock);result
}
#[cfg(test)]mod tests{use super::*;
fn file(name:&str,encoding:&str,data:&str)->ExportFile{ExportFile{name:name.into(),encoding:encoding.into(),data:data.into()}}
#[test]fn invalid_later_file_leaves_destination_untouched(){let root=std::env::temp_dir().join(format!("export-invalid-{}",uuid::Uuid::new_v4()));let target=root.join("deck");assert!(write_batch(target.to_str().unwrap(),vec![file("caption.txt","utf8","new"),file("01.png","base64","invalid!")]).is_err());assert!(!root.exists());for name in ["../outside","x/y","x\\y","CON.txt","a.","a:"]{assert!(validate(vec![file(name,"utf8","x")]).is_err());}assert!(validate(vec![file("A.png","utf8","x"),file("a.png","utf8","y")]).is_err());assert!(validate(vec![file("good","other","x")]).is_err());}
#[test]fn stage_failure_cleans_and_existing_exports_are_not_overwritten(){let root=std::env::temp_dir().join(format!("export-stage-{}",uuid::Uuid::new_v4()));let target=root.join("deck");std::fs::create_dir_all(&target).unwrap();std::fs::write(target.join("caption.txt"),"old").unwrap();let batch=||vec![file("01.png","base64","aW1hZ2U="),file("caption.txt","utf8","new")];assert!(write_batch_with(target.to_str().unwrap(),batch(),|i,_|if i==1{Err("forced disk failure".into())}else{Ok(())}).is_err());assert_eq!(std::fs::read_to_string(target.join("caption.txt")).unwrap(),"old");assert!(!root.join("deck-2").exists());assert!(!std::fs::read_dir(&root).unwrap().flatten().any(|e|e.file_name().to_string_lossy().starts_with(".desel-export-")));let result=write_batch(target.to_str().unwrap(),batch()).unwrap();assert_eq!(result.directory,root.join("deck-2").to_string_lossy());assert_eq!(std::fs::read(root.join("deck-2/01.png")).unwrap(),b"image");assert_eq!(std::fs::read_to_string(target.join("caption.txt")).unwrap(),"old");let _=std::fs::remove_dir_all(root);}
}
