use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt as _;
use tempfile::tempdir;
use tower::ServiceExt as _;

#[tokio::test]
async fn previews_rows_from_sqlite_table_with_limit() {
    use sqlx::{Connection, Executor};

    std::env::set_var("DATA_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");

    let dir = tempdir().unwrap();
    let data_dir = dir.path().join("data");
    let static_dir = dir.path().join("static");
    std::fs::create_dir_all(&static_dir).unwrap();
    std::fs::write(static_dir.join("index.html"), "INDEX").unwrap();

    let db_path = dir.path().join("preview.db");
    std::fs::File::create(&db_path).unwrap();
    let url = sqlite_url(&db_path);

    sqlx::any::install_default_drivers();
    let mut conn = <sqlx::AnyConnection as Connection>::connect(&url)
        .await
        .unwrap();
    conn.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)")
        .await
        .unwrap();
    conn.execute("INSERT INTO items (id, name) VALUES (1, 'Alice')")
        .await
        .unwrap();
    conn.execute("INSERT INTO items (id, name) VALUES (2, 'Bob')")
        .await
        .unwrap();
    conn.execute("INSERT INTO items (id, name) VALUES (3, 'Carol')")
        .await
        .unwrap();
    conn.close().await.unwrap();

    let app = server_rs::build_app_with_data_dir(static_dir, data_dir);

    let body = serde_json::json!({
        "name": "sqlite-preview",
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
    let id = json["id"].as_str().unwrap().to_string();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/api/datasources/{id}/tables/items/preview?limit=2"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let rows = json["rows"].as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows[0].get("id").is_some());
    assert!(rows[0].get("name").is_some());
}

fn sqlite_url(path: &std::path::Path) -> String {
    let p = path.to_string_lossy().replace('\\', "/");
    format!("sqlite:///{p}")
}

