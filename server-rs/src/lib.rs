use std::{
    collections::HashMap,
    convert::Infallible,
    io::Write as _,
    path::{Component, PathBuf},
    sync::Arc,
};

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderValue, Method, Request, StatusCode, Uri},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use bytes::Bytes;
use context_engine::{
    render_with_trace, EngineNode, OutputStyle, TraceMessage, TraceSeverity, Variable,
};
use flate2::{write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};
use tower::service_fn;
use tower_http::{
    compression::CompressionLayer,
    cors::{AllowOrigin, Any, CorsLayer},
    normalize_path::NormalizePathLayer,
    trace::TraceLayer,
};

pub mod connectors;
mod crypto;

#[derive(Clone)]
struct AppState {
    data_dir: Arc<PathBuf>,
}

pub fn build_app(static_dir: PathBuf) -> Router {
    let static_dir = Arc::new(static_dir);
    let index_file = Arc::new(static_dir.join("index.html"));

    let cors = cors_from_env();
    let state = AppState {
        data_dir: Arc::new(data_dir_from_env()),
    };
    build_app_with_state(static_dir, index_file, cors, state)
}

pub fn build_app_with_data_dir(static_dir: PathBuf, data_dir: PathBuf) -> Router {
    let static_dir = Arc::new(static_dir);
    let index_file = Arc::new(static_dir.join("index.html"));

    let cors = cors_from_env();
    let state = AppState {
        data_dir: Arc::new(data_dir),
    };
    build_app_with_state(static_dir, index_file, cors, state)
}

fn build_app_with_state(
    static_dir: Arc<PathBuf>,
    index_file: Arc<PathBuf>,
    cors: CorsLayer,
    state: AppState,
) -> Router {
    let spa_static = service_fn({
        let static_dir = Arc::clone(&static_dir);
        let index_file = Arc::clone(&index_file);
        move |req: Request<Body>| {
            let static_dir = Arc::clone(&static_dir);
            let index_file = Arc::clone(&index_file);
            async move {
                let request_path = req.uri().path().to_string();
                let accept_gzip = client_accepts_gzip(&req);
                let rel = req.uri().path().trim_start_matches('/');
                let mut target = Arc::clone(&index_file);
                let mut is_fallback = true;

                if !rel.is_empty() {
                    let rel_path = PathBuf::from(rel);
                    let is_safe = !rel_path
                        .components()
                        .any(|c| matches!(c, Component::ParentDir));

                    if is_safe {
                        let candidate = static_dir.join(rel_path);
                        if candidate.is_file() {
                            target = Arc::new(candidate);
                            is_fallback = false;
                        }
                    }
                }

                let _ = req;
                let mut response = serve_file_bytes(
                    target.as_ref(),
                    accept_gzip && path_is_gzip_compressible(&request_path),
                )
                .await
                .unwrap_or_else(|_| {
                    let mut res = axum::response::Response::new(Body::from("Not Found"));
                    *res.status_mut() = StatusCode::NOT_FOUND;
                    res
                });

                apply_security_headers(response.headers_mut());
                apply_cache_headers(response.headers_mut(), &request_path, is_fallback);
                apply_wasm_content_type(response.headers_mut(), &request_path);

                Ok::<_, Infallible>(response)
            }
        }
    });

    let api_router = Router::new()
        .route("/healthz", get(healthz))
        .route("/projects", get(list_projects).post(create_project))
        .route("/projects/{id}", get(get_project).put(upsert_project))
        .route(
            "/datasources",
            get(list_datasources).post(create_datasource),
        )
        .route(
            "/datasources/local/sqlite",
            post(create_local_sqlite_datasource),
        )
        .route("/providers", get(list_providers).post(create_provider))
        .route(
            "/providers/{id}",
            get(get_provider)
                .put(update_provider)
                .delete(delete_provider),
        )
        .route("/providers/{id}/embeddings", post(call_provider_embeddings))
        .route(
            "/providers/{id}/chat/completions",
            post(call_provider_chat_completions),
        )
        .route("/datasets", get(list_datasets).post(create_dataset))
        .route("/datasets/{id}", get(get_dataset).delete(delete_dataset))
        .route("/jobs", get(list_jobs))
        .route("/jobs/{id}", get(get_job))
        .route("/jobs/embed-to-vector", post(job_embed_to_vector))
        .route("/operations", get(list_operations))
        .route(
            "/datasources/{id}",
            get(get_datasource)
                .put(update_datasource)
                .delete(delete_datasource),
        )
        .route("/datasources/{id}/test", post(test_datasource))
        .route("/datasources/{id}/tables", get(list_datasource_tables))
        .route(
            "/datasources/{id}/tables/{table}/columns",
            get(list_datasource_table_columns),
        )
        .route("/datasources/{id}/import/csv", post(import_csv))
        .route("/imports", get(list_imports))
        .route("/imports/{id}", get(get_import))
        .route("/sessions", get(list_sessions).post(create_session))
        .route("/sessions/{id}", get(get_session))
        .route("/sessions/{id}/messages", post(append_messages))
        .route("/sessions/{id}/render", post(render_session))
        .route("/preview", post(execute_preview))
        .route("/execute", post(execute))
        .route("/vector/collections", get(list_vector_collections))
        .route("/vector/collections/create", post(create_vector_collection))
        .route("/vector/points/upsert", post(upsert_vector_points))
        .route("/vector/search", post(search_vector))
        .route("/vector/points/delete", post(delete_vector_points))
        .route(
            "/sql/datasources/{id}/tables/{table}/rows",
            get(list_sqlite_table_rows),
        )
        .route(
            "/sql/datasources/{id}/tables/{table}/rows/insert",
            post(insert_sqlite_table_row),
        )
        .route(
            "/sql/datasources/{id}/tables/{table}/rows/delete",
            post(delete_sqlite_table_row),
        )
        .route(
            "/sql/datasources/{id}/tables/create",
            post(create_sqlite_table),
        )
        .route("/sql/query", post(sql_query))
        .fallback(api_not_found)
        .layer(cors);

    Router::new()
        .nest("/api", api_router)
        .fallback_service(spa_static)
        .with_state(state)
        .layer(NormalizePathLayer::trim_trailing_slash())
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
}

fn client_accepts_gzip(req: &Request<Body>) -> bool {
    req.headers()
        .get(header::ACCEPT_ENCODING)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("gzip"))
}

fn path_is_gzip_compressible(request_path: &str) -> bool {
    let p = request_path.to_ascii_lowercase();
    p.ends_with(".html")
        || p.ends_with(".js")
        || p.ends_with(".css")
        || p.ends_with(".json")
        || p.ends_with(".svg")
        || p.ends_with(".txt")
        || p.ends_with(".map")
        || p == "/"
}

async fn serve_file_bytes(
    path: &std::path::Path,
    gzip: bool,
) -> anyhow::Result<axum::response::Response> {
    let bytes = tokio::fs::read(path).await?;

    let (body, encoding) = if gzip {
        let compressed = tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<u8>> {
            let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
            encoder.write_all(&bytes)?;
            Ok(encoder.finish()?)
        })
        .await??;
        (compressed, Some("gzip"))
    } else {
        (bytes, None)
    };

    let mut res = axum::response::Response::new(Body::from(body));
    let headers = res.headers_mut();

    let mime = mime_guess::from_path(path)
        .first_raw()
        .unwrap_or("application/octet-stream");
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_str(mime)?);

    if let Some(encoding) = encoding {
        headers.insert(header::CONTENT_ENCODING, HeaderValue::from_str(encoding)?);
        headers.insert(header::VARY, HeaderValue::from_static("Accept-Encoding"));
    }

    Ok(res)
}

fn cors_from_env() -> CorsLayer {
    let allow = std::env::var("CORS_ALLOW_ORIGIN").ok();

    match allow.as_deref() {
        None => CorsLayer::new(),
        Some("*") => CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([
                Method::GET,
                Method::POST,
                Method::PUT,
                Method::PATCH,
                Method::DELETE,
                Method::OPTIONS,
            ])
            .allow_headers(Any),
        Some(value) => {
            let origins: Vec<HeaderValue> = value
                .split(',')
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .filter_map(|s| HeaderValue::from_str(s).ok())
                .collect();

            if origins.is_empty() {
                CorsLayer::new()
            } else {
                CorsLayer::new()
                    .allow_origin(AllowOrigin::list(origins))
                    .allow_methods([
                        Method::GET,
                        Method::POST,
                        Method::PUT,
                        Method::PATCH,
                        Method::DELETE,
                        Method::OPTIONS,
                    ])
                    .allow_headers(Any)
            }
        }
    }
}

async fn healthz() -> impl IntoResponse {
    (StatusCode::OK, Json(serde_json::json!({ "status": "ok" })))
}

async fn api_not_found(method: Method, uri: Uri) -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({
            "error": "not_found",
            "method": method.to_string(),
            "path": uri.path(),
        })),
    )
}

fn data_dir_from_env() -> PathBuf {
    std::env::var("DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("data"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectNode {
    id: String,
    label: String,
    kind: String,
    content: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectVariable {
    id: String,
    name: String,
    r#type: String,
    value: String,
    description: Option<String>,
    source: Option<String>,
    resolver: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectState {
    nodes: Vec<serde_json::Value>,
    edges: Vec<serde_json::Value>,
    variables: Vec<ProjectVariable>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectDoc {
    id: String,
    name: String,
    state: ProjectState,
    updated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProjectRequest {
    name: String,
    state: ProjectState,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectUpsertRequest {
    name: String,
    state: ProjectState,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSummary {
    id: String,
    name: String,
    updated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataSourceCreateRequest {
    name: String,
    driver: String,
    url: String,
    username: Option<String>,
    password: Option<String>,
    token: Option<String>,
    #[serde(default)]
    allow_import: bool,
    #[serde(default)]
    allow_write: bool,
    #[serde(default)]
    allow_schema: bool,
    #[serde(default)]
    allow_delete: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataSourceUpdateRequest {
    name: Option<String>,
    driver: Option<String>,
    url: Option<String>,
    username: Option<String>,
    password: Option<String>,
    token: Option<String>,
    allow_import: Option<bool>,
    allow_write: Option<bool>,
    allow_schema: Option<bool>,
    allow_delete: Option<bool>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataSourcePublic {
    id: String,
    name: String,
    driver: String,
    url: String,
    #[serde(default)]
    allow_import: bool,
    #[serde(default)]
    allow_write: bool,
    #[serde(default)]
    allow_schema: bool,
    #[serde(default)]
    allow_delete: bool,
    updated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataSourceStored {
    id: String,
    name: String,
    driver: String,
    url_enc: String,
    #[serde(default)]
    allow_import: bool,
    #[serde(default)]
    allow_write: bool,
    #[serde(default)]
    allow_schema: bool,
    #[serde(default)]
    allow_delete: bool,
    updated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteRequest {
    nodes: Vec<ProjectNode>,
    variables: Vec<Variable>,
    output_style: OutputStyle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VariableSpec {
    id: String,
    name: String,
    r#type: String,
    value: String,
    resolver: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecutePreviewRequest {
    nodes: Vec<ProjectNode>,
    variables: Vec<VariableSpec>,
    output_style: OutputStyle,
}

async fn list_datasources(State(state): State<AppState>) -> axum::response::Response {
    let dir = state.data_dir.join("datasources");
    let mut out = Vec::<DataSourcePublic>::new();

    let mut rd = match tokio::fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(_) => {
            return (StatusCode::OK, Json(out)).into_response();
        }
    };

    while let Ok(Some(entry)) = rd.next_entry().await {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Ok(text) = tokio::fs::read_to_string(&path).await {
            if let Ok(ds) = serde_json::from_str::<DataSourceStored>(&text) {
                out.push(DataSourcePublic {
                    id: ds.id,
                    name: ds.name,
                    driver: ds.driver,
                    url: "<redacted>".to_string(),
                    allow_import: ds.allow_import,
                    allow_write: ds.allow_write,
                    allow_schema: ds.allow_schema,
                    allow_delete: ds.allow_delete,
                    updated_at: ds.updated_at,
                });
            }
        }
    }

    (StatusCode::OK, Json(out)).into_response()
}

async fn create_datasource(
    State(state): State<AppState>,
    Json(req): Json<DataSourceCreateRequest>,
) -> axum::response::Response {
    let key = match crypto::load_data_key_from_env() {
        Ok(k) => k,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    serde_json::json!({ "error": "missing_data_key", "message": err.to_string() }),
                ),
            )
                .into_response();
        }
    };

    let id = format!("ds_{}", now_ms());
    let payload = if req.driver == "neo4j" {
        let (Some(username), Some(password)) = (req.username.as_deref(), req.password.as_deref())
        else {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "missing_credentials" })),
            )
                .into_response();
        };
        serde_json::json!({
            "uri": req.url,
            "username": username,
            "password": password,
        })
        .to_string()
    } else if req.driver == "milvus" {
        serde_json::json!({
            "baseUrl": req.url,
            "token": req.token,
        })
        .to_string()
    } else {
        req.url
    };

    let url_enc = match crypto::encrypt_to_base64(&key, payload.as_bytes()) {
        Ok(v) => v,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "encrypt_failed", "message": err.to_string() })),
            )
                .into_response();
        }
    };

    let stored = DataSourceStored {
        id: id.clone(),
        name: req.name,
        driver: req.driver,
        url_enc,
        allow_import: req.allow_import,
        allow_write: req.allow_write,
        allow_schema: req.allow_schema,
        allow_delete: req.allow_delete,
        updated_at: now_ms().to_string(),
    };

    if let Err(err) = write_datasource(&state, &stored).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
        )
            .into_response();
    }

    (
        StatusCode::CREATED,
        Json(DataSourcePublic {
            id: stored.id,
            name: stored.name,
            driver: stored.driver,
            url: "<redacted>".to_string(),
            allow_import: stored.allow_import,
            allow_write: stored.allow_write,
            allow_schema: stored.allow_schema,
            allow_delete: stored.allow_delete,
            updated_at: stored.updated_at,
        }),
    )
        .into_response()
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalSqliteCreateRequest {
    name: String,
}

async fn create_local_sqlite_datasource(
    State(state): State<AppState>,
    Json(req): Json<LocalSqliteCreateRequest>,
) -> axum::response::Response {
    let key = match crypto::load_data_key_from_env() {
        Ok(k) => k,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    serde_json::json!({ "error": "missing_data_key", "message": err.to_string() }),
                ),
            )
                .into_response();
        }
    };

    let id = format!("ds_{}", now_ms());
    let dir = state.data_dir.join("workspaces");
    if let Err(err) = tokio::fs::create_dir_all(&dir).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
        )
            .into_response();
    }
    let db_path = dir.join(format!("{id}.db"));
    if let Err(err) = tokio::fs::write(&db_path, b"").await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
        )
            .into_response();
    }
    let p = db_path.to_string_lossy().replace('\\', "/");
    let url = format!("sqlite:///{p}");

    let url_enc = match crypto::encrypt_to_base64(&key, url.as_bytes()) {
        Ok(v) => v,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "encrypt_failed", "message": err.to_string() })),
            )
                .into_response();
        }
    };

    let stored = DataSourceStored {
        id: id.clone(),
        name: req.name,
        driver: "sqlite".to_string(),
        url_enc,
        allow_import: true,
        allow_write: true,
        allow_schema: true,
        allow_delete: true,
        updated_at: now_ms().to_string(),
    };

    if let Err(err) = write_datasource(&state, &stored).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
        )
            .into_response();
    }

    (
        StatusCode::CREATED,
        Json(DataSourcePublic {
            id: stored.id,
            name: stored.name,
            driver: stored.driver,
            url: "<redacted>".to_string(),
            allow_import: stored.allow_import,
            allow_write: stored.allow_write,
            allow_schema: stored.allow_schema,
            allow_delete: stored.allow_delete,
            updated_at: stored.updated_at,
        }),
    )
        .into_response()
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderPublic {
    id: String,
    name: String,
    provider: String,
    base_url: String,
    default_chat_model: Option<String>,
    default_embedding_model: Option<String>,
    updated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderStored {
    id: String,
    name: String,
    provider: String,
    base_url: String,
    api_key_enc: String,
    default_chat_model: Option<String>,
    default_embedding_model: Option<String>,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderCreateRequest {
    name: String,
    provider: String,
    base_url: String,
    api_key: String,
    default_chat_model: Option<String>,
    default_embedding_model: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderUpdateRequest {
    name: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    default_chat_model: Option<String>,
    default_embedding_model: Option<String>,
}

async fn list_providers(State(state): State<AppState>) -> axum::response::Response {
    let dir = state.data_dir.join("providers");
    let mut out = Vec::<ProviderPublic>::new();
    let mut rd = match tokio::fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(_) => return (StatusCode::OK, Json(out)).into_response(),
    };
    while let Ok(Some(entry)) = rd.next_entry().await {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Ok(text) = tokio::fs::read_to_string(&path).await {
            if let Ok(p) = serde_json::from_str::<ProviderStored>(&text) {
                out.push(ProviderPublic {
                    id: p.id,
                    name: p.name,
                    provider: p.provider,
                    base_url: p.base_url,
                    default_chat_model: p.default_chat_model,
                    default_embedding_model: p.default_embedding_model,
                    updated_at: p.updated_at,
                });
            }
        }
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    (StatusCode::OK, Json(out)).into_response()
}

async fn create_provider(
    State(state): State<AppState>,
    Json(req): Json<ProviderCreateRequest>,
) -> axum::response::Response {
    if req.name.trim().is_empty() || req.api_key.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "validation_failed" })),
        )
            .into_response();
    }
    if req.provider != "siliconflow" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "unsupported_provider" })),
        )
            .into_response();
    }

    let key = match crypto::load_data_key_from_env() {
        Ok(k) => k,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    serde_json::json!({ "error": "missing_data_key", "message": err.to_string() }),
                ),
            )
                .into_response();
        }
    };

    let api_key_enc = match crypto::encrypt_to_base64(&key, req.api_key.as_bytes()) {
        Ok(v) => v,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "encrypt_failed", "message": err.to_string() })),
            )
                .into_response();
        }
    };

    let id = format!("prov_{}", now_ms());
    let stored = ProviderStored {
        id: id.clone(),
        name: req.name,
        provider: req.provider,
        base_url: req.base_url,
        api_key_enc,
        default_chat_model: req.default_chat_model,
        default_embedding_model: req.default_embedding_model,
        updated_at: now_ms().to_string(),
    };
    if let Err(err) = write_provider(&state, &stored).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
        )
            .into_response();
    }
    (
        StatusCode::CREATED,
        Json(ProviderPublic {
            id: stored.id,
            name: stored.name,
            provider: stored.provider,
            base_url: stored.base_url,
            default_chat_model: stored.default_chat_model,
            default_embedding_model: stored.default_embedding_model,
            updated_at: stored.updated_at,
        }),
    )
        .into_response()
}

async fn get_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> axum::response::Response {
    let stored = match load_provider(&state, &id).await {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response()
        }
    };
    (
        StatusCode::OK,
        Json(ProviderPublic {
            id: stored.id,
            name: stored.name,
            provider: stored.provider,
            base_url: stored.base_url,
            default_chat_model: stored.default_chat_model,
            default_embedding_model: stored.default_embedding_model,
            updated_at: stored.updated_at,
        }),
    )
        .into_response()
}

async fn update_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<ProviderUpdateRequest>,
) -> axum::response::Response {
    let mut stored = match load_provider(&state, &id).await {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response()
        }
    };

    if let Some(v) = req.name {
        stored.name = v;
    }
    if let Some(v) = req.base_url {
        stored.base_url = v;
    }
    stored.default_chat_model = req.default_chat_model.or(stored.default_chat_model);
    stored.default_embedding_model = req
        .default_embedding_model
        .or(stored.default_embedding_model);

    if let Some(api_key) = req.api_key {
        let key = match crypto::load_data_key_from_env() {
            Ok(k) => k,
            Err(err) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(
                        serde_json::json!({ "error": "missing_data_key", "message": err.to_string() }),
                    ),
                )
                    .into_response();
            }
        };
        let api_key_enc = match crypto::encrypt_to_base64(&key, api_key.as_bytes()) {
            Ok(v) => v,
            Err(err) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "encrypt_failed", "message": err.to_string() })),
                )
                    .into_response();
            }
        };
        stored.api_key_enc = api_key_enc;
    }

    stored.updated_at = now_ms().to_string();
    if let Err(err) = write_provider(&state, &stored).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
        )
            .into_response();
    }
    (
        StatusCode::OK,
        Json(ProviderPublic {
            id: stored.id,
            name: stored.name,
            provider: stored.provider,
            base_url: stored.base_url,
            default_chat_model: stored.default_chat_model,
            default_embedding_model: stored.default_embedding_model,
            updated_at: stored.updated_at,
        }),
    )
        .into_response()
}

async fn delete_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> axum::response::Response {
    let path = state.data_dir.join("providers").join(format!("{id}.json"));
    match tokio::fs::remove_file(&path).await {
        Ok(_) => (StatusCode::NO_CONTENT, Body::empty()).into_response(),
        Err(_) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "not_found", "id": id })),
        )
            .into_response(),
    }
}

async fn decrypt_provider_api_key(state: &AppState, id: &str) -> anyhow::Result<String> {
    let key = crypto::load_data_key_from_env()?;
    let stored = load_provider(state, id).await?;
    let bytes = crypto::decrypt_from_base64(&key, &stored.api_key_enc)?;
    Ok(String::from_utf8(bytes)?)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderEmbeddingsRequest {
    model: Option<String>,
    input: Vec<String>,
}

async fn call_provider_embeddings(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<ProviderEmbeddingsRequest>,
) -> axum::response::Response {
    let stored = match load_provider(&state, &id).await {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response()
        }
    };
    if stored.provider != "siliconflow" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "unsupported_provider" })),
        )
            .into_response();
    }
    if req.input.is_empty() || req.input.len() > 2048 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "limit_exceeded" })),
        )
            .into_response();
    }
    let api_key =
        match decrypt_provider_api_key(&state, &id).await {
            Ok(k) => k,
            Err(err) => return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "decrypt_failed", "message": err.to_string() })),
            )
                .into_response(),
        };
    let model = req
        .model
        .or(stored.default_embedding_model)
        .unwrap_or_else(|| "BAAI/bge-large-zh-v1.5".to_string());

    let url = format!("{}/embeddings", stored.base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": model,
        "input": req.input,
    });
    let resp =
        match client
            .post(url)
            .bearer_auth(api_key)
            .json(&body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(err) => return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "request_failed", "message": err.to_string() })),
            )
                .into_response(),
        };
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "upstream_failed", "status": status.as_u16(), "body": text })),
        )
            .into_response();
    }
    let v: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "parse_failed" })),
            )
                .into_response();
        }
    };
    let data = v
        .get("data")
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();
    let mut embeddings = Vec::<Vec<f32>>::new();
    for item in data {
        let Some(arr) = item.get("embedding").and_then(|e| e.as_array()) else {
            continue;
        };
        let mut vec = Vec::with_capacity(arr.len());
        for n in arr {
            vec.push(n.as_f64().unwrap_or(0.0) as f32);
        }
        embeddings.push(vec);
    }
    (
        StatusCode::OK,
        Json(serde_json::json!({ "embeddings": embeddings })),
    )
        .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderChatRequest {
    model: Option<String>,
    messages: Vec<SessionMessage>,
    stream: Option<bool>,
}

async fn call_provider_chat_completions(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<ProviderChatRequest>,
) -> axum::response::Response {
    let stored = match load_provider(&state, &id).await {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response()
        }
    };
    if stored.provider != "siliconflow" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "unsupported_provider" })),
        )
            .into_response();
    }
    if req.messages.is_empty() || req.messages.len() > 128 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "validation_failed" })),
        )
            .into_response();
    }
    let api_key =
        match decrypt_provider_api_key(&state, &id).await {
            Ok(k) => k,
            Err(err) => return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "decrypt_failed", "message": err.to_string() })),
            )
                .into_response(),
        };
    let model = req
        .model
        .or(stored.default_chat_model)
        .unwrap_or_else(|| "deepseek-ai/DeepSeek-V3".to_string());

    let url = format!("{}/chat/completions", stored.base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": model,
        "messages": req.messages,
        "stream": req.stream.unwrap_or(false),
    });
    let resp =
        match client
            .post(url)
            .bearer_auth(api_key)
            .json(&body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(err) => return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "request_failed", "message": err.to_string() })),
            )
                .into_response(),
        };
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "upstream_failed", "status": status.as_u16(), "body": text })),
        )
            .into_response();
    }
    let v: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "parse_failed" })),
            )
                .into_response();
        }
    };
    let content = v["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let reasoning = v["choices"][0]["message"]["reasoning_content"]
        .as_str()
        .map(|s| s.to_string());
    (
        StatusCode::OK,
        Json(serde_json::json!({ "content": content, "reasoningContent": reasoning })),
    )
        .into_response()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DatasetRecord {
    id: String,
    name: String,
    rows: Vec<serde_json::Value>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DatasetSummary {
    id: String,
    name: String,
    row_count: u64,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDatasetRequest {
    name: String,
    rows: Vec<serde_json::Value>,
}

async fn create_dataset(
    State(state): State<AppState>,
    Json(req): Json<CreateDatasetRequest>,
) -> axum::response::Response {
    if req.name.trim().is_empty() || req.rows.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "validation_failed" })),
        )
            .into_response();
    }
    if req.rows.len() > 200_000 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "limit_exceeded" })),
        )
            .into_response();
    }
    if req.rows.iter().any(|r| !r.is_object()) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "validation_failed", "message": "rows_must_be_objects" })),
        )
            .into_response();
    }

    let id = format!("dsset_{}", now_ms());
    let record = DatasetRecord {
        id: id.clone(),
        name: req.name,
        rows: req.rows,
        created_at: now_ms().to_string(),
        updated_at: now_ms().to_string(),
    };
    let dir = state.data_dir.join("datasets");
    if let Err(err) = tokio::fs::create_dir_all(&dir).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
        )
            .into_response();
    }
    let path = dir.join(format!("{id}.json"));
    let text = match serde_json::to_string_pretty(&record) {
        Ok(t) => t,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
            )
                .into_response()
        }
    };
    if let Err(err) = tokio::fs::write(path, text).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
        )
            .into_response();
    }
    (StatusCode::CREATED, Json(record)).into_response()
}

async fn list_datasets(State(state): State<AppState>) -> axum::response::Response {
    let dir = state.data_dir.join("datasets");
    let mut out = Vec::<DatasetSummary>::new();
    let mut rd = match tokio::fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(_) => return (StatusCode::OK, Json(out)).into_response(),
    };
    while let Ok(Some(entry)) = rd.next_entry().await {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Ok(text) = tokio::fs::read_to_string(&path).await {
            if let Ok(ds) = serde_json::from_str::<DatasetRecord>(&text) {
                out.push(DatasetSummary {
                    id: ds.id,
                    name: ds.name,
                    row_count: ds.rows.len() as u64,
                    updated_at: ds.updated_at,
                });
            }
        }
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    (StatusCode::OK, Json(out)).into_response()
}

async fn get_dataset(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> axum::response::Response {
    let path = state.data_dir.join("datasets").join(format!("{id}.json"));
    let text = match tokio::fs::read_to_string(&path).await {
        Ok(t) => t,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response()
        }
    };
    match serde_json::from_str::<DatasetRecord>(&text) {
        Ok(ds) => (StatusCode::OK, Json(ds)).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "parse_failed", "id": id })),
        )
            .into_response(),
    }
}

async fn delete_dataset(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> axum::response::Response {
    let path = state.data_dir.join("datasets").join(format!("{id}.json"));
    match tokio::fs::remove_file(&path).await {
        Ok(_) => (StatusCode::NO_CONTENT, Body::empty()).into_response(),
        Err(_) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "not_found", "id": id })),
        )
            .into_response(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobRecord {
    id: String,
    job_type: String,
    status: String,
    created_at: String,
    finished_at: Option<String>,
    summary: Option<String>,
    stats: serde_json::Value,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobSummary {
    id: String,
    job_type: String,
    status: String,
    created_at: String,
    finished_at: Option<String>,
    summary: Option<String>,
}

async fn write_job(state: &AppState, job: &JobRecord) -> anyhow::Result<()> {
    let dir = state.data_dir.join("jobs");
    tokio::fs::create_dir_all(&dir).await?;
    let path = dir.join(format!("{}.json", job.id));
    let text = serde_json::to_string_pretty(job)?;
    tokio::fs::write(path, text).await?;
    Ok(())
}

async fn load_job(state: &AppState, id: &str) -> anyhow::Result<JobRecord> {
    let path = state.data_dir.join("jobs").join(format!("{id}.json"));
    let text = tokio::fs::read_to_string(path).await?;
    Ok(serde_json::from_str(&text)?)
}

async fn list_jobs(State(state): State<AppState>) -> axum::response::Response {
    let dir = state.data_dir.join("jobs");
    let mut out = Vec::<JobSummary>::new();
    let mut rd = match tokio::fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(_) => return (StatusCode::OK, Json(out)).into_response(),
    };
    while let Ok(Some(entry)) = rd.next_entry().await {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Ok(text) = tokio::fs::read_to_string(&path).await {
            if let Ok(j) = serde_json::from_str::<JobRecord>(&text) {
                out.push(JobSummary {
                    id: j.id,
                    job_type: j.job_type,
                    status: j.status,
                    created_at: j.created_at,
                    finished_at: j.finished_at,
                    summary: j.summary,
                });
            }
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    (StatusCode::OK, Json(out)).into_response()
}

async fn get_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> axum::response::Response {
    match load_job(&state, &id).await {
        Ok(job) => (StatusCode::OK, Json(job)).into_response(),
        Err(_) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "not_found", "id": id })),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmbedToVectorJobRequest {
    dataset_id: String,
    provider_id: String,
    collection: String,
    id_field: String,
    text_field: String,
    payload_fields: Option<Vec<String>>,
}

async fn job_embed_to_vector(
    State(state): State<AppState>,
    Json(req): Json<EmbedToVectorJobRequest>,
) -> axum::response::Response {
    if req.dataset_id.trim().is_empty()
        || req.provider_id.trim().is_empty()
        || req.collection.trim().is_empty()
        || req.id_field.trim().is_empty()
        || req.text_field.trim().is_empty()
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "validation_failed" })),
        )
            .into_response();
    }

    let job_id = format!("job_{}", now_ms());
    let mut job = JobRecord {
        id: job_id.clone(),
        job_type: "embed_to_vector".to_string(),
        status: "running".to_string(),
        created_at: now_ms().to_string(),
        finished_at: None,
        summary: None,
        stats: serde_json::json!({}),
        error: None,
    };
    let _ = write_job(&state, &job).await;

    let dataset = match load_dataset_record(&state, &req.dataset_id).await {
        Ok(d) => d,
        Err(err) => {
            job.status = "failed".to_string();
            job.finished_at = Some(now_ms().to_string());
            job.error = Some(err.to_string());
            let _ = write_job(&state, &job).await;
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "dataset_failed", "message": err.to_string(), "jobId": job_id })),
            )
                .into_response();
        }
    };

    let provider = match load_provider(&state, &req.provider_id).await {
        Ok(p) => p,
        Err(_) => {
            job.status = "failed".to_string();
            job.finished_at = Some(now_ms().to_string());
            job.error = Some("provider_not_found".to_string());
            let _ = write_job(&state, &job).await;
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "provider_failed", "message": "not_found", "jobId": job_id })),
            )
                .into_response();
        }
    };
    let api_key = match decrypt_provider_api_key(&state, &req.provider_id).await {
        Ok(k) => k,
        Err(err) => {
            job.status = "failed".to_string();
            job.finished_at = Some(now_ms().to_string());
            job.error = Some(err.to_string());
            let _ = write_job(&state, &job).await;
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "provider_failed", "message": err.to_string(), "jobId": job_id })),
            )
                .into_response();
        }
    };
    let model = provider
        .default_embedding_model
        .clone()
        .unwrap_or_else(|| "BAAI/bge-large-zh-v1.5".to_string());

    let payload_fields = req.payload_fields.clone().unwrap_or_default();
    let mut ids = Vec::<String>::new();
    let mut texts = Vec::<String>::new();
    let mut payloads = Vec::<serde_json::Value>::new();

    for row in &dataset.rows {
        let Some(obj) = row.as_object() else {
            continue;
        };
        let idv = obj
            .get(&req.id_field)
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let tv = obj
            .get(&req.text_field)
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let id = match idv {
            serde_json::Value::String(s) => s,
            serde_json::Value::Number(n) => n.to_string(),
            other => other.to_string(),
        };
        let text = match tv {
            serde_json::Value::String(s) => s,
            other => other.to_string(),
        };
        if id.trim().is_empty() || text.trim().is_empty() {
            continue;
        }
        let mut payload = serde_json::Map::new();
        for k in &payload_fields {
            if let Some(v) = obj.get(k) {
                payload.insert(k.clone(), v.clone());
            }
        }
        payload.insert(
            "_datasetId".to_string(),
            serde_json::Value::String(dataset.id.clone()),
        );
        payload.insert(
            "_jobId".to_string(),
            serde_json::Value::String(job_id.clone()),
        );
        ids.push(id);
        texts.push(text);
        payloads.push(serde_json::Value::Object(payload));
    }

    if ids.is_empty() {
        job.status = "failed".to_string();
        job.finished_at = Some(now_ms().to_string());
        job.error = Some("no_rows".to_string());
        let _ = write_job(&state, &job).await;
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "validation_failed", "message": "no_rows", "jobId": job_id })),
        )
            .into_response();
    }
    if ids.len() > 2000 {
        job.status = "failed".to_string();
        job.finished_at = Some(now_ms().to_string());
        job.error = Some("limit_exceeded".to_string());
        let _ = write_job(&state, &job).await;
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "limit_exceeded", "message": "too_many_rows", "jobId": job_id })),
        )
            .into_response();
    }

    let embeddings = match siliconflow_embeddings(&provider.base_url, &api_key, &model, &texts)
        .await
    {
        Ok(v) => v,
        Err(err) => {
            job.status = "failed".to_string();
            job.finished_at = Some(now_ms().to_string());
            job.error = Some(err.to_string());
            let _ = write_job(&state, &job).await;
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "embedding_failed", "message": err.to_string(), "jobId": job_id })),
            )
                .into_response();
        }
    };

    if embeddings.len() != ids.len() {
        job.status = "failed".to_string();
        job.finished_at = Some(now_ms().to_string());
        job.error = Some("embedding_count_mismatch".to_string());
        let _ = write_job(&state, &job).await;
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "embedding_failed", "message": "count_mismatch", "jobId": job_id })),
        )
            .into_response();
    }

    let points = ids
        .into_iter()
        .zip(embeddings.into_iter())
        .zip(payloads.into_iter())
        .map(|((id, vector), payload)| VectorPoint {
            id,
            vector,
            payload,
            batch_id: Some(job_id.clone()),
        })
        .collect::<Vec<_>>();

    match vector_upsert_points_internal(&state, &req.collection, points).await {
        Ok(inserted) => {
            job.status = "succeeded".to_string();
            job.finished_at = Some(now_ms().to_string());
            job.summary = Some(format!("inserted={inserted}"));
            job.stats = serde_json::json!({ "inserted": inserted, "collection": req.collection });
            let _ = write_job(&state, &job).await;
            (StatusCode::OK, Json(serde_json::json!({ "job": job }))).into_response()
        }
        Err(err) => {
            job.status = "failed".to_string();
            job.finished_at = Some(now_ms().to_string());
            job.error = Some(err.to_string());
            let _ = write_job(&state, &job).await;
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "write_failed", "message": err.to_string(), "jobId": job_id })),
            )
                .into_response()
        }
    }
}

async fn load_dataset_record(state: &AppState, id: &str) -> anyhow::Result<DatasetRecord> {
    let path = state.data_dir.join("datasets").join(format!("{id}.json"));
    let text = tokio::fs::read_to_string(path).await?;
    Ok(serde_json::from_str(&text)?)
}

async fn siliconflow_embeddings(
    base_url: &str,
    api_key: &str,
    model: &str,
    input: &[String],
) -> anyhow::Result<Vec<Vec<f32>>> {
    let url = format!("{}/embeddings", base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": model,
        "input": input,
    });
    let resp = client
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        anyhow::bail!("upstream_failed status={} body={}", status.as_u16(), text);
    }
    let v: serde_json::Value = serde_json::from_str(&text)?;
    let data = v
        .get("data")
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();
    let mut embeddings = Vec::<Vec<f32>>::new();
    for item in data {
        let Some(arr) = item.get("embedding").and_then(|e| e.as_array()) else {
            continue;
        };
        let mut vec = Vec::with_capacity(arr.len());
        for n in arr {
            vec.push(n.as_f64().unwrap_or(0.0) as f32);
        }
        embeddings.push(vec);
    }
    Ok(embeddings)
}

async fn vector_upsert_points_internal(
    state: &AppState,
    collection: &str,
    points: Vec<VectorPoint>,
) -> anyhow::Result<u64> {
    if !is_safe_identifier(collection) {
        anyhow::bail!("invalid_collection");
    }
    let base = vector_base_dir(state);
    let col_path = base.join("collections").join(format!("{collection}.json"));
    let meta_text = tokio::fs::read_to_string(&col_path).await?;
    let meta: VectorCollection = serde_json::from_str(&meta_text)?;
    if points
        .iter()
        .any(|p| p.id.trim().is_empty() || p.vector.len() != meta.dimension as usize)
    {
        anyhow::bail!("dimension_mismatch");
    }
    let points_path = base.join("points").join(format!("{collection}.jsonl"));
    let existing = tokio::fs::read_to_string(&points_path)
        .await
        .unwrap_or_default();
    let mut map = HashMap::<String, VectorPoint>::new();
    for line in existing.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(p) = serde_json::from_str::<VectorPoint>(line) {
            map.insert(p.id.clone(), p);
        }
    }
    for p in points {
        map.insert(p.id.clone(), p);
    }
    let mut out = String::new();
    for p in map.values() {
        out.push_str(&serde_json::to_string(p)?);
        out.push('\n');
    }
    tokio::fs::write(&points_path, out).await?;
    Ok(map.len() as u64)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationDescriptor {
    id: String,
    name: String,
    kind: String,
    input_schema: serde_json::Value,
}

async fn list_operations() -> axum::response::Response {
    let ops = vec![
        OperationDescriptor {
            id: "sql.create_table".to_string(),
            name: "Create SQLite Table".to_string(),
            kind: "sync".to_string(),
            input_schema: serde_json::json!({
                "dataSourceId": "string",
                "table": "string",
                "columns": [{ "name": "string", "dataType": "TEXT|INTEGER|REAL|BLOB|NUMERIC", "nullable": "boolean" }]
            }),
        },
        OperationDescriptor {
            id: "sql.insert_row".to_string(),
            name: "Insert SQLite Row".to_string(),
            kind: "sync".to_string(),
            input_schema: serde_json::json!({
                "dataSourceId": "string",
                "table": "string",
                "row": "object"
            }),
        },
        OperationDescriptor {
            id: "vector.create_collection".to_string(),
            name: "Create Vector Collection".to_string(),
            kind: "sync".to_string(),
            input_schema: serde_json::json!({
                "name": "string",
                "dimension": "number",
                "distance": "cosine"
            }),
        },
        OperationDescriptor {
            id: "vector.search".to_string(),
            name: "Search Vector".to_string(),
            kind: "sync".to_string(),
            input_schema: serde_json::json!({
                "collection": "string",
                "vector": "number[]",
                "topK": "number",
                "filter": "object"
            }),
        },
        OperationDescriptor {
            id: "provider.embeddings".to_string(),
            name: "Embedding (SiliconFlow)".to_string(),
            kind: "sync".to_string(),
            input_schema: serde_json::json!({
                "providerId": "string",
                "model": "string?",
                "input": "string[]"
            }),
        },
        OperationDescriptor {
            id: "job.embed_to_vector".to_string(),
            name: "Embed Dataset To Vector".to_string(),
            kind: "job".to_string(),
            input_schema: serde_json::json!({
                "datasetId": "string",
                "providerId": "string",
                "collection": "string",
                "idField": "string",
                "textField": "string",
                "payloadFields": "string[]?"
            }),
        },
    ];
    (StatusCode::OK, Json(ops)).into_response()
}

async fn get_datasource(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> axum::response::Response {
    let stored = match load_datasource(&state, &id).await {
        Ok(ds) => ds,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response();
        }
    };

    (
        StatusCode::OK,
        Json(DataSourcePublic {
            id: stored.id,
            name: stored.name,
            driver: stored.driver,
            url: "<redacted>".to_string(),
            allow_import: stored.allow_import,
            allow_write: stored.allow_write,
            allow_schema: stored.allow_schema,
            allow_delete: stored.allow_delete,
            updated_at: stored.updated_at,
        }),
    )
        .into_response()
}

async fn update_datasource(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<DataSourceUpdateRequest>,
) -> axum::response::Response {
    let mut stored = match load_datasource(&state, &id).await {
        Ok(ds) => ds,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response();
        }
    };

    let DataSourceUpdateRequest {
        name,
        driver,
        url,
        username,
        password,
        token,
        allow_import,
        allow_write,
        allow_schema,
        allow_delete,
    } = req;

    if let Some(name) = name {
        stored.name = name;
    }
    if let Some(driver) = driver {
        stored.driver = driver;
    }
    if let Some(v) = allow_import {
        stored.allow_import = v;
    }
    if let Some(v) = allow_write {
        stored.allow_write = v;
    }
    if let Some(v) = allow_schema {
        stored.allow_schema = v;
    }
    if let Some(v) = allow_delete {
        stored.allow_delete = v;
    }

    if stored.driver == "neo4j" {
        if url.is_some() || username.is_some() || password.is_some() {
            let (Some(uri), Some(username), Some(password)) = (url, username, password) else {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "missing_credentials" })),
                )
                    .into_response();
            };
            let key = match crypto::load_data_key_from_env() {
                Ok(k) => k,
                Err(err) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({ "error": "missing_data_key", "message": err.to_string() })),
                    )
                        .into_response();
                }
            };
            let payload = serde_json::json!({
                "uri": uri,
                "username": username,
                "password": password,
            })
            .to_string();
            let url_enc = match crypto::encrypt_to_base64(&key, payload.as_bytes()) {
                Ok(v) => v,
                Err(err) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({ "error": "encrypt_failed", "message": err.to_string() })),
                    )
                        .into_response();
                }
            };
            stored.url_enc = url_enc;
        }
    } else if stored.driver == "milvus" {
        if url.is_some() || token.is_some() {
            let Some(base_url) = url else {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "missing_url" })),
                )
                    .into_response();
            };
            let key = match crypto::load_data_key_from_env() {
                Ok(k) => k,
                Err(err) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({ "error": "missing_data_key", "message": err.to_string() })),
                    )
                        .into_response();
                }
            };
            let payload = serde_json::json!({
                "baseUrl": base_url,
                "token": token,
            })
            .to_string();
            let url_enc = match crypto::encrypt_to_base64(&key, payload.as_bytes()) {
                Ok(v) => v,
                Err(err) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({ "error": "encrypt_failed", "message": err.to_string() })),
                    )
                        .into_response();
                }
            };
            stored.url_enc = url_enc;
        }
    } else if let Some(url) = url {
        let key = match crypto::load_data_key_from_env() {
            Ok(k) => k,
            Err(err) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "missing_data_key", "message": err.to_string() })),
                )
                    .into_response();
            }
        };
        let url_enc = match crypto::encrypt_to_base64(&key, url.as_bytes()) {
            Ok(v) => v,
            Err(err) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "encrypt_failed", "message": err.to_string() })),
                )
                    .into_response();
            }
        };
        stored.url_enc = url_enc;
    }

    stored.updated_at = now_ms().to_string();
    if let Err(err) = write_datasource(&state, &stored).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(DataSourcePublic {
            id: stored.id,
            name: stored.name,
            driver: stored.driver,
            url: "<redacted>".to_string(),
            allow_import: stored.allow_import,
            allow_write: stored.allow_write,
            allow_schema: stored.allow_schema,
            allow_delete: stored.allow_delete,
            updated_at: stored.updated_at,
        }),
    )
        .into_response()
}

fn is_safe_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn quote_ident_sqlite(ident: &str) -> String {
    format!("\"{}\"", ident.replace('\"', "\"\""))
}

fn quote_ident_pg(ident: &str) -> String {
    format!("\"{}\"", ident.replace('\"', "\"\""))
}

fn quote_ident_mysql(ident: &str) -> String {
    format!("`{}`", ident.replace('`', "``"))
}

fn quote_qualified_table(name: &str, quote: fn(&str) -> String) -> Option<String> {
    let parts = name.split('.').map(|s| s.trim()).collect::<Vec<_>>();
    if parts.is_empty() || parts.iter().any(|p| p.is_empty()) {
        return None;
    }
    Some(parts.into_iter().map(quote).collect::<Vec<_>>().join("."))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SqliteRowsQuery {
    limit: Option<u32>,
    offset: Option<u32>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SqliteRowsResponse {
    rows: Vec<HashMap<String, serde_json::Value>>,
}

async fn list_sqlite_table_rows(
    State(state): State<AppState>,
    Path((id, table)): Path<(String, String)>,
    axum::extract::Query(q): axum::extract::Query<SqliteRowsQuery>,
) -> axum::response::Response {
    let stored = match load_datasource(&state, &id).await {
        Ok(ds) => ds,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response();
        }
    };
    if stored.driver != "sqlite" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "unsupported_driver", "driver": stored.driver })),
        )
            .into_response();
    }
    if !stored.allow_write {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "write_disabled" })),
        )
            .into_response();
    }
    if !is_safe_identifier(&table) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_table" })),
        )
            .into_response();
    }
    let url = match decrypt_datasource_url(&state, &id).await {
        Ok(url) => url,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(
                    serde_json::json!({ "error": "datasource_failed", "message": err.to_string() }),
                ),
            )
                .into_response();
        }
    };

    let limit = q.limit.unwrap_or(100).min(500) as i64;
    let offset = q.offset.unwrap_or(0) as i64;

    use sqlx::{Column, Connection, Row};
    let mut conn = match sqlx::SqliteConnection::connect(&url).await {
        Ok(c) => c,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "connect_failed", "message": err.to_string() })),
            )
                .into_response();
        }
    };

    let table_ident = quote_ident_sqlite(&table);
    let sql = format!("SELECT rowid AS __rowid, * FROM {table_ident} LIMIT ? OFFSET ?");
    let rows = match sqlx::query(sql.as_str())
        .bind(limit)
        .bind(offset)
        .fetch_all(&mut conn)
        .await
    {
        Ok(r) => r,
        Err(err) => {
            let _ = conn.close().await;
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "query_failed", "message": err.to_string() })),
            )
                .into_response();
        }
    };

    let mut out = Vec::new();
    for row in rows {
        let mut map = HashMap::<String, serde_json::Value>::new();
        for (idx, col) in row.columns().iter().enumerate() {
            let name = col.name().to_string();
            let value = sqlite_row_value_to_json(&row, idx);
            map.insert(name, value);
        }
        out.push(map);
    }
    let _ = conn.close().await;
    (StatusCode::OK, Json(SqliteRowsResponse { rows: out })).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InsertSqliteRowRequest {
    row: HashMap<String, serde_json::Value>,
}

async fn insert_sqlite_table_row(
    State(state): State<AppState>,
    Path((id, table)): Path<(String, String)>,
    Json(req): Json<InsertSqliteRowRequest>,
) -> axum::response::Response {
    let stored = match load_datasource(&state, &id).await {
        Ok(ds) => ds,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response();
        }
    };
    if stored.driver != "sqlite" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "unsupported_driver", "driver": stored.driver })),
        )
            .into_response();
    }
    if !stored.allow_write {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "write_disabled" })),
        )
            .into_response();
    }
    if !is_safe_identifier(&table) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_table" })),
        )
            .into_response();
    }
    if req.row.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "validation_failed", "message": "empty_row" })),
        )
            .into_response();
    }
    if req.row.keys().any(|k| !is_safe_identifier(k)) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_columns" })),
        )
            .into_response();
    }

    let url = match decrypt_datasource_url(&state, &id).await {
        Ok(url) => url,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(
                    serde_json::json!({ "error": "datasource_failed", "message": err.to_string() }),
                ),
            )
                .into_response();
        }
    };

    use sqlx::Connection;
    let mut conn = match sqlx::SqliteConnection::connect(&url).await {
        Ok(c) => c,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "connect_failed", "message": err.to_string() })),
            )
                .into_response();
        }
    };

    let table_ident = quote_ident_sqlite(&table);
    let mut cols = req.row.keys().cloned().collect::<Vec<_>>();
    cols.sort();
    let col_list = cols
        .iter()
        .map(|c| quote_ident_sqlite(c))
        .collect::<Vec<_>>()
        .join(", ");
    let placeholders = (0..cols.len()).map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!("INSERT INTO {table_ident} ({col_list}) VALUES ({placeholders})");

    let mut q = sqlx::query(sql.as_str());
    for c in &cols {
        let v = req.row.get(c).cloned().unwrap_or(serde_json::Value::Null);
        match v {
            serde_json::Value::Null => {
                q = q.bind(None::<String>);
            }
            serde_json::Value::Bool(b) => {
                q = q.bind(if b { 1i64 } else { 0i64 });
            }
            serde_json::Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    q = q.bind(i);
                } else if let Some(f) = n.as_f64() {
                    q = q.bind(f);
                } else {
                    q = q.bind(n.to_string());
                }
            }
            serde_json::Value::String(s) => {
                q = q.bind(s);
            }
            other => {
                q = q.bind(other.to_string());
            }
        }
    }

    match q.execute(&mut conn).await {
        Ok(_) => {
            let _ = conn.close().await;
            (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
        }
        Err(err) => {
            let _ = conn.close().await;
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
            )
                .into_response()
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteSqliteRowRequest {
    row_id: i64,
}

async fn delete_sqlite_table_row(
    State(state): State<AppState>,
    Path((id, table)): Path<(String, String)>,
    Json(req): Json<DeleteSqliteRowRequest>,
) -> axum::response::Response {
    let stored = match load_datasource(&state, &id).await {
        Ok(ds) => ds,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response();
        }
    };
    if stored.driver != "sqlite" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "unsupported_driver", "driver": stored.driver })),
        )
            .into_response();
    }
    if !stored.allow_delete {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "delete_disabled" })),
        )
            .into_response();
    }
    if !is_safe_identifier(&table) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_table" })),
        )
            .into_response();
    }
    let url = match decrypt_datasource_url(&state, &id).await {
        Ok(url) => url,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(
                    serde_json::json!({ "error": "datasource_failed", "message": err.to_string() }),
                ),
            )
                .into_response();
        }
    };

    use sqlx::Connection;
    let mut conn = match sqlx::SqliteConnection::connect(&url).await {
        Ok(c) => c,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "connect_failed", "message": err.to_string() })),
            )
                .into_response();
        }
    };
    let table_ident = quote_ident_sqlite(&table);
    let sql = format!("DELETE FROM {table_ident} WHERE rowid = ?");
    match sqlx::query(sql.as_str())
        .bind(req.row_id)
        .execute(&mut conn)
        .await
    {
        Ok(_) => {
            let _ = conn.close().await;
            (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
        }
        Err(err) => {
            let _ = conn.close().await;
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
            )
                .into_response()
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSqliteTableRequest {
    table: String,
    columns: Vec<CreateSqliteColumn>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSqliteColumn {
    name: String,
    data_type: String,
    #[serde(default)]
    nullable: bool,
}

async fn create_sqlite_table(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<CreateSqliteTableRequest>,
) -> axum::response::Response {
    let stored = match load_datasource(&state, &id).await {
        Ok(ds) => ds,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response();
        }
    };
    if stored.driver != "sqlite" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "unsupported_driver", "driver": stored.driver })),
        )
            .into_response();
    }
    if !stored.allow_schema {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "schema_disabled" })),
        )
            .into_response();
    }
    if !is_safe_identifier(&req.table) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_table" })),
        )
            .into_response();
    }
    if req.columns.is_empty()
        || req
            .columns
            .iter()
            .any(|c| !is_safe_identifier(&c.name) || c.name == "__rowid")
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_columns" })),
        )
            .into_response();
    }
    let allowed = ["TEXT", "INTEGER", "REAL", "BLOB", "NUMERIC"];
    if req.columns.iter().any(|c| {
        let dt = c.data_type.trim().to_ascii_uppercase();
        !allowed.contains(&dt.as_str())
    }) {
        return (
            StatusCode::BAD_REQUEST,
            Json(
                serde_json::json!({ "error": "validation_failed", "message": "invalid_data_type" }),
            ),
        )
            .into_response();
    }

    let url = match decrypt_datasource_url(&state, &id).await {
        Ok(url) => url,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(
                    serde_json::json!({ "error": "datasource_failed", "message": err.to_string() }),
                ),
            )
                .into_response();
        }
    };

    use sqlx::{Connection, Executor};
    let mut conn = match sqlx::SqliteConnection::connect(&url).await {
        Ok(c) => c,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "connect_failed", "message": err.to_string() })),
            )
                .into_response();
        }
    };

    let table_ident = quote_ident_sqlite(&req.table);
    let col_defs = req
        .columns
        .iter()
        .map(|c| {
            let dt = c.data_type.trim().to_ascii_uppercase();
            let null_sql = if c.nullable { "" } else { " NOT NULL" };
            format!("{} {}{}", quote_ident_sqlite(&c.name), dt, null_sql)
        })
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("CREATE TABLE IF NOT EXISTS {table_ident} ({col_defs})");
    match conn.execute(sql.as_str()).await {
        Ok(_) => {
            let _ = conn.close().await;
            (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
        }
        Err(err) => {
            let _ = conn.close().await;
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
            )
                .into_response()
        }
    }
}

fn sqlite_row_value_to_json(row: &sqlx::sqlite::SqliteRow, idx: usize) -> serde_json::Value {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine as _;
    use sqlx::{Row, ValueRef};

    let Ok(raw) = row.try_get_raw(idx) else {
        return serde_json::Value::Null;
    };
    if raw.is_null() {
        return serde_json::Value::Null;
    }

    if let Ok(v) = row.try_get::<i64, _>(idx) {
        return serde_json::Value::Number(v.into());
    }
    if let Ok(v) = row.try_get::<f64, _>(idx) {
        return serde_json::Number::from_f64(v)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::String(v.to_string()));
    }
    if let Ok(v) = row.try_get::<String, _>(idx) {
        return serde_json::Value::String(v);
    }
    if let Ok(v) = row.try_get::<Vec<u8>, _>(idx) {
        return serde_json::Value::String(STANDARD.encode(v));
    }

    serde_json::Value::String("<unprintable>".to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorCollection {
    name: String,
    dimension: u32,
    distance: String,
    created_at: String,
}

fn vector_base_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("vector")
}

async fn list_vector_collections(State(state): State<AppState>) -> axum::response::Response {
    let dir = vector_base_dir(&state).join("collections");
    let mut out = Vec::<VectorCollection>::new();
    let mut rd = match tokio::fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(_) => {
            return (StatusCode::OK, Json(out)).into_response();
        }
    };
    while let Ok(Some(entry)) = rd.next_entry().await {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Ok(text) = tokio::fs::read_to_string(&path).await {
            if let Ok(c) = serde_json::from_str::<VectorCollection>(&text) {
                out.push(c);
            }
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    (StatusCode::OK, Json(out)).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateVectorCollectionRequest {
    name: String,
    dimension: u32,
    distance: String,
}

async fn create_vector_collection(
    State(state): State<AppState>,
    Json(req): Json<CreateVectorCollectionRequest>,
) -> axum::response::Response {
    if !is_safe_identifier(&req.name) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_collection" })),
        )
            .into_response();
    }
    if req.dimension == 0 || req.dimension > 4096 {
        return (
            StatusCode::BAD_REQUEST,
            Json(
                serde_json::json!({ "error": "validation_failed", "message": "invalid_dimension" }),
            ),
        )
            .into_response();
    }
    let distance = req.distance.trim().to_ascii_lowercase();
    if distance != "cosine" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "validation_failed", "message": "unsupported_distance" })),
        )
            .into_response();
    }

    let base = vector_base_dir(&state);
    let col_dir = base.join("collections");
    let points_dir = base.join("points");
    if tokio::fs::create_dir_all(&col_dir).await.is_err()
        || tokio::fs::create_dir_all(&points_dir).await.is_err()
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed" })),
        )
            .into_response();
    }

    let meta = VectorCollection {
        name: req.name.clone(),
        dimension: req.dimension,
        distance: distance.to_string(),
        created_at: now_ms().to_string(),
    };
    let path = col_dir.join(format!("{}.json", req.name));
    let text = match serde_json::to_string_pretty(&meta) {
        Ok(t) => t,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
            )
                .into_response();
        }
    };
    if let Err(err) = tokio::fs::write(&path, text).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
        )
            .into_response();
    }
    let points_path = points_dir.join(format!("{}.jsonl", req.name));
    if tokio::fs::metadata(&points_path).await.is_err() {
        let _ = tokio::fs::write(&points_path, b"").await;
    }

    (StatusCode::OK, Json(meta)).into_response()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorPoint {
    id: String,
    vector: Vec<f32>,
    #[serde(default)]
    payload: serde_json::Value,
    batch_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertVectorPointsRequest {
    collection: String,
    points: Vec<VectorPoint>,
    batch_id: Option<String>,
}

async fn upsert_vector_points(
    State(state): State<AppState>,
    Json(req): Json<UpsertVectorPointsRequest>,
) -> axum::response::Response {
    if !is_safe_identifier(&req.collection) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_collection" })),
        )
            .into_response();
    }
    if req.points.is_empty() || req.points.len() > 10_000 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "limit_exceeded", "message": "too_many_points" })),
        )
            .into_response();
    }

    let base = vector_base_dir(&state);
    let col_path = base
        .join("collections")
        .join(format!("{}.json", req.collection));
    let meta_text = match tokio::fs::read_to_string(&col_path).await {
        Ok(t) => t,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "collection": req.collection })),
            )
                .into_response();
        }
    };
    let meta: VectorCollection = match serde_json::from_str(&meta_text) {
        Ok(m) => m,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "parse_failed" })),
            )
                .into_response();
        }
    };

    if req
        .points
        .iter()
        .any(|p| p.id.trim().is_empty() || p.vector.len() != meta.dimension as usize)
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "validation_failed", "message": "dimension_mismatch" })),
        )
            .into_response();
    }

    let points_path = base
        .join("points")
        .join(format!("{}.jsonl", req.collection));
    let existing = tokio::fs::read_to_string(&points_path)
        .await
        .unwrap_or_default();
    let mut map = HashMap::<String, VectorPoint>::new();
    for line in existing.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(p) = serde_json::from_str::<VectorPoint>(line) {
            map.insert(p.id.clone(), p);
        }
    }
    let batch_id = req.batch_id.clone();
    for mut p in req.points {
        if p.payload.is_null() {
            p.payload = serde_json::Value::Object(serde_json::Map::new());
        }
        if p.batch_id.is_none() {
            p.batch_id = batch_id.clone();
        }
        map.insert(p.id.clone(), p);
    }

    let mut out = String::new();
    for p in map.values() {
        if let Ok(line) = serde_json::to_string(p) {
            out.push_str(&line);
            out.push('\n');
        }
    }
    if let Err(err) = tokio::fs::write(&points_path, out).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({ "upserted": map.len() })),
    )
        .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorFilter {
    must: Option<Vec<VectorFilterCondition>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorFilterCondition {
    key: String,
    r#match: VectorMatch,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorMatch {
    value: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchVectorRequest {
    collection: String,
    vector: Vec<f32>,
    top_k: Option<u32>,
    filter: Option<VectorFilter>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VectorSearchHit {
    id: String,
    score: f32,
    payload: serde_json::Value,
}

async fn search_vector(
    State(state): State<AppState>,
    Json(req): Json<SearchVectorRequest>,
) -> axum::response::Response {
    if !is_safe_identifier(&req.collection) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_collection" })),
        )
            .into_response();
    }
    let top_k = req.top_k.unwrap_or(10).min(100) as usize;

    let base = vector_base_dir(&state);
    let col_path = base
        .join("collections")
        .join(format!("{}.json", req.collection));
    let meta_text = match tokio::fs::read_to_string(&col_path).await {
        Ok(t) => t,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "collection": req.collection })),
            )
                .into_response();
        }
    };
    let meta: VectorCollection = match serde_json::from_str(&meta_text) {
        Ok(m) => m,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "parse_failed" })),
            )
                .into_response();
        }
    };
    if req.vector.len() != meta.dimension as usize {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "validation_failed", "message": "dimension_mismatch" })),
        )
            .into_response();
    }

    let points_path = base
        .join("points")
        .join(format!("{}.jsonl", req.collection));
    let text = tokio::fs::read_to_string(&points_path)
        .await
        .unwrap_or_default();
    let mut hits = Vec::<VectorSearchHit>::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(p) = serde_json::from_str::<VectorPoint>(line) else {
            continue;
        };
        if !vector_point_matches_filter(&p, req.filter.as_ref()) {
            continue;
        }
        let score = cosine_similarity(&req.vector, &p.vector);
        hits.push(VectorSearchHit {
            id: p.id,
            score,
            payload: p.payload,
        });
    }
    hits.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    hits.truncate(top_k);
    (StatusCode::OK, Json(serde_json::json!({ "hits": hits }))).into_response()
}

fn vector_point_matches_filter(p: &VectorPoint, filter: Option<&VectorFilter>) -> bool {
    let Some(filter) = filter else {
        return true;
    };
    let Some(must) = &filter.must else {
        return true;
    };
    for cond in must {
        if cond.key.trim().is_empty() {
            return false;
        }
        let Some(obj) = p.payload.as_object() else {
            return false;
        };
        let Some(v) = obj.get(&cond.key) else {
            return false;
        };
        if v != &cond.r#match.value {
            return false;
        }
    }
    true
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteVectorPointsRequest {
    collection: String,
    filter: Option<VectorFilter>,
    batch_id: Option<String>,
}

async fn delete_vector_points(
    State(state): State<AppState>,
    Json(req): Json<DeleteVectorPointsRequest>,
) -> axum::response::Response {
    if !is_safe_identifier(&req.collection) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_collection" })),
        )
            .into_response();
    }
    let base = vector_base_dir(&state);
    let points_path = base
        .join("points")
        .join(format!("{}.jsonl", req.collection));
    let text = tokio::fs::read_to_string(&points_path)
        .await
        .unwrap_or_default();
    let mut kept = Vec::<VectorPoint>::new();
    let mut deleted: u64 = 0;
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(p) = serde_json::from_str::<VectorPoint>(line) else {
            continue;
        };
        let by_batch = req
            .batch_id
            .as_deref()
            .is_some_and(|bid| p.batch_id.as_deref() == Some(bid));
        let by_filter = vector_point_matches_filter(&p, req.filter.as_ref());
        let should_delete = if req.batch_id.is_some() {
            by_batch && by_filter
        } else {
            by_filter
        };
        if should_delete {
            deleted += 1;
        } else {
            kept.push(p);
        }
    }
    let mut out = String::new();
    for p in kept {
        if let Ok(line) = serde_json::to_string(&p) {
            out.push_str(&line);
            out.push('\n');
        }
    }
    if let Err(err) = tokio::fs::write(&points_path, out).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
        )
            .into_response();
    }
    (
        StatusCode::OK,
        Json(serde_json::json!({ "deleted": deleted })),
    )
        .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportCsvQuery {
    table: String,
    #[serde(default)]
    header: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportJobRecord {
    id: String,
    data_source_id: String,
    driver: String,
    table: String,
    header: bool,
    status: String,
    inserted_rows: Option<u64>,
    error: Option<String>,
    created_at: String,
    finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportJobSummary {
    id: String,
    data_source_id: String,
    driver: String,
    table: String,
    status: String,
    inserted_rows: Option<u64>,
    created_at: String,
    finished_at: Option<String>,
}

async fn write_import_job(state: &AppState, job: &ImportJobRecord) -> anyhow::Result<()> {
    let dir = state.data_dir.join("imports");
    tokio::fs::create_dir_all(&dir).await?;
    let path = dir.join(format!("{}.json", job.id));
    let text = serde_json::to_string_pretty(job)?;
    tokio::fs::write(path, text).await?;
    Ok(())
}

async fn list_imports(State(state): State<AppState>) -> axum::response::Response {
    let dir = state.data_dir.join("imports");
    let mut out = Vec::<ImportJobSummary>::new();

    let mut rd = match tokio::fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(_) => {
            return (StatusCode::OK, Json(out)).into_response();
        }
    };

    while let Ok(Some(entry)) = rd.next_entry().await {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(ext) = path.extension().and_then(|s| s.to_str()) else {
            continue;
        };
        if ext != "json" {
            continue;
        }
        if let Ok(text) = tokio::fs::read_to_string(&path).await {
            if let Ok(job) = serde_json::from_str::<ImportJobRecord>(&text) {
                out.push(ImportJobSummary {
                    id: job.id,
                    data_source_id: job.data_source_id,
                    driver: job.driver,
                    table: job.table,
                    status: job.status,
                    inserted_rows: job.inserted_rows,
                    created_at: job.created_at,
                    finished_at: job.finished_at,
                });
            }
        }
    }

    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    (StatusCode::OK, Json(out)).into_response()
}

async fn get_import(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> axum::response::Response {
    let path = state.data_dir.join("imports").join(format!("{id}.json"));
    let text = match tokio::fs::read_to_string(&path).await {
        Ok(t) => t,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response();
        }
    };

    match serde_json::from_str::<ImportJobRecord>(&text) {
        Ok(job) => (StatusCode::OK, Json(job)).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "parse_failed", "id": id })),
        )
            .into_response(),
    }
}

async fn import_csv(
    State(state): State<AppState>,
    Path(id): Path<String>,
    axum::extract::Query(q): axum::extract::Query<ImportCsvQuery>,
    body: Bytes,
) -> axum::response::Response {
    let max_bytes = std::env::var("IMPORT_MAX_BYTES")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(2 * 1024 * 1024);
    if body.len() > max_bytes {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(serde_json::json!({ "error": "limit_exceeded", "message": "file_too_large" })),
        )
            .into_response();
    }

    let stored = match load_datasource(&state, &id).await {
        Ok(ds) => ds,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response();
        }
    };
    if !stored.allow_import {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "import_disabled" })),
        )
            .into_response();
    }
    if !is_sql_driver(&stored.driver) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "unsupported_driver" })),
        )
            .into_response();
    }
    let driver = stored.driver.clone();
    let table_is_valid = if driver == "sqlite" {
        is_safe_identifier(&q.table)
    } else {
        is_safe_table_name(&q.table)
    };
    if !table_is_valid {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_table" })),
        )
            .into_response();
    }

    let url = match decrypt_datasource_url(&state, &id).await {
        Ok(url) => url,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(
                    serde_json::json!({ "error": "datasource_failed", "message": err.to_string() }),
                ),
            )
                .into_response();
        }
    };

    let max_rows = std::env::var("IMPORT_MAX_ROWS")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(5_000);
    let max_cols = std::env::var("IMPORT_MAX_COLS")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(128);

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(q.header)
        .from_reader(body.as_ref());

    let headers = if q.header {
        match reader.headers() {
            Ok(h) => h.iter().map(|s| s.trim().to_string()).collect::<Vec<_>>(),
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "invalid_format" })),
                )
                    .into_response();
            }
        }
    } else {
        Vec::<String>::new()
    };

    let mut inferred_cols: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<String>> = Vec::new();
    for rec in reader.records().take(max_rows + 1) {
        let rec = match rec {
            Ok(r) => r,
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "invalid_format" })),
                )
                    .into_response();
            }
        };
        if rows.len() >= max_rows {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "limit_exceeded", "message": "too_many_rows" })),
            )
                .into_response();
        }
        let values = rec.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        if values.len() > max_cols {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "limit_exceeded", "message": "too_many_cols" })),
            )
                .into_response();
        }
        if inferred_cols.is_empty() {
            inferred_cols = if q.header {
                headers.clone()
            } else {
                (1..=values.len()).map(|i| format!("col_{i}")).collect()
            };
        }
        rows.push(values);
    }

    if inferred_cols.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_format", "message": "empty_csv" })),
        )
            .into_response();
    }
    if q.header && inferred_cols.iter().any(|c| !is_safe_identifier(c)) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_columns" })),
        )
            .into_response();
    }

    let job_id = format!("imp_{}", now_ms());
    let mut job = ImportJobRecord {
        id: job_id.clone(),
        data_source_id: id.clone(),
        driver: driver.clone(),
        table: q.table.clone(),
        header: q.header,
        status: "running".to_string(),
        inserted_rows: None,
        error: None,
        created_at: now_ms().to_string(),
        finished_at: None,
    };
    let _ = write_import_job(&state, &job).await;

    let result: anyhow::Result<u64> = match driver.as_str() {
        "sqlite" => import_rows_sqlite(&url, &q.table, &inferred_cols, &rows).await,
        "postgres" => import_rows_postgres(&url, &q.table, &inferred_cols, &rows).await,
        "mysql" => import_rows_mysql(&url, &q.table, &inferred_cols, &rows).await,
        _ => Err(anyhow::anyhow!("unsupported_driver")),
    };

    match result {
        Ok(inserted) => {
            job.status = "success".to_string();
            job.inserted_rows = Some(inserted);
            job.finished_at = Some(now_ms().to_string());
            let _ = write_import_job(&state, &job).await;
            (
                StatusCode::OK,
                Json(serde_json::json!({ "jobId": job_id, "insertedRows": inserted })),
            )
                .into_response()
        }
        Err(err) => {
            job.status = "error".to_string();
            job.error = Some(err.to_string());
            job.finished_at = Some(now_ms().to_string());
            let _ = write_import_job(&state, &job).await;
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "write_failed", "message": err.to_string(), "jobId": job_id })),
            )
                .into_response()
        }
    }
}

async fn import_rows_sqlite(
    url: &str,
    table: &str,
    cols: &[String],
    rows: &[Vec<String>],
) -> anyhow::Result<u64> {
    use sqlx::{Connection, Executor};
    let mut conn = sqlx::SqliteConnection::connect(url).await?;

    let table_ident = quote_ident_sqlite(table);
    let col_defs = cols
        .iter()
        .map(|c| format!("{} TEXT", quote_ident_sqlite(c)))
        .collect::<Vec<_>>()
        .join(", ");
    let create_sql = format!("CREATE TABLE IF NOT EXISTS {table_ident} ({col_defs})");
    conn.execute(create_sql.as_str()).await?;

    let placeholders = (0..cols.len()).map(|_| "?").collect::<Vec<_>>().join(", ");
    let col_list = cols
        .iter()
        .map(|c| quote_ident_sqlite(c))
        .collect::<Vec<_>>()
        .join(", ");
    let insert_sql = format!("INSERT INTO {table_ident} ({col_list}) VALUES ({placeholders})");

    let mut tx = conn.begin().await?;
    let mut inserted: u64 = 0;
    for row in rows {
        if row.len() != cols.len() {
            anyhow::bail!("row_len_mismatch");
        }
        let mut q = sqlx::query(insert_sql.as_str());
        for v in row {
            q = q.bind(v);
        }
        q.execute(&mut *tx).await?;
        inserted += 1;
    }
    tx.commit().await?;
    Ok(inserted)
}

async fn import_rows_postgres(
    url: &str,
    table: &str,
    cols: &[String],
    rows: &[Vec<String>],
) -> anyhow::Result<u64> {
    use sqlx::{Connection, Executor};
    let mut conn = sqlx::PgConnection::connect(url).await?;

    let table_ident = quote_qualified_table(table, quote_ident_pg)
        .ok_or_else(|| anyhow::anyhow!("invalid_table"))?;
    let col_defs = cols
        .iter()
        .map(|c| format!("{} TEXT", quote_ident_pg(c)))
        .collect::<Vec<_>>()
        .join(", ");
    let create_sql = format!("CREATE TABLE IF NOT EXISTS {table_ident} ({col_defs})");
    conn.execute(create_sql.as_str()).await?;

    let placeholders = (1..=cols.len())
        .map(|i| format!("${i}"))
        .collect::<Vec<_>>()
        .join(", ");
    let col_list = cols
        .iter()
        .map(|c| quote_ident_pg(c))
        .collect::<Vec<_>>()
        .join(", ");
    let insert_sql = format!("INSERT INTO {table_ident} ({col_list}) VALUES ({placeholders})");

    let mut tx = conn.begin().await?;
    let mut inserted: u64 = 0;
    for row in rows {
        if row.len() != cols.len() {
            anyhow::bail!("row_len_mismatch");
        }
        let mut q = sqlx::query(insert_sql.as_str());
        for v in row {
            q = q.bind(v);
        }
        q.execute(&mut *tx).await?;
        inserted += 1;
    }
    tx.commit().await?;
    Ok(inserted)
}

async fn import_rows_mysql(
    url: &str,
    table: &str,
    cols: &[String],
    rows: &[Vec<String>],
) -> anyhow::Result<u64> {
    use sqlx::{Connection, Executor};
    let mut conn = sqlx::MySqlConnection::connect(url).await?;

    let table_ident = quote_qualified_table(table, quote_ident_mysql)
        .ok_or_else(|| anyhow::anyhow!("invalid_table"))?;
    let col_defs = cols
        .iter()
        .map(|c| format!("{} TEXT", quote_ident_mysql(c)))
        .collect::<Vec<_>>()
        .join(", ");
    let create_sql = format!("CREATE TABLE IF NOT EXISTS {table_ident} ({col_defs})");
    conn.execute(create_sql.as_str()).await?;

    let placeholders = (0..cols.len()).map(|_| "?").collect::<Vec<_>>().join(", ");
    let col_list = cols
        .iter()
        .map(|c| quote_ident_mysql(c))
        .collect::<Vec<_>>()
        .join(", ");
    let insert_sql = format!("INSERT INTO {table_ident} ({col_list}) VALUES ({placeholders})");

    let mut tx = conn.begin().await?;
    let mut inserted: u64 = 0;
    for row in rows {
        if row.len() != cols.len() {
            anyhow::bail!("row_len_mismatch");
        }
        let mut q = sqlx::query(insert_sql.as_str());
        for v in row {
            q = q.bind(v);
        }
        q.execute(&mut *tx).await?;
        inserted += 1;
    }
    tx.commit().await?;
    Ok(inserted)
}

async fn delete_datasource(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> axum::response::Response {
    let path = state
        .data_dir
        .join("datasources")
        .join(format!("{id}.json"));
    match tokio::fs::remove_file(&path).await {
        Ok(_) => (StatusCode::NO_CONTENT, Body::empty()).into_response(),
        Err(_) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "not_found", "id": id })),
        )
            .into_response(),
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataSourceTestResponse {
    ok: bool,
}

async fn test_datasource(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> axum::response::Response {
    let driver = match load_datasource(&state, &id).await {
        Ok(ds) => ds.driver,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response();
        }
    };

    if is_sql_driver(&driver) {
        let url = match decrypt_datasource_url(&state, &id).await {
            Ok(url) => url,
            Err(err) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "decrypt_failed", "message": err.to_string() })),
                )
                    .into_response();
            }
        };
        match connectors::sql::test_connection(&url).await {
            Ok(_) => (StatusCode::OK, Json(DataSourceTestResponse { ok: true })).into_response(),
            Err(err) => (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "connect_failed", "message": err.to_string() })),
            )
                .into_response(),
        }
    } else if driver == "neo4j" {
        let cfg = match decrypt_neo4j_config(&state, &id).await {
            Ok(v) => v,
            Err(err) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "decrypt_failed", "message": err.to_string() })),
                )
                    .into_response();
            }
        };
        match connectors::neo4j::test_connection(&cfg.uri, &cfg.username, &cfg.password).await {
            Ok(_) => (StatusCode::OK, Json(DataSourceTestResponse { ok: true })).into_response(),
            Err(err) => (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "connect_failed", "message": err.to_string() })),
            )
                .into_response(),
        }
    } else if driver == "milvus" {
        let cfg = match decrypt_milvus_config(&state, &id).await {
            Ok(v) => v,
            Err(err) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "decrypt_failed", "message": err.to_string() })),
                )
                    .into_response();
            }
        };
        let client = connectors::milvus::MilvusRestClient::new(cfg.base_url, cfg.token);
        match client.list_collections().await {
            Ok(_) => (StatusCode::OK, Json(DataSourceTestResponse { ok: true })).into_response(),
            Err(err) => (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "connect_failed", "message": err.to_string() })),
            )
                .into_response(),
        }
    } else {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "unsupported_driver", "driver": driver })),
        )
            .into_response()
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableListResponse {
    tables: Vec<String>,
}

async fn list_datasource_tables(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> axum::response::Response {
    let driver = match load_datasource(&state, &id).await {
        Ok(ds) => ds.driver,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response();
        }
    };
    if !is_sql_driver(&driver) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "unsupported_driver", "driver": driver })),
        )
            .into_response();
    }

    let url = match decrypt_datasource_url(&state, &id).await {
        Ok(url) => url,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "decrypt_failed", "message": err.to_string() })),
            )
                .into_response();
        }
    };

    match list_tables_for_url(&url).await {
        Ok(tables) => (StatusCode::OK, Json(TableListResponse { tables })).into_response(),
        Err(err) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "list_tables_failed", "message": err.to_string() })),
        )
            .into_response(),
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ColumnInfo {
    name: String,
    data_type: String,
    nullable: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ColumnListResponse {
    columns: Vec<ColumnInfo>,
}

async fn list_datasource_table_columns(
    State(state): State<AppState>,
    Path((id, table)): Path<(String, String)>,
) -> axum::response::Response {
    let stored = match load_datasource(&state, &id).await {
        Ok(ds) => ds,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response();
        }
    };
    if !is_sql_driver(&stored.driver) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "unsupported_driver", "driver": stored.driver })),
        )
            .into_response();
    }

    if !is_safe_table_name(&table) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_table", "table": table })),
        )
            .into_response();
    }

    let url = match decrypt_datasource_url(&state, &id).await {
        Ok(url) => url,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "decrypt_failed", "message": err.to_string() })),
            )
                .into_response();
        }
    };

    let columns = match list_table_columns_for_url(&url, &table).await {
        Ok(cols) => cols,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "query_failed", "message": err.to_string() })),
            )
                .into_response();
        }
    };

    (StatusCode::OK, Json(ColumnListResponse { columns })).into_response()
}

fn is_sql_driver(driver: &str) -> bool {
    matches!(driver, "sqlite" | "postgres" | "mysql")
}

fn is_safe_table_name(name: &str) -> bool {
    let name = name.trim();
    if name.is_empty() || name.len() > 128 {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
        && !name.starts_with('.')
        && !name.ends_with('.')
        && !name.contains("..")
}

async fn list_tables_for_url(url: &str) -> anyhow::Result<Vec<String>> {
    use sqlx::{Connection, Row};

    sqlx::any::install_default_drivers();
    let mut conn = <sqlx::AnyConnection as Connection>::connect(url).await?;
    let scheme = url.split(':').next().unwrap_or("").to_ascii_lowercase();

    let sql = match scheme.as_str() {
        "sqlite" => "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        "postgres" | "postgresql" => "SELECT table_schema || '.' || table_name AS name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1",
        "mysql" => "SELECT CONCAT(table_schema, '.', table_name) AS name FROM information_schema.tables WHERE table_schema NOT IN ('information_schema','mysql','performance_schema','sys') ORDER BY 1",
        _ => "SELECT 1 AS name WHERE 1=0",
    };

    let rows = sqlx::query(sql).fetch_all(&mut conn).await?;
    let mut out = Vec::new();
    for row in rows {
        if let Ok(name) = row.try_get::<String, _>("name") {
            out.push(name);
        }
    }
    conn.close().await?;
    Ok(out)
}

async fn decrypt_datasource_url(state: &AppState, id: &str) -> anyhow::Result<String> {
    let key = crypto::load_data_key_from_env()?;
    let stored = load_datasource(state, id).await?;
    let bytes = crypto::decrypt_from_base64(&key, &stored.url_enc)?;
    Ok(String::from_utf8(bytes)?)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Neo4jConfig {
    uri: String,
    username: String,
    password: String,
}

async fn decrypt_neo4j_config(state: &AppState, id: &str) -> anyhow::Result<Neo4jConfig> {
    let key = crypto::load_data_key_from_env()?;
    let stored = load_datasource(state, id).await?;
    let bytes = crypto::decrypt_from_base64(&key, &stored.url_enc)?;
    let text = String::from_utf8(bytes)?;
    Ok(serde_json::from_str(&text)?)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MilvusConfig {
    base_url: String,
    token: Option<String>,
}

async fn decrypt_milvus_config(state: &AppState, id: &str) -> anyhow::Result<MilvusConfig> {
    let key = crypto::load_data_key_from_env()?;
    let stored = load_datasource(state, id).await?;
    let bytes = crypto::decrypt_from_base64(&key, &stored.url_enc)?;
    let text = String::from_utf8(bytes)?;
    Ok(serde_json::from_str(&text)?)
}

async fn load_datasource(state: &AppState, id: &str) -> anyhow::Result<DataSourceStored> {
    let path = state
        .data_dir
        .join("datasources")
        .join(format!("{id}.json"));
    let text = tokio::fs::read_to_string(path).await?;
    Ok(serde_json::from_str(&text)?)
}

async fn write_datasource(state: &AppState, ds: &DataSourceStored) -> anyhow::Result<()> {
    let dir = state.data_dir.join("datasources");
    tokio::fs::create_dir_all(&dir).await?;
    let path = dir.join(format!("{}.json", ds.id));
    let text = serde_json::to_string_pretty(ds)?;
    tokio::fs::write(path, text).await?;
    Ok(())
}

async fn load_provider(state: &AppState, id: &str) -> anyhow::Result<ProviderStored> {
    let path = state.data_dir.join("providers").join(format!("{id}.json"));
    let text = tokio::fs::read_to_string(path).await?;
    Ok(serde_json::from_str(&text)?)
}

async fn write_provider(state: &AppState, p: &ProviderStored) -> anyhow::Result<()> {
    let dir = state.data_dir.join("providers");
    tokio::fs::create_dir_all(&dir).await?;
    let path = dir.join(format!("{}.json", p.id));
    let text = serde_json::to_string_pretty(p)?;
    tokio::fs::write(path, text).await?;
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionMessage {
    role: String,
    content: String,
    created_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    id: String,
    name: String,
    messages: Vec<SessionMessage>,
    updated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionSummary {
    id: String,
    name: String,
    updated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSessionRequest {
    name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppendMessagesRequest {
    messages: Vec<SessionMessage>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderSessionRequest {
    max_messages: Option<u32>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderSessionResponse {
    value: String,
}

async fn list_projects(State(state): State<AppState>) -> axum::response::Response {
    let dir = state.data_dir.join("projects");
    let mut out = Vec::<ProjectSummary>::new();

    let mut rd = match tokio::fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(_) => {
            return (StatusCode::OK, Json(out)).into_response();
        }
    };

    while let Ok(Some(entry)) = rd.next_entry().await {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(ext) = path.extension().and_then(|s| s.to_str()) else {
            continue;
        };
        if ext != "json" {
            continue;
        }

        if let Ok(text) = tokio::fs::read_to_string(&path).await {
            if let Ok(p) = serde_json::from_str::<ProjectDoc>(&text) {
                out.push(ProjectSummary {
                    id: p.id,
                    name: p.name,
                    updated_at: p.updated_at,
                });
            }
        }
    }

    (StatusCode::OK, Json(out)).into_response()
}

async fn get_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> axum::response::Response {
    let path = state.data_dir.join("projects").join(format!("{id}.json"));
    let text = match tokio::fs::read_to_string(&path).await {
        Ok(t) => t,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response();
        }
    };

    match serde_json::from_str::<ProjectDoc>(&text) {
        Ok(p) => (StatusCode::OK, Json(p)).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "parse_failed", "id": id })),
        )
            .into_response(),
    }
}

async fn create_project(
    State(state): State<AppState>,
    Json(req): Json<CreateProjectRequest>,
) -> axum::response::Response {
    let id = format!("p_{}", now_ms());
    let p = ProjectDoc {
        id: id.clone(),
        name: req.name,
        state: req.state,
        updated_at: now_ms().to_string(),
    };

    if let Err(err) = write_project(&state, &p).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "detail": err.to_string() })),
        )
            .into_response();
    }

    (StatusCode::CREATED, Json(p)).into_response()
}

async fn upsert_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<ProjectUpsertRequest>,
) -> axum::response::Response {
    let p = ProjectDoc {
        id: id.clone(),
        name: req.name,
        state: req.state,
        updated_at: now_ms().to_string(),
    };

    if let Err(err) = write_project(&state, &p).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "detail": err.to_string() })),
        )
            .into_response();
    }

    (StatusCode::OK, Json(p)).into_response()
}

async fn write_project(state: &AppState, p: &ProjectDoc) -> anyhow::Result<()> {
    let dir = state.data_dir.join("projects");
    tokio::fs::create_dir_all(&dir).await?;
    let path = dir.join(format!("{}.json", p.id));
    let text = serde_json::to_string_pretty(p)?;
    tokio::fs::write(path, text).await?;
    Ok(())
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

async fn list_sessions(State(state): State<AppState>) -> axum::response::Response {
    let dir = state.data_dir.join("sessions");
    let mut out = Vec::<SessionSummary>::new();

    let mut rd = match tokio::fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(_) => {
            return (StatusCode::OK, Json(out)).into_response();
        }
    };

    while let Ok(Some(entry)) = rd.next_entry().await {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(ext) = path.extension().and_then(|s| s.to_str()) else {
            continue;
        };
        if ext != "json" {
            continue;
        }

        if let Ok(text) = tokio::fs::read_to_string(&path).await {
            if let Ok(s) = serde_json::from_str::<Session>(&text) {
                out.push(SessionSummary {
                    id: s.id,
                    name: s.name,
                    updated_at: s.updated_at,
                });
            }
        }
    }

    (StatusCode::OK, Json(out)).into_response()
}

async fn create_session(
    State(state): State<AppState>,
    Json(req): Json<CreateSessionRequest>,
) -> axum::response::Response {
    let id = format!("s_{}", now_ms());
    let s = Session {
        id: id.clone(),
        name: req.name,
        messages: Vec::new(),
        updated_at: now_ms().to_string(),
    };

    if let Err(err) = write_session(&state, &s).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "detail": err.to_string() })),
        )
            .into_response();
    }

    (StatusCode::CREATED, Json(s)).into_response()
}

async fn get_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> axum::response::Response {
    let path = state.data_dir.join("sessions").join(format!("{id}.json"));
    let text = match tokio::fs::read_to_string(&path).await {
        Ok(t) => t,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response();
        }
    };

    match serde_json::from_str::<Session>(&text) {
        Ok(s) => (StatusCode::OK, Json(s)).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "parse_failed", "id": id })),
        )
            .into_response(),
    }
}

async fn append_messages(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<AppendMessagesRequest>,
) -> axum::response::Response {
    let mut s = match load_session(&state, &id).await {
        Ok(s) => s,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response();
        }
    };

    s.messages.extend(req.messages);
    s.updated_at = now_ms().to_string();

    if let Err(err) = write_session(&state, &s).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "detail": err.to_string() })),
        )
            .into_response();
    }

    (StatusCode::OK, Json(s)).into_response()
}

async fn render_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<RenderSessionRequest>,
) -> axum::response::Response {
    let s = match load_session(&state, &id).await {
        Ok(s) => s,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response();
        }
    };

    let max = req.max_messages.unwrap_or(20) as usize;
    let out = render_session_as_text(&s, max);

    (StatusCode::OK, Json(RenderSessionResponse { value: out })).into_response()
}

fn render_session_as_text(s: &Session, max_messages: usize) -> String {
    let max = max_messages.min(200);
    let slice = if s.messages.len() > max {
        &s.messages[s.messages.len() - max..]
    } else {
        &s.messages[..]
    };

    let mut out = String::new();
    for m in slice {
        let role = match m.role.as_str() {
            "user" => "[User]",
            "assistant" => "[Assistant]",
            "system" => "[System]",
            "tool" => "[Tool]",
            other => other,
        };
        out.push_str(role);
        out.push_str(": ");
        out.push_str(m.content.trim());
        out.push('\n');
    }
    out.trim().to_string()
}

async fn load_session(state: &AppState, id: &str) -> anyhow::Result<Session> {
    let path = state.data_dir.join("sessions").join(format!("{id}.json"));
    let text = tokio::fs::read_to_string(path).await?;
    Ok(serde_json::from_str(&text)?)
}

async fn write_session(state: &AppState, s: &Session) -> anyhow::Result<()> {
    let dir = state.data_dir.join("sessions");
    tokio::fs::create_dir_all(&dir).await?;
    let path = dir.join(format!("{}.json", s.id));
    let text = serde_json::to_string_pretty(s)?;
    tokio::fs::write(path, text).await?;
    Ok(())
}

async fn execute(Json(req): Json<ExecuteRequest>) -> axum::response::Response {
    let mut vars = HashMap::<String, String>::new();
    for v in req.variables.iter() {
        vars.insert(v.name.clone(), v.value.clone());
    }

    let nodes = req
        .nodes
        .into_iter()
        .map(|n| EngineNode {
            id: n.id,
            label: n.label,
            kind: kind_from_string(&n.kind),
            content: n.content,
        })
        .collect::<Vec<_>>();

    let now = now_ms().to_string();
    let trace = render_with_trace(&nodes, &vars, req.output_style, &format!("run_{now}"), &now);
    (StatusCode::OK, Json(trace)).into_response()
}

async fn execute_preview(
    State(state): State<AppState>,
    Json(req): Json<ExecutePreviewRequest>,
) -> axum::response::Response {
    let mut vars = HashMap::<String, String>::new();
    let mut messages = Vec::<TraceMessage>::new();

    for v in req.variables.iter() {
        match resolve_variable_value(&state, v).await {
            Ok(value) => {
                vars.insert(v.name.clone(), value);
            }
            Err(err) => {
                vars.insert(v.name.clone(), format!("[{}]", v.name));
                messages.push(TraceMessage {
                    severity: TraceSeverity::Warn,
                    code: "variable_resolve_failed".to_string(),
                    message: format!("变量 {} 解析失败：{}", v.name, err),
                });
            }
        }
    }

    let nodes = req
        .nodes
        .into_iter()
        .map(|n| EngineNode {
            id: n.id,
            label: n.label,
            kind: kind_from_string(&n.kind),
            content: n.content,
        })
        .collect::<Vec<_>>();

    let now = now_ms().to_string();
    let mut trace = render_with_trace(&nodes, &vars, req.output_style, &format!("run_{now}"), &now);
    trace.messages.extend(messages);
    (StatusCode::OK, Json(trace)).into_response()
}

async fn resolve_variable_value(state: &AppState, v: &VariableSpec) -> anyhow::Result<String> {
    if v.r#type != "dynamic" {
        return Ok(v.value.clone());
    }

    let resolver = v.resolver.as_deref().unwrap_or("").trim();
    if resolver.starts_with("chat://") {
        let session_id = resolver.trim_start_matches("chat://");
        let max_messages = v.value.trim().parse::<usize>().unwrap_or(20);
        let s = load_session(state, session_id).await?;
        return Ok(render_session_as_text(&s, max_messages));
    }

    if resolver.starts_with("sql://") && !v.value.trim().is_empty() {
        let data_source_id = resolver.trim_start_matches("sql://");
        let url = decrypt_datasource_url(state, data_source_id).await?;
        return resolve_sql_value(&url, &v.value).await;
    }

    if resolver.starts_with("sqlite://") && !v.value.trim().is_empty() {
        return resolve_sql_value(resolver, &v.value).await;
    }

    if resolver.starts_with("neo4j://") && !v.value.trim().is_empty() {
        let data_source_id = resolver.trim_start_matches("neo4j://");
        return resolve_neo4j_value(state, data_source_id, &v.value).await;
    }

    if resolver.starts_with("milvus://") {
        let data_source_id = resolver.trim_start_matches("milvus://");
        return resolve_milvus_value(state, data_source_id, &v.value).await;
    }

    Ok(v.value.clone())
}

async fn resolve_sql_value(url: &str, query: &str) -> anyhow::Result<String> {
    let query = query.trim();
    let lower = query.to_ascii_lowercase();
    if !(lower.starts_with("select") || lower.starts_with("with")) {
        anyhow::bail!("readonly_required");
    }
    let rows = query_any_rows(url, query, 1).await?;
    Ok(rows
        .first()
        .and_then(|m| m.values().next())
        .map(|v| match v {
            serde_json::Value::Null => "".to_string(),
            serde_json::Value::Bool(b) => b.to_string(),
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        })
        .unwrap_or_default())
}

#[cfg(feature = "neo4j")]
async fn resolve_neo4j_value(
    state: &AppState,
    data_source_id: &str,
    cypher: &str,
) -> anyhow::Result<String> {
    use neo4rs::{query, Graph, Row as _};

    let cfg = decrypt_neo4j_config(state, data_source_id).await?;
    let graph = Graph::new(&cfg.uri, &cfg.username, &cfg.password)?;

    let cypher = cypher.trim();
    let (cypher, params) = if cypher.starts_with('{') {
        let json: serde_json::Value = serde_json::from_str(cypher)?;
        let cypher = json
            .get("cypher")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing_cypher"))?
            .to_string();
        let params = json
            .get("params")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        (cypher, params)
    } else {
        (cypher.to_string(), serde_json::Value::Null)
    };

    let mut q = query(&cypher);
    if let Some(obj) = params.as_object() {
        for (k, v) in obj {
            match v {
                serde_json::Value::Null => {}
                serde_json::Value::Bool(b) => {
                    q = q.param(k, *b);
                }
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        q = q.param(k, i);
                    } else if let Some(f) = n.as_f64() {
                        q = q.param(k, f);
                    }
                }
                serde_json::Value::String(s) => {
                    q = q.param(k, s.as_str());
                }
                other => {
                    q = q.param(k, other.to_string());
                }
            }
        }
    }

    let mut result = graph.execute(q).await?;
    let Some(row) = result.next().await? else {
        return Ok(String::new());
    };

    if let Ok(v) = row.get::<String>("value") {
        return Ok(v);
    }
    if let Ok(v) = row.get::<i64>("value") {
        return Ok(v.to_string());
    }
    if let Ok(v) = row.get::<f64>("value") {
        return Ok(v.to_string());
    }
    if let Ok(v) = row.get::<bool>("value") {
        return Ok(v.to_string());
    }

    Ok("<unprintable>".to_string())
}

#[cfg(not(feature = "neo4j"))]
async fn resolve_neo4j_value(
    _state: &AppState,
    _data_source_id: &str,
    _cypher: &str,
) -> anyhow::Result<String> {
    anyhow::bail!("feature_not_enabled")
}

#[cfg(feature = "milvus")]
async fn resolve_milvus_value(
    state: &AppState,
    data_source_id: &str,
    op: &str,
) -> anyhow::Result<String> {
    let cfg = decrypt_milvus_config(state, data_source_id).await?;
    let client = connectors::milvus::MilvusRestClient::new(cfg.base_url, cfg.token);

    let op = op.trim();
    if op.is_empty() || op.eq_ignore_ascii_case("list_collections") {
        let json = client.list_collections().await?;
        let names = json
            .get("data")
            .and_then(|v| v.get("collectionNames"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        return Ok(names);
    }

    if op.starts_with('{') {
        let mut json: serde_json::Value = serde_json::from_str(op)?;
        let op_name = json
            .get("op")
            .and_then(|v| v.as_str())
            .unwrap_or("list_collections");
        if op_name.eq_ignore_ascii_case("list_collections") {
            let json = client.list_collections().await?;
            let names = json
                .get("data")
                .and_then(|v| v.get("collectionNames"))
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            return Ok(names);
        }
        if op_name.eq_ignore_ascii_case("insert") {
            if let Some(obj) = json.as_object_mut() {
                obj.remove("op");
            }
            let resp = client.insert_entities(json).await?;
            if let Some(n) = resp
                .get("data")
                .and_then(|v| v.get("insertCount"))
                .and_then(|v| v.as_i64())
            {
                return Ok(n.to_string());
            }
            return Ok(resp.to_string());
        }
        if op_name.eq_ignore_ascii_case("search") {
            if let Some(obj) = json.as_object_mut() {
                obj.remove("op");
            }
            let resp = client.search_entities(json).await?;
            return Ok(resp.to_string());
        }
        if op_name.eq_ignore_ascii_case("query") {
            if let Some(obj) = json.as_object_mut() {
                obj.remove("op");
            }
            let resp = client.query_entities(json).await?;
            return Ok(resp.to_string());
        }
    }

    anyhow::bail!("unsupported_op")
}

#[cfg(not(feature = "milvus"))]
async fn resolve_milvus_value(
    _state: &AppState,
    _data_source_id: &str,
    _op: &str,
) -> anyhow::Result<String> {
    anyhow::bail!("feature_not_enabled")
}

fn kind_from_string(kind: &str) -> context_engine::NodeKind {
    match kind {
        "system" => context_engine::NodeKind::System,
        "user" => context_engine::NodeKind::User,
        "assistant" => context_engine::NodeKind::Assistant,
        "tool" => context_engine::NodeKind::Tool,
        "memory" => context_engine::NodeKind::Memory,
        "retrieval" => context_engine::NodeKind::Retrieval,
        _ => context_engine::NodeKind::Text,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SqlQueryRequest {
    url: Option<String>,
    data_source_id: Option<String>,
    query: String,
    row_limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SqlQueryResponse {
    value: String,
    rows: Vec<HashMap<String, serde_json::Value>>,
}

async fn sql_query(
    State(state): State<AppState>,
    Json(req): Json<SqlQueryRequest>,
) -> axum::response::Response {
    let query = req.query.trim();
    let lower = query.to_ascii_lowercase();
    if !(lower.starts_with("select") || lower.starts_with("with")) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "readonly_required",
                "message": "仅允许 SELECT/WITH 查询",
            })),
        )
            .into_response();
    }

    let limit = req.row_limit.unwrap_or(100).min(1000) as i64;
    let url = match (req.url, req.data_source_id) {
        (Some(url), _) => url,
        (None, Some(id)) => match decrypt_datasource_url(&state, &id).await {
            Ok(url) => url,
            Err(err) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "datasource_failed", "message": err.to_string() })),
                )
                    .into_response();
            }
        },
        (None, None) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "missing_url", "message": "url 或 dataSourceId 必须提供其一" })),
            )
                .into_response();
        }
    };
    let rows = match query_any_rows(&url, query, limit).await {
        Ok(rows) => rows,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "query_failed",
                    "message": err.to_string(),
                })),
            )
                .into_response();
        }
    };

    let value = rows
        .first()
        .and_then(|m| m.values().next())
        .map(|v| match v {
            serde_json::Value::Null => "".to_string(),
            serde_json::Value::Bool(b) => b.to_string(),
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        })
        .unwrap_or_default();

    (StatusCode::OK, Json(SqlQueryResponse { value, rows })).into_response()
}

async fn query_any_rows(
    url: &str,
    query: &str,
    limit: i64,
) -> anyhow::Result<Vec<HashMap<String, serde_json::Value>>> {
    use sqlx::{Column, Connection, Row};
    use tokio::time::{timeout, Duration};

    sqlx::any::install_default_drivers();
    let connect_timeout_ms = std::env::var("SQL_CONNECT_TIMEOUT_MS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(5_000);
    let query_timeout_ms = std::env::var("SQL_QUERY_TIMEOUT_MS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(10_000);

    let mut conn = timeout(
        Duration::from_millis(connect_timeout_ms),
        <sqlx::AnyConnection as Connection>::connect(url),
    )
    .await
    .map_err(|_| anyhow::anyhow!("connect_timeout"))??;
    let sql = format!("SELECT * FROM ({query}) AS t LIMIT {limit}");
    let mut out = Vec::new();

    let rows = timeout(
        Duration::from_millis(query_timeout_ms),
        sqlx::query(&sql).fetch_all(&mut conn),
    )
    .await
    .map_err(|_| anyhow::anyhow!("query_timeout"))??;
    for row in rows {
        let mut map = HashMap::<String, serde_json::Value>::new();
        for (idx, col) in row.columns().iter().enumerate() {
            let name = col.name().to_string();
            let value = any_row_value_to_json(&row, idx);
            map.insert(name, value);
        }
        out.push(map);
    }

    conn.close().await?;
    Ok(out)
}

async fn list_table_columns_for_url(url: &str, table: &str) -> anyhow::Result<Vec<ColumnInfo>> {
    sqlx::any::install_default_drivers();
    let mut out = Vec::<ColumnInfo>::new();

    if url.starts_with("sqlite:") {
        use sqlx::{Connection, Row as _};

        let mut conn = <sqlx::AnyConnection as Connection>::connect(url).await?;
        let sql = format!("PRAGMA table_info({table})");
        let rows = sqlx::query(&sql).fetch_all(&mut conn).await?;
        for row in rows {
            let name: String = row.try_get("name").unwrap_or_default();
            let data_type: String = row.try_get("type").unwrap_or_default();
            let notnull: i64 = row.try_get("notnull").unwrap_or(0);
            out.push(ColumnInfo {
                name,
                data_type,
                nullable: notnull == 0,
            });
        }
        conn.close().await?;
        return Ok(out);
    }

    if url.starts_with("postgres:") || url.starts_with("postgresql:") {
        use sqlx::{Connection, Row as _};

        let (schema, table) = split_table_name(table);
        let mut conn = <sqlx::AnyConnection as Connection>::connect(url).await?;
        let rows = sqlx::query(
            r#"
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
            "#,
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&mut conn)
        .await?;
        for row in rows {
            let name: String = row.try_get("column_name").unwrap_or_default();
            let data_type: String = row.try_get("data_type").unwrap_or_default();
            let is_nullable: String = row.try_get("is_nullable").unwrap_or_else(|_| "YES".into());
            out.push(ColumnInfo {
                name,
                data_type,
                nullable: is_nullable.eq_ignore_ascii_case("yes"),
            });
        }
        conn.close().await?;
        return Ok(out);
    }

    if url.starts_with("mysql:") {
        use sqlx::{Connection, Row as _};

        let (schema, table) = split_table_name(table);
        let mut conn = <sqlx::AnyConnection as Connection>::connect(url).await?;
        let rows = sqlx::query(
            r#"
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = COALESCE(?, DATABASE()) AND table_name = ?
            ORDER BY ordinal_position
            "#,
        )
        .bind(if schema == "public" {
            None::<String>
        } else {
            Some(schema)
        })
        .bind(table)
        .fetch_all(&mut conn)
        .await?;
        for row in rows {
            let name: String = row.try_get("column_name").unwrap_or_default();
            let data_type: String = row.try_get("data_type").unwrap_or_default();
            let is_nullable: String = row.try_get("is_nullable").unwrap_or_else(|_| "YES".into());
            out.push(ColumnInfo {
                name,
                data_type,
                nullable: is_nullable.eq_ignore_ascii_case("yes"),
            });
        }
        conn.close().await?;
        return Ok(out);
    }

    anyhow::bail!("unsupported_url")
}

fn split_table_name(input: &str) -> (String, String) {
    let mut parts = input.splitn(2, '.');
    let a = parts.next().unwrap_or("public").to_string();
    let b = parts.next();
    match b {
        Some(table) => (a, table.to_string()),
        None => ("public".to_string(), a),
    }
}

fn any_row_value_to_json(row: &sqlx::any::AnyRow, idx: usize) -> serde_json::Value {
    use sqlx::{Row, ValueRef};

    let Ok(raw) = row.try_get_raw(idx) else {
        return serde_json::Value::Null;
    };
    if raw.is_null() {
        return serde_json::Value::Null;
    }

    if let Ok(v) = row.try_get::<i64, _>(idx) {
        return serde_json::Value::Number(v.into());
    }
    if let Ok(v) = row.try_get::<f64, _>(idx) {
        if let Some(n) = serde_json::Number::from_f64(v) {
            return serde_json::Value::Number(n);
        }
    }
    if let Ok(v) = row.try_get::<bool, _>(idx) {
        return serde_json::Value::Bool(v);
    }
    if let Ok(v) = row.try_get::<String, _>(idx) {
        return serde_json::Value::String(v);
    }
    serde_json::Value::String("<unprintable>".to_string())
}

fn apply_security_headers(headers: &mut axum::http::HeaderMap) {
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("geolocation=(), microphone=(), camera=()"),
    );

    let csp = std::env::var("CONTENT_SECURITY_POLICY").ok();
    if let Some(csp) = csp {
        if let Ok(value) = HeaderValue::from_str(&csp) {
            headers.insert(header::CONTENT_SECURITY_POLICY, value);
        }
    }
}

fn apply_cache_headers(headers: &mut axum::http::HeaderMap, request_path: &str, is_fallback: bool) {
    if is_fallback || request_path == "/" || request_path.ends_with("/index.html") {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
        return;
    }

    if request_path.starts_with("/assets/") {
        headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
    } else {
        headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=3600"),
        );
    }
}

fn apply_wasm_content_type(headers: &mut axum::http::HeaderMap, request_path: &str) {
    if request_path.ends_with(".wasm") {
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/wasm"),
        );
    }
}
