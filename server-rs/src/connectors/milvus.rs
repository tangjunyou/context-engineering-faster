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

    async fn post_json(
        &self,
        path: &str,
        body: serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        let client = reqwest::Client::new();
        let url = format!(
            "{}/{}",
            self.base_url.trim_end_matches('/'),
            path.trim_start_matches('/')
        );
        let mut req = client.post(url).json(&body);
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

    pub async fn list_collections(&self) -> anyhow::Result<serde_json::Value> {
        self.post_json("/v2/vectordb/collections/list", serde_json::json!({}))
            .await
    }

    pub async fn insert_entities(
        &self,
        body: serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        self.post_json("/v2/vectordb/entities/insert", body).await
    }

    pub async fn search_entities(
        &self,
        body: serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        self.post_json("/v2/vectordb/entities/search", body).await
    }

    pub async fn query_entities(
        &self,
        body: serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        self.post_json("/v2/vectordb/entities/query", body).await
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

    pub async fn insert_entities(
        &self,
        _body: serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        Err(anyhow::anyhow!("milvus feature 未启用"))
    }

    pub async fn search_entities(
        &self,
        _body: serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        Err(anyhow::anyhow!("milvus feature 未启用"))
    }

    pub async fn query_entities(
        &self,
        _body: serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        Err(anyhow::anyhow!("milvus feature 未启用"))
    }
}
