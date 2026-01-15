use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt as _;
use tempfile::tempdir;
use tower::ServiceExt as _;

#[tokio::test]
async fn sql_query_rejects_non_select() {
    let dir = tempdir().unwrap();
    let data_dir = dir.path().join("data");
    let static_dir = dir.path().join("static");
    std::fs::create_dir_all(&static_dir).unwrap();
    std::fs::write(static_dir.join("index.html"), "INDEX").unwrap();

    let app = server_rs::build_app_with_data_dir(static_dir, data_dir);

    let body = serde_json::json!({
        "url": "sqlite:///:memory:",
        "query": "DELETE FROM items"
    })
    .to_string();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/sql/query")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["error"], "readonly_required");
}

#[tokio::test]
async fn sql_query_row_limit_is_clamped() {
    use sqlx::{Connection, Executor};

    let dir = tempdir().unwrap();
    let data_dir = dir.path().join("data");
    let static_dir = dir.path().join("static");
    std::fs::create_dir_all(&static_dir).unwrap();
    std::fs::write(static_dir.join("index.html"), "INDEX").unwrap();

    let db_path = dir.path().join("limit.db");
    std::fs::File::create(&db_path).unwrap();
    let url = sqlite_url(&db_path);

    sqlx::any::install_default_drivers();
    let mut conn = <sqlx::AnyConnection as Connection>::connect(&url)
        .await
        .unwrap();
    conn.execute("CREATE TABLE items (id INTEGER PRIMARY KEY)")
        .await
        .unwrap();
    for i in 1..=1100 {
        conn.execute(format!("INSERT INTO items (id) VALUES ({i})").as_str())
            .await
            .unwrap();
    }
    conn.close().await.unwrap();

    let app = server_rs::build_app_with_data_dir(static_dir, data_dir);

    let body = serde_json::json!({
        "url": url,
        "query": "SELECT id FROM items ORDER BY id",
        "rowLimit": 999999
    })
    .to_string();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/sql/query")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["rows"].as_array().unwrap().len(), 1000);
    assert_eq!(json["value"], "1");
}

#[tokio::test]
async fn datasource_get_redacts_url() {
    std::env::set_var("DATA_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");

    let dir = tempdir().unwrap();
    let data_dir = dir.path().join("data");
    let static_dir = dir.path().join("static");
    std::fs::create_dir_all(&static_dir).unwrap();
    std::fs::write(static_dir.join("index.html"), "INDEX").unwrap();

    let db_path = dir.path().join("ds.db");
    std::fs::File::create(&db_path).unwrap();
    let url = sqlite_url(&db_path);

    let app = server_rs::build_app_with_data_dir(static_dir, data_dir);

    let body = serde_json::json!({
        "name": "sqlite-demo",
        "driver": "sqlite",
        "url": url
    })
    .to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/datasources")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let id = json["id"].as_str().unwrap();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/datasources/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["url"], "<redacted>");
}

#[tokio::test]
async fn static_responses_include_security_headers() {
    let dir = tempdir().unwrap();
    let data_dir = dir.path().join("data");
    let static_dir = dir.path().join("static");
    std::fs::create_dir_all(&static_dir).unwrap();
    std::fs::write(static_dir.join("index.html"), "INDEX").unwrap();

    let app = server_rs::build_app_with_data_dir(static_dir, data_dir);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let headers = response.headers();
    assert_eq!(headers.get("x-content-type-options").unwrap(), "nosniff");
    assert_eq!(headers.get("x-frame-options").unwrap(), "DENY");
    assert_eq!(headers.get("referrer-policy").unwrap(), "no-referrer");
    assert!(headers.get("permissions-policy").is_some());
}

fn sqlite_url(path: &std::path::Path) -> String {
    let p = path.to_string_lossy().replace('\\', "/");
    let p = p.strip_prefix('/').unwrap_or(p.as_str());
    format!("sqlite:///{p}")
}

