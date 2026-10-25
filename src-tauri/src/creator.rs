//! Explicit per-request authority. Checks run at the executor, not only in prompts.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::model::Deck;
#[derive(Clone,Debug,Default,Deserialize,Serialize)]
#[serde(rename_all="camelCase")]
pub struct CreatorRequest {
 #[serde(default)]pub mode:String,
 pub slide_id:Option<String>,
 pub run_id:Option<String>,
 pub object_context:Option<ObjectContext>,
 #[serde(default)]pub asset_ids:Vec<String>,
 #[serde(default)]pub locked_slide_ids:Vec<String>,
 #[serde(default)]pub locked_objects:Vec<LockedObject>,
 #[serde(default)]pub memory:Vec<Memory>,
}
#[derive(Clone,Debug,Default,Deserialize,Serialize)]
#[serde(rename_all="camelCase")]
pub struct ObjectContext{pub slide_id:String,pub selector:String,pub label:String}
/// One canvas element the agent must not change, identified the same way the
/// canvas pins comments: a CSS-ish selector inside one slide document.
#[derive(Clone,Debug,Default,Deserialize,Serialize)]
#[serde(rename_all="camelCase")]
pub struct LockedObject{pub slide_id:String,pub selector:String,#[serde(default)]pub label:String}
#[derive(Clone,Debug,Default,Deserialize,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Memory{pub id:String,pub kind:String,pub text:String,pub source:String,pub pinned:bool,pub updated_at:String}
/// First element matching `selector`, as a tree node id.
fn find_node(tree:&ego_tree::Tree<scraper::node::Node>,selector:&str)->Option<ego_tree::NodeId>{
 let sel=scraper::Selector::parse(selector).ok()?;
 for node in tree.root().descendants(){
  if let Some(el)=scraper::ElementRef::wrap(node){if sel.matches(&el){return Some(node.id())}}
 }
 None
}
/// A targeted patch respects locks when it never touches a locked element,
/// anything inside it, or (for destructive ops) an ancestor containing it.
/// Unresolvable selectors are left to apply_patch's own error, not this check.
fn patch_respects_locks(html:&str,locks:&[&LockedObject],op:&str,selector:&str)->bool{
 if locks.is_empty(){return true}
 let effective=if selector.trim().is_empty(){if op=="append_html"{"body"}else{return true}}else{selector};
 let doc=scraper::Html::parse_document(html);
 let Some(tid)=find_node(&doc.tree,effective)else{return true};
 for lock in locks{
  let Some(lid)=find_node(&doc.tree,&lock.selector)else{continue}; // stale lock: the user changed the element by hand
  if tid==lid{return false}
  let target_is_ancestor=doc.tree.get(lid).map(|n|n.ancestors().any(|a|a.id()==tid)).unwrap_or(false);
  let target_is_descendant=doc.tree.get(tid).map(|n|n.ancestors().any(|a|a.id()==lid)).unwrap_or(false);
  match op{
   // Appending a sibling next to a locked element leaves the element intact.
   "append_html"=>{if target_is_descendant{return false}}
   _=>{if target_is_ancestor||target_is_descendant{return false}}
  }
 }
 true
}
/// A full-slide rewrite keeps every locked element present and byte-identical
/// after parse/serialize on both sides, else it is refused.
fn rewrite_preserves_locks(old_html:&str,new_html:&str,locks:&[&LockedObject])->bool{
 for lock in locks{
  let Ok(sel)=scraper::Selector::parse(&lock.selector)else{continue};
  let old=scraper::Html::parse_document(old_html).select(&sel).next().map(|e|e.html());
  let Some(old)=old else{continue}; // stale lock
  let new=scraper::Html::parse_document(new_html).select(&sel).next().map(|e|e.html());
  if new.as_deref()!=Some(old.as_str()){return false}
 }
 true
}
impl CreatorRequest{
 pub fn validate(&self,deck:&Deck)->Result<(),String>{
  if !["discuss","edit","produce"].contains(&self.mode.as_str()){return Err("Mode Creator Studio tidak valid".into())}
  if self.mode=="edit"&&self.slide_id.as_ref().map(|id|deck.slides.iter().any(|s|&s.id==id))!=Some(true){return Err("Slide konteks tidak ditemukan; brief belum dijalankan".into())}
  if self.mode=="edit"&&self.slide_id.as_ref().map(|id|self.locked_slide_ids.contains(id)).unwrap_or(false){return Err("Slide konteks terkunci. Buka kunci sebelum mode Edit.".into())}
  if let Some(o)=&self.object_context{if !deck.slides.iter().any(|s|s.id==o.slide_id)||o.selector.len()>2000||o.label.len()>300{return Err("Konteks objek kedaluwarsa/tidak valid. Pilih lagi di canvas.".into())}}
  if self.locked_objects.len()>100{return Err("Terlalu banyak objek terkunci (maks 100).".into())}
  for o in &self.locked_objects{
   if o.selector.len()>2000||o.label.len()>300{return Err("Kunci objek tidak valid.".into())}
   if !deck.slides.iter().any(|s|s.id==o.slide_id){return Err("Objek terkunci menunjuk slide yang tidak ada.".into())}
  }
  if self.memory.len()>80||self.memory.iter().any(|m|m.text.len()>4000||m.source.len()>2000)||self.asset_ids.len()>20{return Err("Konteks terlalu besar".into())}Ok(())
 }
 pub fn tool_allowed(&self,name:&str,args:&Value,deck:&Deck)->bool{
  let read=["read_deck","list_templates","ask_user","review_render","search_web","fetch_url","github_trending"];
  if self.mode=="discuss"{return read.contains(&name)}
  if read.contains(&name){return true}
  // Global replacements/meta aspect changes can indirectly change locked slides/objects.
  if ["set_deck_meta","load_template"].contains(&name){return self.mode=="produce"&&self.locked_slide_ids.is_empty()&&self.locked_objects.is_empty()}
  if ["write_slide","patch_slide","delete_slide"].contains(&name){
   let target=args["index"].as_u64().and_then(|i|deck.slides.get(i as usize));
   if let Some(s)=target{
    if self.locked_slide_ids.contains(&s.id){return false}
    let locks:Vec<&LockedObject>=self.locked_objects.iter().filter(|o|o.slide_id==s.id).collect();
    if !locks.is_empty(){
     match name{
      // Deleting the slide would destroy the locked elements with it.
      "delete_slide"=>return false,
      "patch_slide"=>{if !patch_respects_locks(&s.html,&locks,args["op"].as_str().unwrap_or(""),args["selector"].as_str().unwrap_or("")){return false}}
      "write_slide"=>{if !rewrite_preserves_locks(&s.html,args["html"].as_str().unwrap_or(""),&locks){return false}}
      _=>{}
     }
    }
   }
   if self.mode=="edit"{return target.map(|s|Some(&s.id)==self.slide_id.as_ref()).unwrap_or(false)}
   return true
  }
  self.mode=="produce" // edit mode cannot mutate external/global project resources
 }
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn discussion_is_read_only(){let c=CreatorRequest{mode:"discuss".into(),..Default::default()};let d=serde_json::from_value::<Deck>(serde_json::json!({"id":"d"})).unwrap();assert!(!c.tool_allowed("write_slide",&serde_json::json!({}),&d));assert!(c.tool_allowed("read_deck",&serde_json::json!({}),&d));}
}
#[cfg(test)]mod scope_tests{use super::*;use serde_json::json;
 fn d()->Deck{serde_json::from_value(json!({"id":"d","slides":[{"id":"s0"},{"id":"s1"}]})).unwrap()}
 #[test]fn locks_cannot_be_bypassed_with_rewrite_or_global_replace(){let c=CreatorRequest{mode:"produce".into(),locked_slide_ids:vec!["s0".into()],..Default::default()};for name in ["write_slide","patch_slide","delete_slide"]{assert!(!c.tool_allowed(name,&json!({"index":0}),&d()));assert!(c.tool_allowed(name,&json!({"index":1}),&d()));}assert!(!c.tool_allowed("load_template",&json!({}),&d()));assert!(!c.tool_allowed("set_deck_meta",&json!({"aspect":"1:1"}),&d()));}
 #[test]fn edit_mode_cannot_append_delete_other_or_mutate_global(){let c=CreatorRequest{mode:"edit".into(),slide_id:Some("s1".into()),..Default::default()};assert!(c.validate(&d()).is_ok());assert!(c.tool_allowed("patch_slide",&json!({"index":1}),&d()));for args in [json!({}),json!({"index":-1}),json!({"index":0}),json!({"index":99})]{assert!(!c.tool_allowed("write_slide",&args,&d()));}assert!(!c.tool_allowed("save_template",&json!({}),&d()));}
 #[test]fn missing_target_and_unknown_mode_rejected(){let c=CreatorRequest{mode:"edit".into(),slide_id:Some("gone".into()),..Default::default()};assert!(c.validate(&d()).is_err());assert!(CreatorRequest{mode:"hack".into(),..Default::default()}.validate(&d()).is_err());}
}
#[cfg(test)]mod object_lock_tests{use super::*;use serde_json::json;
 const HTML:&str="<!doctype html><html><body><div id=\"card\"><p>Preserve this</p></div><h1 id=\"heading\">Hi</h1></body></html>";
 fn deck()->Deck{serde_json::from_value(json!({"id":"d","slides":[{"id":"s0","html":HTML}]})).unwrap()}
 fn req()->CreatorRequest{CreatorRequest{mode:"produce".into(),locked_objects:vec![LockedObject{slide_id:"s0".into(),selector:"#card".into(),label:"Kartu".into()}],..Default::default()}}
 #[test]fn patch_on_locked_element_descendant_or_ancestor_refused(){
  let c=req();let d=deck();
  assert!(!c.tool_allowed("patch_slide",&json!({"index":0,"op":"set_text","selector":"#card","text":"x"}),&d));
  assert!(!c.tool_allowed("patch_slide",&json!({"index":0,"op":"set_text","selector":"#card p","text":"x"}),&d));
  assert!(!c.tool_allowed("patch_slide",&json!({"index":0,"op":"remove","selector":"#card"}),&d));
  assert!(!c.tool_allowed("patch_slide",&json!({"index":0,"op":"replace_html","selector":"body","html":"<p>y</p>"}),&d));
  assert!(!c.tool_allowed("patch_slide",&json!({"index":0,"op":"append_html","selector":"#card","html":"<p>y</p>"}),&d));
 }
 #[test]fn patch_outside_lock_and_sibling_append_allowed(){
  let c=req();let d=deck();
  assert!(c.tool_allowed("patch_slide",&json!({"index":0,"op":"set_text","selector":"#heading","text":"x"}),&d));
  assert!(c.tool_allowed("patch_slide",&json!({"index":0,"op":"append_html","selector":"body","html":"<p>y</p>"}),&d));
  assert!(c.tool_allowed("patch_slide",&json!({"index":0,"op":"append_html","html":"<p>y</p>"}),&d));
 }
 #[test]fn rewrite_must_keep_locked_element_intact(){
  let c=req();let d=deck();
  let same="<!doctype html><html><body><div id=\"card\"><p>Preserve this</p></div><h1 id=\"heading\">Changed</h1></body></html>";
  assert!(c.tool_allowed("write_slide",&json!({"index":0,"html":same}),&d));
  let changed="<!doctype html><html><body><div id=\"card\"><p>TAMPERED</p></div></body></html>";
  assert!(!c.tool_allowed("write_slide",&json!({"index":0,"html":changed}),&d));
  let missing="<!doctype html><html><body><h1 id=\"heading\">Hi</h1></body></html>";
  assert!(!c.tool_allowed("write_slide",&json!({"index":0,"html":missing}),&d));
 }
 #[test]fn delete_and_globals_refused_with_object_locks(){
  let c=req();let d=deck();
  assert!(!c.tool_allowed("delete_slide",&json!({"index":0}),&d));
  assert!(!c.tool_allowed("load_template",&json!({}),&d));
  assert!(!c.tool_allowed("set_deck_meta",&json!({"aspect":"1:1"}),&d));
  // New slide appends stay allowed.
  assert!(c.tool_allowed("write_slide",&json!({"html":"<!doctype html><html><body><p>baru</p></body></html>"}),&d));
 }
 #[test]fn stale_lock_does_not_block_and_edit_mode_still_scoped(){
  let c=CreatorRequest{mode:"produce".into(),locked_objects:vec![LockedObject{slide_id:"s0".into(),selector:"#gone".into(),label:"".into()}],..Default::default()};
  let d=deck();
  assert!(c.tool_allowed("patch_slide",&json!({"index":0,"op":"remove","selector":"#card"}),&d));
  let e=CreatorRequest{mode:"edit".into(),slide_id:Some("s0".into()),locked_objects:vec![LockedObject{slide_id:"s0".into(),selector:"#card".into(),label:"".into()}],..Default::default()};
  assert!(e.validate(&d).is_ok());
  assert!(!e.tool_allowed("patch_slide",&json!({"index":0,"op":"set_text","selector":"#card","text":"x"}),&d));
  assert!(e.tool_allowed("patch_slide",&json!({"index":0,"op":"set_text","selector":"#heading","text":"x"}),&d));
 }
 #[test]fn validate_rejects_bad_locks(){
  let d=deck();
  assert!(CreatorRequest{mode:"produce".into(),locked_objects:vec![LockedObject{slide_id:"ghost".into(),selector:"#a".into(),label:"".into()}],..Default::default()}.validate(&d).is_err());
  assert!(CreatorRequest{mode:"produce".into(),locked_objects:vec![LockedObject{slide_id:"s0".into(),selector:"x".repeat(2001),label:"".into()}],..Default::default()}.validate(&d).is_err());
  assert!(req().validate(&d).is_ok());
 }
}
