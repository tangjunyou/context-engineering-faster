use std::{
    convert::Infallible,
    io::Write as _,
    path::{Component, PathBuf},
    sync::Arc,
};

use axum::{
    body::Body,
    http::{header, HeaderValue, Method, Request, StatusCode, Uri},
    response::IntoResponse,
    routing::get,
    Json,
    Router,
};
use flate2::{write::GzEncoder, Compression};
use tower::service_fn;
use tower_http::{
    compression::CompressionLayer,
    cors::{AllowOrigin, Any, CorsLayer},
    normalize_path::NormalizePathLayer,
    trace::TraceLayer,
};

pub fn build_app(static_dir: PathBuf) -> Router {
    let static_dir = Arc::new(static_dir);
    let index_file = Arc::new(static_dir.join("index.html"));

    let cors = cors_from_env();

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
                let mut response =
                    serve_file_bytes(target.as_ref(), accept_gzip && path_is_gzip_compressible(&request_path))
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
        .fallback(api_not_found)
        .layer(cors);

    Router::new()
        .nest("/api", api_router)
        .fallback_service(spa_static)
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

fn apply_cache_headers(
    headers: &mut axum::http::HeaderMap,
    request_path: &str,
    is_fallback: bool,
) {
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
