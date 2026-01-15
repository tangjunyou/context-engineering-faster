#[cfg(feature = "milvus")]
#[derive(Clone)]
pub struct MilvusRestClient {
    base_url: String,
    token: Option<String>,
}

#[cfg(feature = "milvus")]
impl MilvusRestClient {
    pub fn new(base_url: String, token: Option<String>) -> Self {
        Self { base_url, token }
    }

    pub async fn list_collections(&self) -> anyhow::Result<serde_json::Value> {
        let client = reqwest::Client::new();
        let url = format!(
            "{}/v2/vectordb/collections/list",
            self.base_url.trim_end_matches('/')
        );
        let mut req = client.post(url).json(&serde_json::json!({}));
        if let Some(token) = &self.token {
            req = req.bearer_auth(token);
        }
        let res = req.send().await?;
        let status = res.status();
        let text = res.text().await?;
        if !status.is_success() {
            return Err(anyhow::anyhow!("milvus http {}: {}", status, text));
        }
        Ok(serde_json::from_str(&text)?)
    }
}

#[cfg(not(feature = "milvus"))]
#[derive(Clone)]
pub struct MilvusRestClient;

#[cfg(not(feature = "milvus"))]
impl MilvusRestClient {
    pub fn new(_base_url: String, _token: Option<String>) -> Self {
        Self
    }

    pub async fn list_collections(&self) -> anyhow::Result<serde_json::Value> {
        Err(anyhow::anyhow!("milvus feature 未启用"))
    }
}
