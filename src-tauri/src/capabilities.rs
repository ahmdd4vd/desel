//! Advertised model capabilities, never inferred from a model name.
use serde::{Serialize,Deserialize};
use serde_json::{Value,json};
use crate::model::AppSettings;
#[derive(Debug,Clone,Serialize,Deserialize,Default)]
#[serde(rename_all="camelCase")]
pub struct ModelCapability {
 pub id:String,
 #[serde(default)] pub name:Option<String>,
 #[serde(default)] pub context_window:Option<u64>,
 #[serde(default)] pub max_output:Option<u64>,
 #[serde(default)] pub reasoning:Option<bool>,
 #[serde(default)] pub metadata_origin:Option<String>,
 #[serde(default)] pub discovered_at:Option<String>,
 #[serde(default)] pub provider:Option<String>,
 #[serde(default)] pub tools:Option<bool>,
 pub input_modalities:Vec<String>,
 pub efforts:Vec<String>,
 pub default_effort:Option<String>,
 pub reasoning_mandatory:bool,
 pub source:String,
}
pub fn parse_models(payload:&Value,source:&str)->Vec<ModelCapability>{
 payload.get("data").and_then(Value::as_array).into_iter().flatten().filter_map(|m|{
 let id=m.get("id")?.as_str()?.to_string();
 let strings=|v:Option<&Value>|v.and_then(Value::as_array).map(|a|a.iter().filter_map(Value::as_str).map(str::to_owned).collect::<Vec<_>>()).unwrap_or_default();
 let modalities=strings(m.get("input_modalities").or_else(||m.pointer("/architecture/input_modalities")).or_else(||m.pointer("/modalities/input")));
 let limit=|paths:&[&str]|paths.iter().filter_map(|p|m.pointer(p).and_then(Value::as_u64)).find(|n|*n>0);
 let mut efforts=strings(m.pointer("/effort/supported_levels").or_else(||m.pointer("/reasoning/supported_efforts")).or_else(||m.get("reasoning_levels")));
 if efforts.is_empty(){efforts=m.get("supported_reasoning_levels").and_then(Value::as_array).into_iter().flatten().filter_map(|v|v.as_str().or_else(||v.get("effort").and_then(Value::as_str))).map(str::to_owned).collect();}
 efforts.sort();efforts.dedup();
 let order=["none","minimal","low","medium","high","xhigh","max","ultra"];
 efforts.sort_by_key(|v|order.iter().position(|x|x==v).unwrap_or(100));
 Some(ModelCapability{id,name:m.get("display_name").or_else(||m.get("name")).and_then(Value::as_str).map(str::to_owned),
 context_window:limit(&["/max_input_tokens","/context_length","/context_window","/limit/input","/limit/context","/top_provider/context_length"]),
 max_output:limit(&["/max_output_tokens","/limit/output","/top_provider/max_completion_tokens"]),
 reasoning:m.get("reasoning").and_then(Value::as_bool),metadata_origin:None,discovered_at:Some(chrono::Utc::now().to_rfc3339()),
 provider:m.get("owned_by").and_then(Value::as_str).map(str::to_owned),tools:m.get("tools").and_then(Value::as_bool),input_modalities:modalities,efforts,default_effort:m.pointer("/effort/default_level").or_else(||m.pointer("/reasoning/default_effort")).and_then(Value::as_str).map(str::to_owned),reasoning_mandatory:m.pointer("/reasoning/mandatory").and_then(Value::as_bool).unwrap_or(false),source:source.into()})
 }).collect()
}
pub fn configure(body:&mut Value,s:&AppSettings)->Result<(),String>{
 let effort=s.reasoning_effort.as_deref().unwrap_or("auto");
 if effort=="auto" {return Ok(())}
 let model=s.model_capabilities.iter().find(|m|m.id==s.model && m.source==s.base_url).ok_or("Ambil metadata model dari Base URL ini sebelum memilih effort. Pilih Auto jika tidak tersedia.")?;
 if !model.efforts.iter().any(|v|v==effort){return Err(format!("Effort {effort} tidak diiklankan oleh model ini. Pilih Auto atau ambil ulang metadata."))}
 let host=reqwest::Url::parse(&s.base_url).ok().and_then(|u|u.host_str().map(str::to_owned)).unwrap_or_default();
 if host=="openrouter.ai" {body["reasoning"]=json!({"effort":effort});}
 else if s.provider_kind.starts_with("magpie") || host=="api.deepseek.com" || host=="api.openai.com" {body["reasoning_effort"]=json!(effort);if host=="api.deepseek.com"{body["thinking"]=json!({"type":"enabled"});}}
 else {return Err("Metadata effort tersedia, tetapi pemetaan request provider custom belum dikonfirmasi. Pilih Auto.".into())}
 // Temperature is not portable across reasoning modes. Omit rather than send
 // a parameter known to be ignored/rejected by several reasoning models.
 body.as_object_mut().unwrap().remove("temperature");
 Ok(())
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn magpie_metadata_and_effort_roundtrip(){
 let payload=json!({"data":[{"id":"workbuddy/model-a","display_name":"Model A","owned_by":"workbuddy","context_length":1000000,"max_output_tokens":64000,"reasoning":true,"supported_reasoning_levels":[{"effort":"high"},{"effort":"low"}],"modalities":{"input":["text","image"]}}]});
 let mut settings=AppSettings::default();settings.provider_kind="magpie".into();settings.base_url="http://127.0.0.1:3425/v1".into();settings.model="workbuddy/model-a".into();settings.model_capabilities=parse_models(&payload,&settings.base_url);settings.reasoning_effort=Some("high".into());
 let m=&settings.model_capabilities[0];assert_eq!(m.context_window,Some(1000000));assert_eq!(m.max_output,Some(64000));assert_eq!(m.efforts,vec!["low","high"]);assert!(m.input_modalities.contains(&"image".into()));
 let mut b=json!({"temperature":0.8});configure(&mut b,&settings).unwrap();assert_eq!(b["reasoning_effort"],"high");assert!(b.get("temperature").is_none());settings.reasoning_effort=Some("max".into());assert!(configure(&mut b,&settings).is_err());
 }
 #[test]fn unknown_limits_stay_unknown_and_old_settings_migrate(){let old=json!({"baseUrl":"https://api.openai.com/v1","model":"m","apiKey":"test"});let s:AppSettings=serde_json::from_value(old).unwrap();assert!(s.connections.is_empty());assert_eq!(s.api_key,"test");let oldcap=json!({"id":"m","inputModalities":[],"efforts":[],"defaultEffort":null,"reasoningMandatory":false,"source":"url"});let m:ModelCapability=serde_json::from_value(oldcap).unwrap();assert_eq!(m.context_window,None);}
 #[test]fn metadata_stays_unknown_without_fields(){let m=parse_models(&json!({"data":[{"id":"fancy-thinking-xhigh"}]}),"custom");assert!(m[0].efforts.is_empty());assert!(m[0].input_modalities.is_empty());}
 #[test]fn reads_provider_metadata(){let m=parse_models(&json!({"data":[{"id":"a","input_modalities":["text","image"],"effort":{"supported_levels":["low","high","max"],"default_level":"high"}},{"id":"b","architecture":{"input_modalities":["text"]},"reasoning":{"supported_efforts":["medium","xhigh"],"mandatory":true}}]}),"url");assert_eq!(m[0].efforts,vec!["low","high","max"]);assert!(m[1].reasoning_mandatory);}
 #[test]fn sends_supported_effort_and_rejects_stale_or_custom(){let mut s=AppSettings::default();s.base_url="https://api.deepseek.com/v1".into();s.model="a".into();s.reasoning_effort=Some("max".into());s.model_capabilities=parse_models(&json!({"data":[{"id":"a","effort":{"supported_levels":["high","max"]}}]}),&s.base_url);let mut b=json!({"temperature":0.8});configure(&mut b,&s).unwrap();assert_eq!(b["reasoning_effort"],"max");assert!(b.get("temperature").is_none());s.base_url="https://custom.example/v1".into();assert!(configure(&mut b,&s).is_err());}
}
