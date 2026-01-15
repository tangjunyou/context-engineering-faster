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
        .route("/sessions", get(list_sessions).post(create_session))
        .route("/sessions/{id}", get(get_session))
        .route("/sessions/{id}/messages", post(append_messages))
        .route("/sessions/{id}/render", post(render_session))
        .route("/preview", post(execute_preview))
        .route("/execute", post(execute))
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
struct Project {
    id: String,
    name: String,
    nodes: Vec<ProjectNode>,
    variables: Vec<Variable>,
    updated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProjectRequest {
    name: String,
    nodes: Vec<ProjectNode>,
    variables: Vec<Variable>,
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
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataSourcePublic {
    id: String,
    name: String,
    driver: String,
    url: String,
    updated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataSourceStored {
    id: String,
    name: String,
    driver: String,
    url_enc: String,
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
            updated_at: stored.updated_at,
        }),
    )
        .into_response()
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
    } = req;

    if let Some(name) = name {
        stored.name = name;
    }
    if let Some(driver) = driver {
        stored.driver = driver;
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
            updated_at: stored.updated_at,
        }),
    )
        .into_response()
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
    let mut out = Vec::<Project>::new();

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
            if let Ok(p) = serde_json::from_str::<Project>(&text) {
                out.push(p);
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

    match serde_json::from_str::<Project>(&text) {
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
    let p = Project {
        id: id.clone(),
        name: req.name,
        nodes: req.nodes,
        variables: req.variables,
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
    Json(mut p): Json<Project>,
) -> axum::response::Response {
    p.id = id.clone();
    p.updated_at = now_ms().to_string();

    if let Err(err) = write_project(&state, &p).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "detail": err.to_string() })),
        )
            .into_response();
    }

    (StatusCode::OK, Json(p)).into_response()
}

async fn write_project(state: &AppState, p: &Project) -> anyhow::Result<()> {
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
    let mut out = Vec::<Session>::new();

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
                out.push(s);
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
