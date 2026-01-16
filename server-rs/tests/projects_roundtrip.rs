use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt as _;
use tempfile::tempdir;
use tower::ServiceExt as _;

#[tokio::test]
async fn project_create_list_get_and_upsert_roundtrip() {
    let dir = tempdir().unwrap();
    let data_dir = dir.path().join("data");
    let static_dir = dir.path().join("static");
    std::fs::create_dir_all(&static_dir).unwrap();
    std::fs::write(static_dir.join("index.html"), "INDEX").unwrap();

    let app = server_rs::build_app_with_data_dir(static_dir, data_dir);

    let body = serde_json::json!({
        "name": "p1",
        "state": {
            "nodes": [
                { "id": "n1", "type": "contextNode", "position": { "x": 1, "y": 2 }, "data": { "label": "A", "type": "system_prompt", "content": "hi", "variables": [] } }
            ],
            "edges": [
                { "id": "e1-2", "source": "n1", "target": "n2", "animated": true }
            ],
            "variables": [
                { "id": "v1", "name": "language", "type": "static", "value": "zh" },
                { "id": "v2", "name": "history", "type": "dynamic", "value": "20", "resolver": "chat://s_1" }
            ]
        }
    })
    .to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/projects")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let created: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let project_id = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["name"], "p1");
    assert!(created["state"]["nodes"].is_array());
    assert!(created["state"]["edges"].is_array());
    assert!(created["state"]["variables"].is_array());

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/projects")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let list: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(list
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p["id"] == project_id));
    let first = list
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == project_id)
        .unwrap();
    assert!(first.get("updatedAt").is_some());
    assert!(first.get("state").is_none());

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/projects/{project_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let fetched: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(fetched["id"], project_id);
    assert_eq!(fetched["state"]["variables"][1]["resolver"], "chat://s_1");

    let body = serde_json::json!({
        "name": "p1-updated",
        "state": {
            "nodes": [],
            "edges": [],
            "variables": []
        }
    })
    .to_string();

    let response = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/projects/{project_id}"))
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let updated: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(updated["id"], project_id);
    assert_eq!(updated["name"], "p1-updated");
    assert_eq!(updated["state"]["nodes"].as_array().unwrap().len(), 0);
}
