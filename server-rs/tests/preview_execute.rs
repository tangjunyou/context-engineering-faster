use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt as _;
use tempfile::tempdir;
use tower::ServiceExt as _;

#[tokio::test]
async fn preview_exec_resolves_chat_and_sql_variables_server_side() {
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
    conn.execute("INSERT INTO items (name) VALUES ('Alice'), ('Bob')")
        .await
        .unwrap();
    conn.close().await.unwrap();

    let app = server_rs::build_app_with_data_dir(static_dir, data_dir);

    let body = serde_json::json!({ "name": "demo" }).to_string();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/sessions")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let session_id = json["id"].as_str().unwrap().to_string();

    let body = serde_json::json!({
        "messages": [
            { "role": "user", "content": "Hello", "createdAt": "1" },
            { "role": "assistant", "content": "World", "createdAt": "2" }
        ]
    })
    .to_string();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/sessions/{session_id}/messages"))
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

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
    let ds_id = json["id"].as_str().unwrap().to_string();

    let body = serde_json::json!({
        "nodes": [
            { "id": "n1", "label": "System", "kind": "system", "content": "Chat:\\n{{chat}}\\nName: {{name}}" }
        ],
        "variables": [
            { "id": "v1", "name": "chat", "type": "dynamic", "value": "20", "resolver": format!("chat://{session_id}") },
            { "id": "v2", "name": "name", "type": "dynamic", "value": "SELECT name FROM items ORDER BY id", "resolver": format!("sql://{ds_id}") }
        ],
        "outputStyle": "plain"
    })
    .to_string();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/preview")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(json["text"].as_str().unwrap().contains("[User]: Hello"));
    assert!(json["text"]
        .as_str()
        .unwrap()
        .contains("[Assistant]: World"));
    assert!(json["text"].as_str().unwrap().contains("Name: Alice"));
}

fn sqlite_url(path: &std::path::Path) -> String {
    let p = path.to_string_lossy().replace('\\', "/");
    let p = p.strip_prefix('/').unwrap_or(p.as_str());
    format!("sqlite:///{p}")
}
