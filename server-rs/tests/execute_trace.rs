use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt as _;
use tempfile::tempdir;
use tower::ServiceExt as _;

#[tokio::test]
async fn execute_returns_stable_trace_segments() {
    let dir = tempdir().unwrap();
    let data_dir = dir.path().join("data");
    let static_dir = dir.path().join("static");
    std::fs::create_dir_all(&static_dir).unwrap();
    std::fs::write(static_dir.join("index.html"), "INDEX").unwrap();

    let app = server_rs::build_app_with_data_dir(static_dir, data_dir);

    let body = serde_json::json!({
        "nodes": [
            { "id": "n1", "label": "System", "kind": "system", "content": "Hello {{name}}" },
            { "id": "n2", "label": "User", "kind": "user", "content": "I am {{name}}." },
            { "id": "n3", "label": "Tool", "kind": "tool", "content": "Tool sees {{missing}}." }
        ],
        "variables": [
            { "id": "v1", "name": "name", "value": "Alice" }
        ],
        "outputStyle": "labeled"
    })
    .to_string();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/execute")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(json["outputStyle"], "labeled");
    assert_eq!(json["segments"].as_array().unwrap().len(), 3);

    assert_eq!(json["segments"][0]["label"], "System");
    assert_eq!(json["segments"][0]["template"], "Hello {{name}}");
    assert_eq!(
        json["segments"][0]["rendered"],
        "--- System ---\nHello Alice"
    );
    assert_eq!(
        json["segments"][0]["missingVariables"]
            .as_array()
            .unwrap()
            .len(),
        0
    );

    assert_eq!(json["segments"][1]["label"], "User");
    assert_eq!(json["segments"][1]["rendered"], "--- User ---\nI am Alice.");

    assert_eq!(json["segments"][2]["label"], "Tool");
    assert_eq!(
        json["segments"][2]["rendered"],
        "--- Tool ---\nTool sees {{missing}}."
    );
    assert_eq!(
        json["segments"][2]["missingVariables"].as_array().unwrap(),
        &vec![serde_json::Value::String("missing".to_string())]
    );
    assert_eq!(
        json["segments"][2]["messages"][0]["code"],
        "missing_variable"
    );
}
