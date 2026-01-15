use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt as _;
use tempfile::tempdir;
use tower::ServiceExt as _;

#[tokio::test]
async fn datasource_query_and_tables_work_for_sqlite() {
    use sqlx::{Connection, Executor};

    std::env::set_var("DATA_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");

    let dir = tempdir().unwrap();
    let data_dir = dir.path().join("data");
    let static_dir = dir.path().join("static");
    std::fs::create_dir_all(&static_dir).unwrap();
    std::fs::write(static_dir.join("index.html"), "INDEX").unwrap();

    let db_path = dir.path().join("test.db");
    std::fs::File::create(&db_path).unwrap();
    let url = format!("sqlite://{}", db_path.display());

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
    assert_eq!(json["url"], "<redacted>");
    let id = json["id"].as_str().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/datasources/{id}/test"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/datasources/{id}/tables"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(json["tables"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v.as_str() == Some("items")));

    let body = serde_json::json!({
        "dataSourceId": id,
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
}
