use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt as _;
use tempfile::tempdir;
use tower::ServiceExt as _;

#[tokio::test]
async fn neo4j_datasource_is_feature_gated_but_api_contract_is_stable() {
    std::env::set_var("DATA_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");

    let dir = tempdir().unwrap();
    let data_dir = dir.path().join("data");
    let static_dir = dir.path().join("static");
    std::fs::create_dir_all(&static_dir).unwrap();
    std::fs::write(static_dir.join("index.html"), "INDEX").unwrap();

    let app = server_rs::build_app_with_data_dir(static_dir, data_dir);

    let body = serde_json::json!({
        "name": "neo4j-demo",
        "driver": "neo4j",
        "url": "bolt://localhost:7687",
        "username": "neo4j",
        "password": "pass"
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
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["error"], "connect_failed");

    let body = serde_json::json!({
        "nodes": [
            { "id": "n1", "label": "System", "kind": "system", "content": "Neo4j: {{v}}" }
        ],
        "variables": [
            { "id": "v1", "name": "v", "type": "dynamic", "value": "RETURN 1 AS value", "resolver": format!("neo4j://{id}") }
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
    assert_eq!(json["text"], "Neo4j: [v]");
    assert_eq!(json["messages"][0]["code"], "variable_resolve_failed");
}

