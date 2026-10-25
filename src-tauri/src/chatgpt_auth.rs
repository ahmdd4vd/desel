//! Own-client local/OSS Sign in with ChatGPT contracts. No login command exposed yet.
//! Secrets remain Rust-side and must never enter AppSettings/browser storage.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
pub const RESOURCE: &str = "https://api.openai.com/v1";
const AUTHORIZE: &str = "https://auth.openai.com/api/accounts/authorize";
const TOKEN: &str = "https://auth.openai.com/api/accounts/oauth/token";
pub struct PendingLogin {
    pub state: String,
    pub nonce: String,
    pub verifier: String,
    pub redirect: String,
    pub selected_client: Option<String>,
    id_token_hint: Option<String>,
    login_hint: Option<String>,
}
pub struct Callback {
    pub code: String,
    pub client_id: String,
}
impl PendingLogin {
    pub fn new(port: u16, selected_client: Option<String>) -> Self {
        let random = || {
            format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            )
        };
        Self {
            state: random(),
            nonce: random(),
            verifier: random(),
            redirect: format!("http://127.0.0.1:{port}/auth/callback"),
            selected_client,
            id_token_hint: None,
            login_hint: None,
        }
    }
    pub fn returning(port: u16, record: &CredentialRecord) -> Self {
        let mut p = Self::new(port, Some(record.client_id.clone()));
        p.id_token_hint = Some(record.id_token.clone());
        p.login_hint = record.email.clone();
        p
    }
    pub fn authorization_url(&self, host_id: &str) -> Result<String, String> {
        if !host_id.starts_with("urn:uuid:")
            || uuid::Uuid::parse_str(host_id.trim_start_matches("urn:uuid:")).is_err()
        {
            return Err("Invalid stable host id".into());
        }
        let mut url = reqwest::Url::parse(AUTHORIZE).unwrap();
        {
            let mut q = url.query_pairs_mut();
            q.append_pair(
                "client_id",
                self.selected_client
                    .as_deref()
                    .unwrap_or("dynamic_agent_client"),
            );
            if self.selected_client.is_none() {
                q.append_pair("agent_name_hint", "Desel");
            }
            if let Some(id) = &self.id_token_hint {
                q.append_pair("id_token_hint", id);
            }
            if let Some(email) = &self.login_hint {
                q.append_pair("login_hint", email);
            }
            q.append_pair("ext_agent_host_id", host_id)
                .append_pair("response_type", "code")
                .append_pair("redirect_uri", &self.redirect)
                .append_pair(
                    "scope",
                    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
                )
                .append_pair("resource", RESOURCE)
                .append_pair("state", &self.state)
                .append_pair("nonce", &self.nonce)
                .append_pair("code_challenge_method", "S256")
                .append_pair(
                    "code_challenge",
                    &URL_SAFE_NO_PAD.encode(Sha256::digest(self.verifier.as_bytes())),
                );
        }
        Ok(url.to_string())
    }
    /// Must be called only by the owned loopback listener. Consumes attempt.
    pub fn callback(self, url: &str) -> Result<(Self, Callback), String> {
        let u = reqwest::Url::parse(url).map_err(|_| "Invalid callback URL")?;
        let expected = reqwest::Url::parse(&self.redirect).unwrap();
        if u.scheme() != expected.scheme()
            || u.host_str() != expected.host_str()
            || u.port() != expected.port()
            || u.path() != expected.path()
            || u.fragment().is_some()
        {
            return Err("Callback origin/path mismatch".into());
        }
        let mut fields = HashMap::new();
        for (k, v) in u.query_pairs() {
            if fields.insert(k.into_owned(), v.into_owned()).is_some() {
                return Err("Duplicate callback parameter".into());
            }
        }
        if fields.get("state") != Some(&self.state) {
            return Err("Callback state mismatch".into());
        }
        if fields.contains_key("error") {
            return Err("Authorization declined or failed".into());
        }
        let client = match (&self.selected_client, fields.get("client_id")) {
            (Some(saved), Some(got)) if saved != got => {
                return Err("Callback client mismatch".into())
            }
            (Some(saved), _) => saved.clone(),
            (None, Some(got)) if got != "dynamic_agent_client" && !got.is_empty() => got.clone(),
            _ => return Err("Missing issued client id".into()),
        };
        let code = fields
            .remove("code")
            .filter(|x| !x.is_empty())
            .ok_or("Missing authorization code")?;
        Ok((
            self,
            Callback {
                code,
                client_id: client,
            },
        ))
    }
    pub fn token_form(&self, callback: &Callback) -> HashMap<&'static str, String> {
        HashMap::from([
            ("grant_type", "authorization_code".into()),
            ("client_id", callback.client_id.clone()),
            ("code", callback.code.clone()),
            ("code_verifier", self.verifier.clone()),
            ("redirect_uri", self.redirect.clone()),
            ("resource", RESOURCE.into()),
        ])
    }
}
pub fn token_endpoint() -> &'static str {
    TOKEN
}
pub fn has_plan_scope(scope: &str) -> bool {
    scope
        .split_whitespace()
        .any(|s| s == "chatgpt.tokens.use.direct")
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn initial_url_own_registration_and_pkce() {
        let p = PendingLogin::new(12345, None);
        let host = format!("urn:uuid:{}", uuid::Uuid::new_v4());
        let url = p.authorization_url(&host).unwrap();
        assert!(url.contains("dynamic_agent_client"));
        assert!(url.contains("agent_name_hint=Desel"));
        assert!(!url.contains(&p.verifier));
        assert!(url.contains("code_challenge_method=S256"));
    }
    #[test]
    fn returning_uses_issued_identity() {
        let p = PendingLogin::new(12345, Some("issued-client".into()));
        let url = p
            .authorization_url(&format!("urn:uuid:{}", uuid::Uuid::new_v4()))
            .unwrap();
        assert!(!url.contains("agent_name_hint"));
        assert!(url.contains("issued-client"));
    }
    #[test]
    fn callback_bound_and_exchange_issued_client() {
        let p = PendingLogin::new(12345, None);
        let url = format!(
            "{}?state={}&code=fixture-code&client_id=issued",
            p.redirect, p.state
        );
        let (p, c) = p.callback(&url).unwrap();
        assert_eq!(p.token_form(&c)["client_id"], "issued");
        assert_eq!(
            p.token_form(&c)["redirect_uri"],
            "http://127.0.0.1:12345/auth/callback"
        );
    }
    #[test]
    fn rejects_duplicate_wrong_state_and_client() {
        let p = PendingLogin::new(12345, None);
        let url = format!(
            "{}?state={}&state={}&code=x&client_id=y",
            p.redirect, p.state, p.state
        );
        assert!(p.callback(&url).is_err());
        let p = PendingLogin::new(12345, Some("issued".into()));
        let url = format!("{}?state={}&code=x&client_id=other", p.redirect, p.state);
        assert!(p.callback(&url).is_err());
    }
    #[test]
    fn identity_scope_not_plan_permission() {
        assert!(!has_plan_scope("openid profile email"));
        assert!(has_plan_scope("openid chatgpt.tokens.use.direct"));
    }
}

#[derive(serde::Deserialize)]
pub struct IdClaims {
    pub sub: String,
    pub iss: String,
    pub aud: serde_json::Value,
    pub exp: u64,
    pub nonce: Option<String>,
    pub azp: Option<String>,
    pub email: Option<String>,
}
/// Never decode claims as identity without verifying signature and audience.
pub fn validate_id_token(
    token: &str,
    jwks: &jsonwebtoken::jwk::JwkSet,
    client_id: &str,
    nonce: &str,
    selected_sub: Option<&str>,
) -> Result<IdClaims, String> {
    validate_identity(token, jwks, client_id, Some(nonce), selected_sub)
}
fn validate_identity(
    token: &str,
    jwks: &jsonwebtoken::jwk::JwkSet,
    client_id: &str,
    nonce: Option<&str>,
    selected_sub: Option<&str>,
) -> Result<IdClaims, String> {
    use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
    let header = decode_header(token).map_err(|_| "Invalid ID token header")?;
    if header.alg != Algorithm::RS256 {
        return Err("Unsupported ID token algorithm".into());
    }
    let kid = header.kid.ok_or("ID token has no signing key id")?;
    let jwk = jwks.find(&kid).ok_or("Unknown ID token signing key")?;
    use jsonwebtoken::jwk::{KeyAlgorithm, KeyOperations, PublicKeyUse};
    if jwk
        .common
        .key_algorithm
        .map(|a| a != KeyAlgorithm::RS256)
        .unwrap_or(false)
        || jwk
            .common
            .public_key_use
            .as_ref()
            .map(|u| u != &PublicKeyUse::Signature)
            .unwrap_or(false)
        || jwk
            .common
            .key_operations
            .as_ref()
            .map(|ops| !ops.contains(&KeyOperations::Verify))
            .unwrap_or(false)
    {
        return Err("Identity signing key usage mismatch".into());
    }
    let key = DecodingKey::from_jwk(jwk).map_err(|_| "Invalid identity signing key")?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[client_id]);
    validation.set_issuer(&["https://auth.openai.com"]);
    validation.leeway = 30;
    let claims = decode::<IdClaims>(token, &key, &validation)
        .map_err(|_| "ID token signature or claims rejected")?
        .claims;
    if claims.aud.as_array().map(|a| a.len() > 1).unwrap_or(false)
        && claims.azp.as_deref() != Some(client_id)
    {
        return Err("ID token authorized party mismatch".into());
    }
    if nonce
        .map(|n| claims.nonce.as_deref() != Some(n))
        .unwrap_or(false)
        || claims.sub.is_empty()
        || selected_sub.map(|s| s != claims.sub).unwrap_or(false)
    {
        return Err("ID token nonce or selected account mismatch".into());
    }
    Ok(claims)
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct CredentialRecord {
    pub client_id: String,
    pub subject: String,
    pub email: Option<String>,
    pub access_token: String,
    pub refresh_token: String,
    pub id_token: String,
    pub scope: String,
    pub expires_at: u64,
}
impl CredentialRecord {
    pub fn validate_grant(&self) -> Result<(), String> {
        if self.client_id.is_empty()
            || self.client_id == "dynamic_agent_client"
            || self.subject.is_empty()
            || self.access_token.is_empty()
            || self.refresh_token.is_empty()
        {
            return Err("Incomplete credential record".into());
        }
        Ok(())
    }
}
/// Official OSS contract permits protected local files. No browser/localStorage.
/// Windows encrypts records with current-user DPAPI before atomic replacement.
pub fn save_credentials(path: &std::path::Path, record: &CredentialRecord) -> Result<(), String> {
    record.validate_grant()?;
    #[cfg(windows)]
    {
        return crate::credential_storage::atomic_write(
            path,
            &serde_json::to_vec(record).map_err(|_| "Cannot encode credentials")?,
        );
    }
    #[cfg(not(any(unix, windows)))]
    {
        return Err("Protected credential storage unavailable".into());
    }
    #[cfg(unix)]
    {
        use std::{
            io::Write,
            os::unix::fs::{OpenOptionsExt, PermissionsExt},
        };
        let parent = path.parent().ok_or("Invalid credential destination")?;
        std::fs::create_dir_all(parent)
            .map_err(|_| "Cannot create private credential directory")?;
        if std::fs::symlink_metadata(parent)
            .map_err(|_| "Cannot inspect private credential directory")?
            .file_type()
            .is_symlink()
        {
            return Err("Credential directory cannot be a symlink".into());
        }
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "Cannot protect credential directory")?;
        let tmp = parent.join(format!(".auth-{}.tmp", uuid::Uuid::new_v4()));
        let bytes = serde_json::to_vec(record).map_err(|_| "Cannot encode credentials")?;
        let result = (|| {
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&tmp)
                .map_err(|_| "Cannot create protected credential file")?;
            f.write_all(&bytes)
                .map_err(|_| "Cannot write credential file")?;
            f.sync_all().map_err(|_| "Cannot sync credential file")?;
            std::fs::rename(&tmp, path).map_err(|_| "Cannot replace credential file")?;
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(tmp);
        }
        result
    }
}
pub fn refresh_form(record: &CredentialRecord) -> HashMap<&'static str, String> {
    HashMap::from([
        ("grant_type", "refresh_token".into()),
        ("client_id", record.client_id.clone()),
        ("refresh_token", record.refresh_token.clone()),
        ("resource", RESOURCE.into()),
    ])
}
#[cfg(test)]
mod secret_tests {
    use super::*;
    #[test]
    fn unsigned_or_wrong_alg_identity_rejected() {
        let keys = jsonwebtoken::jwk::JwkSet { keys: vec![] };
        assert!(validate_id_token("bad.token.data", &keys, "client", "nonce", None).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn credential_file_owner_only_and_refresh_bound() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("desel-auth-{}", uuid::Uuid::new_v4()));
        let path = root.join("credentials.json");
        let r = CredentialRecord {
            client_id: "issued".into(),
            subject: "validated-sub-fixture".into(),
            email: None,
            access_token: "local-fake-access".into(),
            refresh_token: "local-fake-refresh".into(),
            id_token: "local-fake-id".into(),
            scope: "chatgpt.tokens.use.direct".into(),
            expires_at: 42,
        };
        save_credentials(&path, &r).unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(refresh_form(&r)["client_id"], "issued");
        assert!(!refresh_form(&r).contains_key("scope"));
        let _ = std::fs::remove_dir_all(root);
    }
}

#[cfg(test)]
mod signed_identity_tests {
    use super::*;
    use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
    use serde_json::json;
    fn token(mut changes: serde_json::Value) -> String {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let mut claims = json!({"sub":"local-test-sub","iss":"https://auth.openai.com","aud":"issued-local-test","exp":now+300,"nonce":"fresh-local-nonce"});
        for (k, v) in changes.as_object_mut().unwrap().iter() {
            claims[k] = v.clone();
        }
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some("desel-local-test-key".into());
        encode(
            &header,
            &claims,
            &EncodingKey::from_rsa_pem(include_bytes!("../tests/fixtures/auth-test-only.pem"))
                .unwrap(),
        )
        .unwrap()
    }
    fn check(t: &str, nonce: &str, sub: Option<&str>) -> Result<IdClaims, String> {
        let jwks = serde_json::from_str(include_str!("../tests/fixtures/auth-test-only-jwks.json"))
            .unwrap();
        validate_id_token(t, &jwks, "issued-local-test", nonce, sub)
    }
    #[test]
    fn signed_identity_passes_and_mismatch_matrix_rejected() {
        let t = token(json!({}));
        assert_eq!(
            check(&t, "fresh-local-nonce", Some("local-test-sub"))
                .unwrap()
                .sub,
            "local-test-sub"
        );
        assert!(check(&t, "replayed-nonce", None).is_err());
        assert!(check(&t, "fresh-local-nonce", Some("other-account")).is_err());
        for change in [
            json!({"iss":"https://untrusted.invalid"}),
            json!({"aud":"different-client"}),
            json!({"exp":1}),
            json!({"sub":""}),
            json!({"aud":["issued-local-test","other-client"]}),
            json!({"aud":["issued-local-test","other-client"],"azp":"other-client"}),
        ] {
            assert!(check(&token(change), "fresh-local-nonce", None).is_err());
        }
        assert!(check(
            &token(json!({"aud":["issued-local-test","other-client"],"azp":"issued-local-test"})),
            "fresh-local-nonce",
            None
        )
        .is_ok());
    }
    #[test]
    fn valid_structure_with_modified_signature_rejected() {
        let mut t = token(json!({})).into_bytes();
        let last = t.len() - 10;
        t[last] = if t[last] == b'A' { b'B' } else { b'A' };
        assert!(check(std::str::from_utf8(&t).unwrap(), "fresh-local-nonce", None).is_err());
    }
}

/// Owned loopback only. The active account is not changed by starting an attempt.
pub struct LoginListener {
    listener: tokio::net::TcpListener,
    pub pending: PendingLogin,
}
impl LoginListener {
    pub async fn bind(selected_client: Option<String>) -> Result<Self, String> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| "Cannot bind sign-in callback")?;
        let port = listener
            .local_addr()
            .map_err(|_| "Cannot read callback port")?
            .port();
        Ok(Self {
            listener,
            pending: PendingLogin::new(port, selected_client),
        })
    }
    pub async fn receive(
        self,
        cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
        timeout: std::time::Duration,
    ) -> Result<(PendingLogin, Callback), String> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let deadline = tokio::time::Instant::now() + timeout;
        let (mut socket, peer) = loop {
            if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                return Err("Sign-in cancelled".into());
            }
            if tokio::time::Instant::now() >= deadline {
                return Err("Sign-in callback timed out".into());
            }
            tokio::select! {r=self.listener.accept()=>{break r.map_err(|_|"Cannot accept sign-in callback")?},_=tokio::time::sleep(std::time::Duration::from_millis(100))=>{}}
        };
        if !peer.ip().is_loopback() {
            return Err("Non-loopback callback rejected".into());
        }
        let mut bytes = Vec::new();
        let read = async {
            loop {
                let mut buf = [0; 1024];
                let n = socket
                    .read(&mut buf)
                    .await
                    .map_err(|_| "Cannot read sign-in callback")?;
                if n == 0 {
                    return Err("Incomplete sign-in callback");
                }
                bytes.extend_from_slice(&buf[..n]);
                if bytes.len() > 16 * 1024 {
                    return Err("Sign-in callback too large");
                }
                if bytes.windows(4).any(|x| x == b"\r\n\r\n") {
                    return Ok(());
                }
            }
        };
        let read = tokio::time::timeout_at(
            deadline.min(tokio::time::Instant::now() + std::time::Duration::from_secs(5)),
            read,
        );
        tokio::pin!(read);
        loop {
            tokio::select! {r=&mut read=>{r.map_err(|_|"Sign-in callback read timed out")??;break},_=tokio::time::sleep(std::time::Duration::from_millis(25))=>if cancel.load(std::sync::atomic::Ordering::Relaxed){return Err("Sign-in cancelled".into())}}
        }
        let request =
            std::str::from_utf8(&bytes).map_err(|_| "Invalid sign-in callback encoding")?;
        let line = request.lines().next().ok_or("Missing callback request")?;
        let parts: Vec<_> = line.split_whitespace().collect();
        if parts.len() != 3
            || parts[0] != "GET"
            || !parts[1].starts_with("/auth/callback?")
            || !parts[2].starts_with("HTTP/1.")
        {
            return Err("Invalid sign-in callback request".into());
        }
        let port = self
            .listener
            .local_addr()
            .map_err(|_| "Callback listener closed")?
            .port();
        let expected_host = format!("127.0.0.1:{port}");
        let hosts: Vec<_> = request
            .lines()
            .skip(1)
            .filter_map(|s| s.split_once(':'))
            .filter(|(k, _)| k.eq_ignore_ascii_case("host"))
            .collect();
        if hosts.len() != 1 || hosts[0].1.trim() != expected_host {
            return Err("Callback Host mismatch".into());
        }
        let url = format!("http://{expected_host}{}", parts[1]);
        let result = self.pending.callback(&url);
        let body = if result.is_ok() {
            "Sign-in received. You can return to Desel."
        } else {
            "Sign-in could not be verified. Return to Desel and try again."
        };
        let response=format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",body.len());
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            socket.write_all(response.as_bytes()),
        )
        .await;
        result
    }
}
#[cfg(test)]
mod listener_tests {
    use super::*;
    #[tokio::test]
    async fn callback_listener_completes_and_closes() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let login = LoginListener::bind(None).await.unwrap();
        let redirect = reqwest::Url::parse(&login.pending.redirect).unwrap();
        let port = redirect.port().unwrap();
        let state = login.pending.state.clone();
        let task = tokio::spawn(login.receive(
            std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            std::time::Duration::from_secs(2),
        ));
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        stream.write_all(format!("GET /auth/callback?state={state}&code=local-test-code&client_id=local-issued HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").as_bytes()).await.unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        assert!(response.contains("Sign-in received"));
        assert!(!response.contains("local-test-code"));
        assert_eq!(task.await.unwrap().unwrap().1.client_id, "local-issued");
        assert!(tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_err());
    }
    #[tokio::test]
    async fn cancellation_and_timeout_release_listener() {
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        assert!(LoginListener::bind(None)
            .await
            .unwrap()
            .receive(cancel, std::time::Duration::from_secs(1))
            .await
            .is_err());
        assert!(LoginListener::bind(None)
            .await
            .unwrap()
            .receive(
                std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                std::time::Duration::from_millis(1)
            )
            .await
            .is_err());
    }
}

#[derive(serde::Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub id_token: Option<String>,
    pub token_type: String,
    pub expires_in: u64,
    pub scope: Option<String>,
}
impl TokenResponse {
    pub fn initial(
        self,
        client_id: String,
        jwks: &jsonwebtoken::jwk::JwkSet,
        nonce: &str,
        selected_sub: Option<&str>,
        now: u64,
    ) -> Result<CredentialRecord, String> {
        if !self.token_type.eq_ignore_ascii_case("Bearer") || self.expires_in == 0 {
            return Err("Invalid token response type or lifetime".into());
        }
        let id = self.id_token.ok_or("Missing identity token")?;
        let claims = validate_id_token(&id, jwks, &client_id, nonce, selected_sub)?;
        let record = CredentialRecord {
            client_id,
            subject: claims.sub,
            email: claims.email,
            access_token: self.access_token,
            refresh_token: self.refresh_token.ok_or("Missing renewable session")?,
            id_token: id,
            scope: self.scope.ok_or("Missing granted scope")?,
            expires_at: now
                .checked_add(self.expires_in)
                .ok_or("Invalid token lifetime")?,
        };
        record.validate_grant()?;
        Ok(record)
    }
    /// Identity-only login is valid but cannot be used for inference. The caller
    /// must gate inference separately on has_plan_scope, not discard the account.
    pub fn refreshed(self, old: &CredentialRecord, now: u64) -> Result<CredentialRecord, String> {
        if !self.token_type.eq_ignore_ascii_case("Bearer")
            || self.expires_in == 0
            || self.access_token.is_empty()
        {
            return Err("Invalid refresh response".into());
        }
        if self.id_token.is_some() {
            return Err(
                "Refresh identity update requires signed validation before replacement".into(),
            );
        }
        let record = CredentialRecord {
            client_id: old.client_id.clone(),
            subject: old.subject.clone(),
            email: old.email.clone(),
            access_token: self.access_token,
            refresh_token: self
                .refresh_token
                .unwrap_or_else(|| old.refresh_token.clone()),
            id_token: old.id_token.clone(),
            scope: self.scope.unwrap_or_else(|| old.scope.clone()),
            expires_at: now
                .checked_add(self.expires_in)
                .ok_or("Invalid token lifetime")?,
        };
        record.validate_grant()?;
        Ok(record)
    }
}
pub fn revocation_form(record: &CredentialRecord) -> HashMap<&'static str, String> {
    HashMap::from([
        ("token", record.refresh_token.clone()),
        ("token_type_hint", "refresh_token".into()),
        ("client_id", record.client_id.clone()),
    ])
}

#[cfg(test)]
mod token_tests {
    use super::*;
    fn old() -> CredentialRecord {
        CredentialRecord {
            client_id: "issued-test".into(),
            subject: "local-sub".into(),
            email: None,
            access_token: "local-old".into(),
            refresh_token: "local-old-refresh".into(),
            id_token: "local-old-id".into(),
            scope: "openid chatgpt.tokens.use.direct".into(),
            expires_at: 1,
        }
    }
    #[test]
    fn refresh_rotation_is_one_record_and_does_not_change_account() {
        let r = TokenResponse {
            access_token: "local-new".into(),
            refresh_token: Some("local-rotated".into()),
            id_token: None,
            scope: None,
            token_type: "Bearer".into(),
            expires_in: 3600,
        }
        .refreshed(&old(), 100)
        .unwrap();
        assert_eq!(r.client_id, "issued-test");
        assert_eq!(r.subject, "local-sub");
        assert_eq!(r.refresh_token, "local-rotated");
        assert_eq!(r.expires_at, 3700);
        assert_eq!(r.scope, old().scope);
        assert_eq!(revocation_form(&r)["token"], "local-rotated");
    }
    #[test]
    fn identity_only_record_is_storable_but_not_inference_permission() {
        let mut r = old();
        r.scope = "openid profile email".into();
        assert!(r.validate_grant().is_ok());
        assert!(!has_plan_scope(&r.scope));
    }
    #[test]
    fn refresh_rejects_unvalidated_identity_and_overflow() {
        for id in [Some("unvalidated-id".into()), None] {
            let t = TokenResponse {
                access_token: "local-new".into(),
                refresh_token: None,
                id_token: id,
                scope: None,
                token_type: "Bearer".into(),
                expires_in: u64::MAX,
            };
            assert!(t.refreshed(&old(), 100).is_err());
        }
    }
}

/// Cross-process session guard. Hold this lock across reloading the latest
/// credentials, refresh HTTP request and atomic rotating-token replacement.
/// No waiting lock inside async executor: fail busy and let caller retry later.
pub struct SessionLock(std::fs::File);
impl Drop for SessionLock {
    fn drop(&mut self) {
        let _ = fs2::FileExt::unlock(&self.0);
    }
}
pub fn lock_session(path: &std::path::Path) -> Result<SessionLock, String> {
    #[cfg(not(any(unix, windows)))]
    {
        return Err("Session lock unavailable".into());
    }
    #[cfg(any(unix, windows))]
    {
        #[cfg(unix)]
        use std::os::unix::fs::OpenOptionsExt;
        let mut options = std::fs::OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(unix)]
        options.mode(0o600);
        let file = options
            .read(true)
            .write(true)
            .create(true)
            .open(path)
            .map_err(|_| "Cannot open session lock")?;
        fs2::FileExt::try_lock_exclusive(&file)
            .map_err(|_| "Session update already in progress")?;
        Ok(SessionLock(file))
    }
}
#[cfg(test)]
mod lock_tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn rotating_session_is_exclusive_between_independent_handles() {
        let path = std::env::temp_dir().join(format!("desel-lock-{}", uuid::Uuid::new_v4()));
        let one = lock_session(&path).unwrap();
        assert!(lock_session(&path).is_err());
        drop(one);
        assert!(lock_session(&path).is_ok());
        let _ = std::fs::remove_file(path);
    }
}

/// No public Tauri command invokes this service yet. Fixed official origins,
/// no redirect following, bounded bodies and redacted errors preserve tokens.
pub struct AuthService {
    client: reqwest::Client,
}
impl AuthService {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .map_err(|_| "Cannot initialize sign-in transport")?,
        })
    }
    async fn bounded_json<T: serde::de::DeserializeOwned>(
        &self,
        response: reqwest::Response,
    ) -> Result<T, String> {
        use futures_util::StreamExt;
        if !response.status().is_success() {
            return Err(format!(
                "Sign-in service HTTP {}",
                response.status().as_u16()
            ));
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(part) = stream.next().await {
            let part = part.map_err(|_| "Sign-in response interrupted")?;
            if bytes.len() + part.len() > 1024 * 1024 {
                return Err("Sign-in response too large".into());
            }
            bytes.extend_from_slice(&part);
        }
        serde_json::from_slice(&bytes).map_err(|_| "Invalid sign-in service response".into())
    }
    async fn jwks(&self) -> Result<jsonwebtoken::jwk::JwkSet, String> {
        let response = self
            .client
            .get("https://auth.openai.com/.well-known/jwks.json")
            .send()
            .await
            .map_err(|_| "Cannot retrieve identity signing keys")?;
        self.bounded_json(response).await
    }
    pub async fn exchange(
        &self,
        pending: &PendingLogin,
        callback: &Callback,
        selected_sub: Option<&str>,
        now: u64,
    ) -> Result<CredentialRecord, String> {
        let response = self
            .client
            .post(TOKEN)
            .form(&pending.token_form(callback))
            .send()
            .await
            .map_err(|_| "Sign-in token exchange failed")?;
        let token: TokenResponse = self.bounded_json(response).await?;
        let jwks = self.jwks().await?;
        token.initial(
            callback.client_id.clone(),
            &jwks,
            &pending.nonce,
            selected_sub,
            now,
        )
    }
    pub async fn refresh_locked(
        &self,
        path: &std::path::Path,
        now: u64,
    ) -> Result<CredentialRecord, String> {
        let lock_path = path.with_extension("lock");
        let _guard = lock_session(&lock_path)?;
        let old = load_credentials(path)?;
        let response = self
            .client
            .post(TOKEN)
            .form(&refresh_form(&old))
            .send()
            .await
            .map_err(|_| "Session refresh failed; sign in again if needed")?;
        let mut token: TokenResponse = self.bounded_json(response).await?;
        let identity = if let Some(id) = token.id_token.take() {
            let jwks = self.jwks().await?;
            let claims = validate_identity(&id, &jwks, &old.client_id, None, Some(&old.subject))?;
            Some((id, claims.email))
        } else {
            None
        };
        let mut record = token.refreshed(&old, now)?;
        if let Some((id, email)) = identity {
            record.id_token = id;
            record.email = email.or(old.email);
        }
        save_credentials(path, &record)?;
        Ok(record)
    }
    pub async fn revoke(&self, record: &CredentialRecord) -> Result<(), String> {
        let response = self
            .client
            .get("https://auth.openai.com/.well-known/openid-configuration")
            .send()
            .await
            .map_err(|_| "Cannot retrieve revocation endpoint")?;
        let metadata: serde_json::Value = self.bounded_json(response).await?;
        if metadata["issuer"] != "https://auth.openai.com"
            || metadata["revocation_endpoint"]
                != "https://auth.openai.com/api/accounts/oauth/revoke"
        {
            return Err("Unexpected revocation metadata".into());
        }
        let response = self
            .client
            .post("https://auth.openai.com/api/accounts/oauth/revoke")
            .form(&revocation_form(record))
            .send()
            .await
            .map_err(|_| "Remote revocation not confirmed")?;
        if response.status() != reqwest::StatusCode::OK {
            return Err("Remote revocation not confirmed".into());
        }
        Ok(())
    }
}
pub fn load_credentials(path: &std::path::Path) -> Result<CredentialRecord, String> {
    #[cfg(windows)]
    {
        let bytes = crate::credential_storage::read(path)?;
        let r: CredentialRecord =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid encrypted credential record")?;
        r.validate_grant()?;
        return Ok(r);
    }
    #[cfg(not(any(unix, windows)))]
    {
        return Err("Protected credential storage unavailable".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let m = std::fs::symlink_metadata(path).map_err(|_| "Cannot inspect credential file")?;
        if !m.is_file()
            || m.file_type().is_symlink()
            || m.permissions().mode() & 0o077 != 0
            || m.len() > 1024 * 1024
        {
            return Err("Credential file is not private or has invalid size".into());
        }
        let bytes = std::fs::read(path).map_err(|_| "Cannot read private credentials")?;
        let r: CredentialRecord =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid saved credential record")?;
        r.validate_grant()?;
        Ok(r)
    }
}
pub fn registration_id(client_id: &str, subject: &str) -> String {
    format!(
        "{:x}",
        Sha256::digest(
            serde_json::json!([client_id, subject])
                .to_string()
                .as_bytes()
        )
    )
}
#[cfg(test)]
mod storage_tests {
    use super::*;
    #[test]
    fn registration_keeps_same_email_registrations_separate() {
        assert_ne!(registration_id("a", "sub"), registration_id("b", "sub"));
        assert_ne!(
            registration_id("a", "sub"),
            registration_id("a", "different")
        );
    }
    #[cfg(unix)]
    #[test]
    fn world_readable_credentials_rejected() {
        use std::os::unix::fs::PermissionsExt;
        let p = std::env::temp_dir().join(format!("desel-insecure-{}", uuid::Uuid::new_v4()));
        std::fs::write(&p, b"{}").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(load_credentials(&p).is_err());
        let _ = std::fs::remove_file(p);
    }
}

/// Only labels and readiness leave Rust. Credential records never serialize to
/// the frontend. The issued client+verified subject pair is the registration.
#[derive(serde::Serialize)]
pub struct AccountSummary {
    pub id: String,
    pub label: String,
    pub plan_enabled: bool,
    pub expires_at: u64,
}
impl CredentialRecord {
    pub fn summary(&self) -> AccountSummary {
        let id = registration_id(&self.client_id, &self.subject);
        AccountSummary {
            id: id.clone(),
            label: format!(
                "{} · {}",
                self.email.as_deref().unwrap_or("ChatGPT account"),
                &id[..8]
            ),
            plan_enabled: has_plan_scope(&self.scope),
            expires_at: self.expires_at,
        }
    }
}
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Registration {
    pub client_id: String,
    pub subject: String,
    pub email: Option<String>,
}
/// A signed-out record intentionally contains no credentials, but preserves the
/// registration mapping. It is never used as proof of a fresh signed-in session.
impl From<&CredentialRecord> for Registration {
    fn from(r: &CredentialRecord) -> Self {
        Self {
            client_id: r.client_id.clone(),
            subject: r.subject.clone(),
            email: r.email.clone(),
        }
    }
}
#[derive(serde::Serialize)]
pub struct SignoutResult {
    pub local_cleared: bool,
    pub remote_revocation_confirmed: bool,
}
impl AuthService {
    pub async fn sign_out(&self, path: &std::path::Path) -> Result<SignoutResult, String> {
        let _guard = lock_session(&path.with_extension("lock"))?;
        let record = load_credentials(path)?;
        let mut revoked = false;
        for attempt in 0..3 {
            if self.revoke(&record).await.is_ok() {
                revoked = true;
                break;
            }
            if attempt < 2 {
                tokio::time::sleep(std::time::Duration::from_millis(250 * (1 << attempt))).await;
            }
        } // Caller must persist separate non-secret Registration before invoking.
        std::fs::remove_file(path)
            .map_err(|_| "Could not clear local credentials; account remains disabled")?;
        Ok(SignoutResult {
            local_cleared: true,
            remote_revocation_confirmed: revoked,
        })
    }
}
pub fn stable_host_id(directory: &std::path::Path) -> Result<String, String> {
    #[cfg(windows)]
    {
        std::fs::create_dir_all(directory).map_err(|_| "Cannot create host storage")?;
        let _guard = lock_session(&directory.join("host.lock"))?;
        let path = directory.join("host-id.dpapi");
        if path.exists() {
            let id = String::from_utf8(crate::credential_storage::read(&path)?)
                .map_err(|_| "Invalid host id")?;
            if !id.starts_with("urn:uuid:")
                || uuid::Uuid::parse_str(id.trim_start_matches("urn:uuid:")).is_err()
            {
                return Err("Invalid saved host id".into());
            }
            return Ok(id);
        }
        let id = format!("urn:uuid:{}", uuid::Uuid::new_v4());
        crate::credential_storage::atomic_write(&path, id.as_bytes())?;
        return Ok(id);
    }
    #[cfg(not(any(unix, windows)))]
    {
        return Err("Host storage unavailable".into());
    }
    #[cfg(unix)]
    {
        use std::{
            io::Write,
            os::unix::fs::{OpenOptionsExt, PermissionsExt},
        };
        std::fs::create_dir_all(directory).map_err(|_| "Cannot create host storage")?;
        if std::fs::symlink_metadata(directory)
            .map_err(|_| "Cannot inspect host storage")?
            .file_type()
            .is_symlink()
        {
            return Err("Host storage cannot be a symlink".into());
        }
        std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "Cannot protect host storage")?;
        let _guard = lock_session(&directory.join("host.lock"))?;
        let path = directory.join("host-id");
        if path.exists() {
            let id = std::fs::read_to_string(&path).map_err(|_| "Cannot read host id")?;
            if !id.starts_with("urn:uuid:")
                || uuid::Uuid::parse_str(id.trim_start_matches("urn:uuid:")).is_err()
            {
                return Err("Invalid saved host id".into());
            }
            return Ok(id);
        }
        let id = format!("urn:uuid:{}", uuid::Uuid::new_v4());
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .map_err(|_| "Cannot persist host id")?;
        file.write_all(id.as_bytes())
            .map_err(|_| "Cannot persist host id")?;
        file.sync_all().map_err(|_| "Cannot sync host id")?;
        Ok(id)
    }
}
#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn host_identity_survives_restart_and_accounts_never_expose_tokens() {
        let root = std::env::temp_dir().join(format!("desel-host-{}", uuid::Uuid::new_v4()));
        let one = stable_host_id(&root).unwrap();
        assert_eq!(one, stable_host_id(&root).unwrap());
        let r = CredentialRecord {
            client_id: "issued-local".into(),
            subject: "local-sub".into(),
            email: Some("fixture@example.invalid".into()),
            access_token: "never-expose-access".into(),
            refresh_token: "never-expose-refresh".into(),
            id_token: "never-expose-id".into(),
            scope: "openid".into(),
            expires_at: 42,
        };
        let summary = serde_json::to_string(&r.summary()).unwrap();
        assert!(!summary.contains("never-expose"));
        assert!(!r.summary().plan_enabled);
        let mapping = serde_json::to_string(&Registration::from(&r)).unwrap();
        assert!(!mapping.contains("never-expose"));
        let _ = std::fs::remove_dir_all(root);
    }
    #[tokio::test]
    async fn cancel_after_accept_closes_slow_callback() {
        let login = LoginListener::bind(None).await.unwrap();
        let port = reqwest::Url::parse(&login.pending.redirect)
            .unwrap()
            .port()
            .unwrap();
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let task = tokio::spawn(login.receive(cancel.clone(), std::time::Duration::from_secs(10)));
        let _socket = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(200), task)
                .await
                .unwrap()
                .unwrap()
                .err()
                .unwrap()
                .contains("cancelled")
        );
    }
}

pub struct AccountStore {
    root: std::path::PathBuf,
}
impl AccountStore {
    pub fn new(root: std::path::PathBuf) -> Self {
        Self { root }
    }
    pub fn host_id(&self) -> Result<String, String> {
        stable_host_id(&self.root)
    }
    fn path(&self, id: &str) -> Result<std::path::PathBuf, String> {
        if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Invalid account registration id".into());
        }
        Ok(self.root.join(format!("{id}.credentials")))
    }
    /// Called only after code exchange and signed identity checks succeed. Does
    /// not change the active connection or enable inference as a side effect.
    pub fn save_validated(&self, record: &CredentialRecord) -> Result<AccountSummary, String> {
        self.host_id()?;
        let id = registration_id(&record.client_id, &record.subject);
        let path = self.path(&id)?;
        let _guard = lock_session(&path.with_extension("lock"))?;
        save_credentials(&path, record)?;
        Ok(record.summary())
    }
    pub fn summaries(&self) -> Result<Vec<AccountSummary>, String> {
        if !self.root.exists() {
            return Ok(vec![]);
        }
        let mut results = Vec::new();
        for entry in std::fs::read_dir(&self.root).map_err(|_| "Cannot read account list")? {
            let entry = entry.map_err(|_| "Cannot read account registration")?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("credentials") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if self.path(id).is_err() {
                continue;
            }
            let r = load_credentials(&path)?;
            if registration_id(&r.client_id, &r.subject) != id {
                return Err("Account registration file identity mismatch".into());
            }
            results.push(r.summary());
        }
        results.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(results)
    }
    pub async fn sign_out(&self, id: &str, service: &AuthService) -> Result<SignoutResult, String> {
        let path = self.path(id)?;
        let record = load_credentials(&path)?;
        let mapping = Registration::from(&record);
        let bytes = serde_json::to_vec(&mapping).map_err(|_| "Cannot encode account mapping")?;
        #[cfg(unix)]
        {
            use std::{io::Write, os::unix::fs::OpenOptionsExt};
            let dest = path.with_extension("registration");
            let tmp = self
                .root
                .join(format!(".registration-{}", uuid::Uuid::new_v4()));
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&tmp)
                .map_err(|_| "Cannot save signed-out registration")?;
            f.write_all(&bytes)
                .and_then(|_| f.sync_all())
                .map_err(|_| "Cannot save signed-out registration")?;
            std::fs::rename(&tmp, dest).map_err(|_| "Cannot save signed-out registration")?;
        }
        #[cfg(windows)]
        {
            crate::credential_storage::atomic_write(&path.with_extension("registration"), &bytes)?;
        }
        #[cfg(not(any(unix, windows)))]
        {
            return Err("Account storage unavailable".into());
        }
        service.sign_out(&path).await
    }
}
#[cfg(test)]
mod account_store_tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn account_list_is_secret_free_and_registration_separated() {
        let root = std::env::temp_dir().join(format!("desel-accounts-{}", uuid::Uuid::new_v4()));
        let store = AccountStore::new(root.clone());
        let mut r = CredentialRecord {
            client_id: "one-issued".into(),
            subject: "same-sub".into(),
            email: Some("same@example.invalid".into()),
            access_token: "local-fake-access".into(),
            refresh_token: "local-fake-refresh".into(),
            id_token: "local-fake-id".into(),
            scope: "openid".into(),
            expires_at: 1,
        };
        store.save_validated(&r).unwrap();
        r.client_id = "another-issued".into();
        store.save_validated(&r).unwrap();
        let list = store.summaries().unwrap();
        assert_eq!(list.len(), 2);
        assert_ne!(list[0].label, list[1].label);
        assert!(!serde_json::to_string(&list).unwrap().contains("local-fake"));
        assert!(store.path("../escape").is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}
