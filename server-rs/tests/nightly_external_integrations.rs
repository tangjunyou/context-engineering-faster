#![cfg(any(feature = "neo4j", feature = "milvus"))]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt as _;
use tempfile::tempdir;
use tower::ServiceExt as _;

#[cfg(feature = "neo4j")]
#[tokio::test]
#[ignore]
async fn nightly_neo4j_resolver_works_end_to_end() {
    let uri = std::env::var("NEO4J_URI").unwrap_or_default();
    let user = std::env::var("NEO4J_USER").unwrap_or_default();
    let pass = std::env::var("NEO4J_PASS").unwrap_or_default();
    if uri.is_empty() || user.is_empty() || pass.is_empty() {
        return;
    }

    std::env::set_var("DATA_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");

    let dir = tempdir().unwrap();
    let data_dir = dir.path().join("data");
    let static_dir = dir.path().join("static");
    std::fs::create_dir_all(&static_dir).unwrap();
    std::fs::write(static_dir.join("index.html"), "INDEX").unwrap();
    let app = server_rs::build_app_with_data_dir(static_dir, data_dir);

    let body = serde_json::json!({
        "name": "neo4j-nightly",
        "driver": "neo4j",
        "url": uri,
        "username": user,
        "password": pass
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

    let body = serde_json::json!({
        "nodes": [
            { "id": "n1", "label": "System", "kind": "system", "content": "Neo4j: {{v}}" }
        ],
        "variables": [
            { "id": "v1", "name": "v", "type": "dynamic", "value": "{\"cypher\":\"RETURN $x AS value\",\"params\":{\"x\":\"ok\"}}", "resolver": format!("neo4j://{id}") }
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
    assert_eq!(json["text"], "Neo4j: ok");
}

#[cfg(feature = "milvus")]
#[tokio::test]
#[ignore]
async fn nightly_milvus_resolver_works_end_to_end() {
    let base_url = std::env::var("MILVUS_BASE_URL").unwrap_or_default();
    if base_url.is_empty() {
        return;
    }
    let token = std::env::var("MILVUS_TOKEN").unwrap_or_default();

    std::env::set_var("DATA_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");

    let dir = tempdir().unwrap();
    let data_dir = dir.path().join("data");
    let static_dir = dir.path().join("static");
    std::fs::create_dir_all(&static_dir).unwrap();
    std::fs::write(static_dir.join("index.html"), "INDEX").unwrap();
    let app = server_rs::build_app_with_data_dir(static_dir, data_dir);

    let body = serde_json::json!({
        "name": "milvus-nightly",
        "driver": "milvus",
        "url": base_url,
        "token": if token.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(token) }
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

    let body = serde_json::json!({
        "nodes": [
            { "id": "n1", "label": "System", "kind": "system", "content": "Milvus: {{v}}" }
        ],
        "variables": [
            { "id": "v1", "name": "v", "type": "dynamic", "value": "list_collections", "resolver": format!("milvus://{id}") }
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
    assert!(json["text"].as_str().unwrap().starts_with("Milvus: "));
}
