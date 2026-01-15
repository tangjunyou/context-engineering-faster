use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt as _;
use tempfile::tempdir;
use tower::ServiceExt as _;

#[tokio::test]
async fn sql_query_returns_first_cell_value_for_sqlite() {
    use sqlx::{Connection, Executor};

    let dir = tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), "INDEX").unwrap();

    let db_path = dir.path().join("test.db");
    std::fs::File::create(&db_path).unwrap();
    let url = sqlite_url(&db_path);

    sqlx::any::install_default_drivers();
    let mut conn = <sqlx::AnyConnection as Connection>::connect(&url)
        .await
        .unwrap();
    conn.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)")
        .await
        .unwrap();
    conn.execute("INSERT INTO items (name) VALUES ('Alice'), ('Bob')")
        .await
        .unwrap();
    conn.close().await.unwrap();

    let app = server_rs::build_app(dir.path().to_path_buf());

    let body = serde_json::json!({
        "url": url,
        "query": "SELECT name FROM items ORDER BY id",
        "rowLimit": 1
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
    assert_eq!(json["value"], "Alice");
    assert!(json["rows"].is_array());
}

fn sqlite_url(path: &std::path::Path) -> String {
    let p = path.to_string_lossy().replace('\\', "/");
    let p = p.strip_prefix('/').unwrap_or(p.as_str());
    format!("sqlite:///{p}")
}
