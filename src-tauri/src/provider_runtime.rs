//! App-owned Magpie runtime. No inherited account/config directories or frontend manager secrets.
use std::{path::{Path,PathBuf},process::{Child,Command,Stdio},sync::Mutex,time::Duration};
use serde::Serialize;
use tauri::Manager;
#[derive(Default)]pub struct ProviderRuntime(pub Mutex<Option<Running>>);
pub struct Running {child:Child,gateway:String,manager:String,}
#[derive(Serialize)]#[serde(rename_all="camelCase")]pub struct RuntimeStatus {pub running:bool,pub gateway_url:Option<String>,pub version:String,pub managed:bool}
impl ProviderRuntime {
 pub fn stop(&self){if let Some(mut r)=self.0.lock().unwrap().take(){#[cfg(unix)]{let _=Command::new("kill").args(["-TERM","--",&format!("-{}",r.child.id())]).status();}
 #[cfg(windows)]{let _=Command::new("taskkill").args(["/PID",&r.child.id().to_string(),"/T","/F"]).stdout(Stdio::null()).stderr(Stdio::null()).status();}
 let _=r.child.kill();let _=r.child.wait();}}
 pub fn status(&self)->RuntimeStatus{let mut g=self.0.lock().unwrap();let live=g.as_mut().map(|r|r.child.try_wait().ok().flatten().is_none()).unwrap_or(false);if !live{g.take();}RuntimeStatus{running:live,gateway_url:g.as_ref().map(|r|r.gateway.clone()),version:"0.1.1404".into(),managed:true}}
}
impl Drop for ProviderRuntime {fn drop(&mut self){self.stop();}}
fn port()->Result<u16,String>{Ok(std::net::TcpListener::bind("127.0.0.1:0").map_err(|e|e.to_string())?.local_addr().map_err(|e|e.to_string())?.port())}
fn binary_name()->Result<&'static str,String>{
 #[cfg(all(target_os="linux",target_arch="x86_64"))]{return Ok("magpie-linux-amd64")}
 #[cfg(all(target_os="windows",target_arch="x86_64"))]{return Ok("magpie-windows-amd64.exe")}
 #[allow(unreachable_code)]Err("Runtime Magpie belum dibundel untuk platform ini.".into())
}
fn locate(app:&tauri::AppHandle)->Result<PathBuf,String>{let name=binary_name()?;let bundled=app.path().resource_dir().map_err(|e|e.to_string())?.join("binaries").join(name);if bundled.is_file(){return Ok(bundled)}let dev=Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join(name);if cfg!(debug_assertions)&&dev.is_file(){return Ok(dev)}Err("Runtime provider tidak ditemukan dalam paket Desel. Pasang ulang paket Desel lengkap, tidak perlu instal Magpie sendiri.".into())}
fn spawn_at(binary:&Path,root:&Path)->Result<Running,String>{
 std::fs::create_dir_all(root.join("home")).map_err(|e|e.to_string())?;
 let config=root.join("config");std::fs::create_dir_all(config.join("magpie")).map_err(|e|e.to_string())?;
 let file=config.join("magpie/settings.json");let mut prefs:serde_json::Value=std::fs::read(&file).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or_else(||serde_json::json!({}));
 if !prefs.is_object(){return Err("Pengaturan runtime rusak; tidak ditimpa otomatis.".into())}
 for key in ["noAutoUpdate","noAutoDownload","noAccountDiscovery","noStats"]{prefs[key]=serde_json::json!(true);}
 std::fs::write(&file,serde_json::to_vec_pretty(&prefs).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
 let gateway_port=port()?;let mut web_port=port()?;while web_port==gateway_port{web_port=port()?;}
 let key=uuid::Uuid::new_v4().simple().to_string();let gateway=format!("http://127.0.0.1:{gateway_port}/v1");let manager=format!("http://127.0.0.1:{web_port}/?k={key}");
 let mut cmd=Command::new(binary);cmd.args(["web","--no-open","--gateway","--addr",&format!("127.0.0.1:{web_port}")]);
 #[cfg(unix)]{use std::os::unix::process::CommandExt;cmd.process_group(0);}
 cmd.env_clear().env("PATH",std::env::var_os("PATH").unwrap_or_default()).env("HOME",root.join("home")).env("USERPROFILE",root.join("home")).env("XDG_CONFIG_HOME",&config).env("XDG_DATA_HOME",root.join("data")).env("XDG_CACHE_HOME",root.join("cache")).env("CODEX_HOME",root.join("home/.codex")).env("CLAUDE_CONFIG_DIR",root.join("home/.claude")).env("APPDATA",root.join("config")).env("LOCALAPPDATA",root.join("data")).env("DO_NOT_TRACK","1").env("MAGPIE_WEB_KEY",key).env("MAGPIE_ADDR",format!("127.0.0.1:{gateway_port}"));
 #[cfg(target_os="windows")] {use std::os::windows::process::CommandExt;cmd.creation_flags(0x08000000);if let Some(v)=std::env::var_os("SystemRoot"){cmd.env("SystemRoot",v);}}
 let child=cmd.current_dir(root).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e|format!("Runtime provider gagal dimulai: {e}"))?;
 Ok(Running{child,gateway,manager})
}
#[tauri::command]pub fn provider_runtime_status(runtime:tauri::State<'_,ProviderRuntime>)->RuntimeStatus{runtime.status()}
#[tauri::command]pub async fn provider_runtime_start(app:tauri::AppHandle)->Result<RuntimeStatus,String>{
 let runtime=app.state::<ProviderRuntime>();if runtime.status().running{return Ok(runtime.status())}
 let binary=locate(&app)?;let root=app.path().app_data_dir().map_err(|e|e.to_string())?.join("provider-runtime");
 {let mut g=runtime.0.lock().unwrap();if g.is_none(){*g=Some(spawn_at(&binary,&root)?);}}
 let url=runtime.status().gateway_url.ok_or("Runtime berhenti saat startup")?;
 let client=reqwest::Client::builder().timeout(Duration::from_millis(300)).build().map_err(|e|e.to_string())?;
 for _ in 0..80{if !runtime.status().running{return Err("Runtime provider berhenti saat startup. Data akun tetap disimpan lokal.".into())}if client.get(format!("{url}/models")).send().await.map(|r|r.status().is_success()).unwrap_or(false){return Ok(runtime.status())}tokio::time::sleep(Duration::from_millis(100)).await;}
 runtime.stop();Err("Runtime provider belum siap setelah batas startup. Coba mulai ulang dari Desel.".into())
}
#[tauri::command]pub fn provider_runtime_stop(app:tauri::AppHandle){if let Some(w)=app.get_webview_window("provider-manager"){let _=w.close();}app.state::<ProviderRuntime>().stop();}
#[tauri::command]pub async fn provider_runtime_manage(app:tauri::AppHandle)->Result<(),String>{
 let runtime=app.state::<ProviderRuntime>();if !runtime.status().running{return Err("Mulai runtime provider dulu.".into())}
 if let Some(w)=app.get_webview_window("provider-manager"){w.set_focus().map_err(|e|e.to_string())?;return Ok(())}
 let url={runtime.0.lock().unwrap().as_ref().ok_or("Runtime belum dimulai")?.manager.parse().map_err(|_|"Alamat runtime tidak valid")?};
 tauri::WebviewWindowBuilder::new(&app,"provider-manager",tauri::WebviewUrl::External(url)).title("Desel - Provider & akun").inner_size(1120.,820.).initialization_script(r#"
 document.addEventListener('DOMContentLoaded',()=>{
 const banner=document.createElement('div');banner.textContent='Desel provider manager · Claude API and subscription login have different terms. Claude.ai subscription auth is not offered by Desel. Community plugins are executable third-party code.';banner.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#14251c;color:#ecf5ef;padding:9px 16px;font:12px/1.5 sans-serif;pointer-events:none';document.body.append(banner);
 const lock=()=>document.querySelectorAll('button').forEach(b=>{if(b.title.startsWith('Claude subscription')){b.disabled=true;b.title='Claude.ai subscription login is not offered in Desel. Use Anthropic API.';}});lock();new MutationObserver(lock).observe(document.body,{childList:true,subtree:true});
 });
 "#).build().map_err(|e|e.to_string())?;Ok(())
}
pub async fn resolve(app:&tauri::AppHandle,settings:&mut crate::model::AppSettings)->Result<(),String>{
 if settings.provider_kind!="magpie-managed"{return Ok(())}
 let status=provider_runtime_start(app.clone()).await?;let url=status.gateway_url.ok_or("Gateway bawaan belum siap")?;
 for c in &mut settings.model_capabilities{if c.source==settings.base_url{c.source=url.clone();}}
 settings.base_url=url;settings.api_key.clear();Ok(())
}
#[cfg(test)]mod tests{use super::*;
 #[tokio::test]async fn actual_bundled_runtime_lifecycle_and_manager_guard(){let root=std::env::temp_dir().join(format!("desel-runtime-{}",uuid::Uuid::new_v4()));let binary=Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join(binary_name().unwrap());let running=spawn_at(&binary,&root).unwrap();let gateway=running.gateway.clone();let manager=running.manager.clone();let runtime=ProviderRuntime(Mutex::new(Some(running)));let client=reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap();let mut ready=false;for _ in 0..100{if client.get(format!("{gateway}/models")).send().await.map(|r|r.status().is_success()).unwrap_or(false){ready=true;break}tokio::time::sleep(Duration::from_millis(100)).await;}assert!(ready,"actual bundled gateway not ready");let page=client.get(manager).send().await.unwrap();assert!(page.status().is_redirection()||page.status().is_success(),"manager {}",page.status());let guard=client.get(page.url().as_str().split('?').next().unwrap()).send().await.unwrap();assert_eq!(guard.status(),reqwest::StatusCode::UNAUTHORIZED);let base=runtime.0.lock().unwrap().as_ref().unwrap().manager.clone();
 let added=management_http(&base,"/api/provider/save",Some(serde_json::json!({"name":"Desel fixture","chat":"http://127.0.0.1:1/v1","models":["fixture"],"key":"local-fixture-value","new":true}))).await.unwrap();
 let providers=added["providers"].as_array().unwrap();let id=providers.iter().find(|p|p["name"]=="Desel fixture").unwrap()["id"].as_str().unwrap().to_owned();
 let mut safe=added.clone();clean(&mut safe);assert!(!safe.to_string().contains("local-fixture-value"));
 let keys=management_http(&base,"/api/keys/add",Some(serde_json::json!({"id":id,"key":"second-local-fixture","name":"second fixture"}))).await.unwrap();
 let row=keys["providers"].as_array().unwrap().iter().find(|p|p["id"]==id).unwrap();let reference=row["keyList"].as_array().unwrap().iter().find(|k|k["name"]=="second fixture").unwrap()["id"].as_str().unwrap().to_string();assert!(account_reference_exists(&keys,&id,&reference));
 for op in ["use","off","on","remove"]{management_http(&base,&format!("/api/keys/{op}"),Some(serde_json::json!({"id":id,"ref":reference}))).await.unwrap();}
 management_http(&base,"/api/provider/off",Some(serde_json::json!({"id":id}))).await.unwrap();
 management_http(&base,"/api/provider/delete",Some(serde_json::json!({"id":id}))).await.unwrap();
 let catalog=management_http(&base,"/api/plugins/listings",None).await.unwrap();assert!(catalog["listings"].is_array(),"actual catalog response shape");
 runtime.stop();assert!(!runtime.status().running);assert!(std::fs::read(root.join("config/magpie/settings.json")).unwrap().len()>0);let _=std::fs::remove_dir_all(root);}
}

async fn manage_request(app:&tauri::AppHandle,path:&str,body:Option<serde_json::Value>)->Result<serde_json::Value,String>{
 provider_runtime_start(app.clone()).await?;
 let link={app.state::<ProviderRuntime>().0.lock().unwrap().as_ref().ok_or("Runtime belum siap")?.manager.clone()};
 management_http(&link,path,body).await
}
async fn management_http(link:&str,path:&str,body:Option<serde_json::Value>)->Result<serde_json::Value,String>{
 let u=reqwest::Url::parse(&link).map_err(|e|e.to_string())?;let origin=format!("{}://{}:{}",u.scheme(),u.host_str().unwrap_or("127.0.0.1"),u.port().ok_or("Port pengelola tidak ada")?);
 let client=reqwest::Client::builder().timeout(Duration::from_secs(if matches!(path,"/api/plugins/add"|"/api/plugins/upgrade"){330}else{90})).redirect(reqwest::redirect::Policy::none()).build().map_err(|e|e.to_string())?;
 let auth=client.get(link).send().await.map_err(|_|"Sesi pengelola tidak merespons".to_string())?;
 let cookie=auth.headers().get(reqwest::header::SET_COOKIE).and_then(|v|v.to_str().ok()).and_then(|s|s.split(';').next()).ok_or("Sesi pengelola runtime tidak tersedia")?.to_string();
 let url=format!("{origin}{path}");let req=if let Some(value)=body{client.post(url).header(reqwest::header::ORIGIN,&origin).json(&value)}else{client.get(url)};
 let response=req.header(reqwest::header::COOKIE,cookie).send().await.map_err(|_|"Pengelola provider tidak merespons".to_string())?;
 let status=response.status();let mut response=response;let mut bytes=Vec::new();while let Some(chunk)=response.chunk().await.map_err(|_|"Respons pengelola tidak terbaca")?{if bytes.len()+chunk.len()>4*1024*1024{return Err("Respons pengelola terlalu besar".into())}bytes.extend_from_slice(&chunk);}
 if !status.is_success(){return Err(format!("Pengelola provider: HTTP {status}. Periksa konfigurasi atau coba ulang."))}
 if bytes.is_empty(){return Ok(serde_json::json!({"ok":true}))}
 serde_json::from_slice(&bytes).map_err(|_|"Respons pengelola bukan JSON".into())
}
fn clean(value:&mut serde_json::Value){match value{serde_json::Value::Object(m)=>{m.retain(|k,_|!matches!(k.to_lowercase().as_str(),"key"|"keys"|"token"|"access_token"|"refresh_token"|"auth"|"headers"|"balancetoken"|"secretaccesskey"|"gateway"|"calls"|"api_key"|"apikey"|"options"|"optionsexample"|"accesstoken"|"refreshtoken"|"secret"|"password"));for v in m.values_mut(){clean(v)}},serde_json::Value::Array(xs)=>for v in xs{clean(v)},_=>{}}}
#[tauri::command]pub async fn provider_management(app:tauri::AppHandle,action:String,payload:Option<serde_json::Value>)->Result<serde_json::Value,String>{
 let p=payload.unwrap_or_else(||serde_json::json!({}));
 let (path,body)=match action.as_str(){
 "providers"=>("/api/providers".to_string(),None),"plugins"=>("/api/plugins".to_string(),None),"market"=>("/api/plugins/market".to_string(),None),
 "plugin_auto"=>{let installed=manage_request(&app,"/api/plugins",None).await?;let next=auto_update_spec(&p,&installed)?;("/api/plugins/add".into(),Some(serde_json::json!({"spec":next})))},
 "plugin_check"=>("/api/plugins/check".to_string(),Some(serde_json::json!({}))),
 "plugin_upgrade"=>{if p.get("confirmed").and_then(|x|x.as_bool())!=Some(true){return Err("Konfirmasi pembaruan kode plugin diperlukan".into())}("/api/plugins/upgrade".into(),Some(serde_json::json!({"spec":p["spec"]})))},
 "account_use"|"account_remove"|"account_on"|"account_off"=>{let id=p.get("id").and_then(|x|x.as_str()).ok_or("Provider kosong")?;let reference=p.get("ref").and_then(|x|x.as_str()).ok_or("Referensi akun kosong")?;let state=manage_request(&app,"/api/providers",None).await?;if !account_reference_exists(&state,id,reference){return Err("Akun tidak ditemukan atau status berubah. Segarkan daftar.".into())}let op=action.trim_start_matches("account_");(format!("/api/keys/{op}"),Some(serde_json::json!({"id":id,"ref":reference})))},
 "provider_add"=>{let preset=p.get("preset").and_then(|v|v.as_str()).unwrap_or("");let mut v=serde_json::json!({"preset":preset,"name":p["name"],"key":p["key"],"new":true});if preset.is_empty(){let endpoint=p.get("endpoint").and_then(|v|v.as_str()).ok_or("Isi endpoint provider")?;let u=reqwest::Url::parse(endpoint).map_err(|_|"Endpoint tidak valid")?;if !matches!(u.scheme(),"http"|"https")||u.password().is_some()||!u.username().is_empty(){return Err("Endpoint provider tidak valid".into())}let field=if p.get("protocol").and_then(|v|v.as_str())==Some("anthropic"){"anthropic"}else{"chat"};v[field]=serde_json::json!(endpoint);v["models"]=p.get("models").cloned().unwrap_or_else(||serde_json::json!([]));}("/api/provider/save".into(),Some(v))},
 "provider_on"|"provider_off"|"provider_delete"=>{let op=action.trim_start_matches("provider_");(format!("/api/provider/{op}"),Some(serde_json::json!({"id":p["id"]})))},
 "plugin_prompt"=>("/api/plugin-signin/prompt".into(),Some(serde_json::json!({"provider":p["provider"],"method":p["method"],"inputs":p["inputs"],"key":p["key"],"value":p["value"]}))),
 "plugin_signin"=>{if p.get("provider").and_then(|x|x.as_str()).unwrap_or("").contains("anthropic"){return Err("Claude.ai subscription login tidak ditawarkan Desel".into())}("/api/plugin-signin".into(),Some(serde_json::json!({"provider":p["provider"],"method":p["method"],"inputs":p["inputs"],"key":p["key"]})))},
 "signin_status"|"signin_cancel"|"signin_callback"=>{let id=p.get("id").and_then(|v|v.as_str()).ok_or("ID login kosong")?;if id.is_empty()||!id.chars().all(|c|c.is_ascii_alphanumeric()||c=='-'||c=='_'){return Err("ID login tidak valid".into())}let path=format!("/api/signin/{id}");match action.as_str(){"signin_status"=>(path,None),"signin_cancel"=>(format!("{path}/cancel"),Some(serde_json::json!({}))),_=>(format!("{path}/callback"),Some(serde_json::json!({"url":p["url"]}))) }},
 "plugin_add"=>{if p.get("confirmed").and_then(|v|v.as_bool())!=Some(true){return Err("Konfirmasi instalasi kode plugin diperlukan".into())}let spec=p.get("spec").and_then(|v|v.as_str()).ok_or("Isi paket dan versi")?;if !pinned_npm_spec(spec){return Err("Gunakan paket npm dengan versi tetap, misalnya @scope/plugin@1.2.3. URL, branch, tag latest, dan rentang versi belum didukung Desel.".into())}("/api/plugins/add".into(),Some(serde_json::json!({"spec":spec})))},
 "plugin_off"|"plugin_remove"=>{(format!("/api/plugins/{}",if action=="plugin_remove"{"remove"}else{"off"}),Some(serde_json::json!({"spec":p["spec"],"off":p["off"]})))},
 // Built-in subscription OAuth is deliberately not offered until eligible own-client routes are qualified.
 _=>return Err("Aksi pengelola provider belum didukung Desel".into())};
 let mut result=manage_request(&app,&path,body).await?;if !matches!(action.as_str(),"plugin_prompt"|"plugin_signin"|"signin_status"){clean(&mut result);}
 if action=="providers"||action.starts_with("account_"){result=project_providers(&result);}
 if matches!(action.as_str(),"plugins"|"plugin_add"|"plugin_off"|"plugin_remove"|"plugin_upgrade"|"plugin_auto"){result=project_plugins(&result);}
 Ok(result)
}

fn keep_fields(v:&serde_json::Value,fields:&[&str])->serde_json::Value{let mut m=serde_json::Map::new();for key in fields{if let Some(x)=v.get(*key){m.insert((*key).into(),x.clone());}}serde_json::Value::Object(m)}
fn project_providers(v:&serde_json::Value)->serde_json::Value{
 let rows=|key:&str,fields:&[&str]|v.get(key).and_then(|x|x.as_array()).into_iter().flatten().map(|p|{let mut row=keep_fields(p,fields);if let Some(keys)=p.get("keyList").and_then(|x|x.as_array()){row["keyList"]=serde_json::Value::Array(keys.iter().map(|k|keep_fields(k,&["id","name","masked","active","on"])).collect());}row}).collect::<Vec<_>>();
 serde_json::json!({"providers":rows("providers",&["id","name","host","off","preset","models","keyList"]),"presets":rows("presets",&["id","name","kind","noKey","vertex","accessKey"]),"plugins":rows("plugins",&["id","pid","name","signedIn","models","methods"])})
}
fn project_plugins(v:&serde_json::Value)->serde_json::Value{let rows=v.get("plugins").and_then(|x|x.as_array()).into_iter().flatten().map(|p|{let mut row=keep_fields(p,&["spec","package","version","off","providers","error","latest","autoUpdate","updateError","autoUpdated"]);let spec=p.get("spec").and_then(|x|x.as_str()).unwrap_or("");row["autoUpdate"]=serde_json::json!(spec.starts_with("@magpie-community/")&&spec.ends_with("@latest"));row}).collect::<Vec<_>>();serde_json::json!({"plugins":rows})}
#[cfg(test)]mod management_safety_tests{use super::*;#[test]fn private_fields_never_enter_provider_projection(){assert!(pinned_npm_spec("@scope/plugin@1.2.3"));assert!(!pinned_npm_spec("@scope/plugin@latest"));assert!(!pinned_npm_spec("https://example.invalid/p@1.2.3"));let mut x=serde_json::json!({"providers":[{"id":"p","name":"p","key":"secret-value","headers":{"Authorization":"Bearer hidden"},"models":[],"options":{"password":"secret-option"}}],"gateway":{"key":"s"},"plugins":[{"spec":"x","options":{"apiKey":"secret"},"providers":["a"]}]});clean(&mut x);assert!(!x.to_string().contains("secret"));assert!(project_providers(&x).get("gateway").is_none());assert!(!project_plugins(&x).to_string().contains("options"));}}

fn pinned_npm_spec(spec:&str)->bool{let Some((name,version))=spec.rsplit_once('@')else{return false};let package_ok=!name.is_empty()&&name.chars().all(|c|c.is_ascii_alphanumeric()||matches!(c,'@'|'/'|'_'|'-'|'.'))&&!name.contains("..");package_ok&&semver::Version::parse(version).is_ok()}

fn auto_update_spec(p:&serde_json::Value,installed:&serde_json::Value)->Result<String,String>{
 if p.get("confirmed").and_then(|x|x.as_bool())!=Some(true){return Err("Konfirmasi perubahan kebijakan kode plugin diperlukan".into())}
 let spec=p.get("spec").and_then(|x|x.as_str()).ok_or("Paket kosong")?;
 let row=installed.get("plugins").and_then(|x|x.as_array()).and_then(|xs|xs.iter().find(|x|x.get("spec").and_then(|s|s.as_str())==Some(spec))).ok_or("Plugin belum terpasang atau status berubah. Segarkan daftar.")?;
 let (name,_)=spec.rsplit_once('@').ok_or("Paket tanpa versi")?;
 if !name.starts_with("@magpie-community/")||!pinned_npm_spec(&format!("{name}@1.0.0")){return Err("Otomatis hanya untuk paket komunitas Magpie yang dipilih secara eksplisit".into())}
 let on=p.get("on").and_then(|x|x.as_bool()).ok_or("Pilihan kebijakan kosong")?;
 if on{return Ok(format!("{name}@latest"))}
 let version=row.get("version").and_then(|x|x.as_str()).ok_or("Versi terpasang belum dilaporkan runtime")?;
 if semver::Version::parse(version).is_err(){return Err("Versi runtime tidak valid, tidak dapat mengunci".into())}Ok(format!("{name}@{version}"))
}
#[cfg(test)]mod update_policy_tests{use super::*;#[test]fn requires_installed_package_and_consent(){let state=serde_json::json!({"plugins":[{"spec":"@magpie-community/example@1.2.3","version":"1.2.4"}]});let mut p=serde_json::json!({"spec":"@magpie-community/example@1.2.3","on":true,"confirmed":true});assert_eq!(auto_update_spec(&p,&state).unwrap(),"@magpie-community/example@latest");p["on"]=serde_json::json!(false);p["version"]=serde_json::json!("9.9.9");assert_eq!(auto_update_spec(&p,&state).unwrap(),"@magpie-community/example@1.2.4");p["confirmed"]=serde_json::json!(false);assert!(auto_update_spec(&p,&state).is_err());p["confirmed"]=serde_json::json!(true);p["spec"]=serde_json::json!("@magpie-community/absent@1.2.3");assert!(auto_update_spec(&p,&state).is_err());}#[test]fn policy_projection_matches_upstream_pin(){let s=project_plugins(&serde_json::json!({"plugins":[{"spec":"@magpie-community/x@latest"},{"spec":"@magpie-community/y@1.0.0"},{"spec":"untrusted@latest"}]}));assert_eq!(s["plugins"][0]["autoUpdate"],true);assert_eq!(s["plugins"][1]["autoUpdate"],false);assert_eq!(s["plugins"][2]["autoUpdate"],false);}}

fn account_reference_exists(state:&serde_json::Value,id:&str,reference:&str)->bool{!reference.is_empty()&&state.get("providers").and_then(|x|x.as_array()).into_iter().flatten().filter(|p|p.get("id").and_then(|x|x.as_str())==Some(id)).flat_map(|p|p.get("keyList").and_then(|x|x.as_array()).into_iter().flatten()).any(|k|k.get("id").and_then(|x|x.as_str())==Some(reference))}
#[cfg(test)]mod account_reference_tests{use super::*;#[test]fn only_matching_provider_and_account(){let x=serde_json::json!({"providers":[{"id":"a","keyList":[{"id":"opaque1","name":"local account"}]}]});assert!(account_reference_exists(&x,"a","opaque1"));assert!(!account_reference_exists(&x,"b","opaque1"));assert!(!account_reference_exists(&x,"a",""));assert!(!account_reference_exists(&x,"a","other"));}}
