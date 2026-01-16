use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt as _;
use tempfile::tempdir;
use tower::ServiceExt as _;

#[tokio::test]
async fn dataset_replay_creates_runs_and_is_stable() {
    std::env::set_var("DATA_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");

    let dir = tempdir().unwrap();
    let data_dir = dir.path().join("data");
    let static_dir = dir.path().join("static");
    std::fs::create_dir_all(&static_dir).unwrap();
    std::fs::write(static_dir.join("index.html"), "INDEX").unwrap();

    let app = server_rs::build_app_with_data_dir(static_dir, data_dir);

    let create_project_body = serde_json::json!({
        "name": "Replay Project",
        "state": {
            "nodes": [
                {
                    "id": "n1",
                    "type": "contextNode",
                    "position": { "x": 0, "y": 0 },
                    "data": { "label": "System", "type": "system_prompt", "content": "Hello {{name}}", "variables": ["v1"] }
                }
            ],
            "edges": [],
            "variables": [
                { "id": "v1", "name": "name", "type": "static", "value": "World", "description": "", "source": "" }
            ]
        }
    })
    .to_string();
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/projects")
                .header("content-type", "application/json")
                .body(Body::from(create_project_body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(resp.status().is_success());
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let project: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let project_id = project["id"].as_str().unwrap().to_string();

    let create_dataset_body = serde_json::json!({
        "name": "Replay Dataset",
        "rows": [
            { "name": "Alice" },
            { "name": "Bob" }
        ]
    })
    .to_string();
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/datasets")
                .header("content-type", "application/json")
                .body(Body::from(create_dataset_body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(resp.status().is_success());
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let dataset: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let dataset_id = dataset["id"].as_str().unwrap().to_string();

    let replay_body = serde_json::json!({
        "projectId": project_id,
        "limit": 2
    })
    .to_string();
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/datasets/{dataset_id}/replay"))
                .header("content-type", "application/json")
                .body(Body::from(replay_body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let summaries: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let arr = summaries.as_array().unwrap();
    assert_eq!(arr.len(), 2);
    assert!(arr[0]["runId"].as_str().unwrap().starts_with("run_"));
    assert_eq!(arr[0]["rowIndex"].as_u64().unwrap(), 0);

    let run_id_0 = arr[0]["runId"].as_str().unwrap().to_string();
    let digest_0 = arr[0]["outputDigest"].as_str().unwrap().to_string();

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/runs/{run_id_0}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let run0: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let text0 = run0["trace"]["text"].as_str().unwrap_or_default();
    assert!(text0.contains("Alice"));

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/datasets/{dataset_id}/runs"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let listed: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(listed.as_array().unwrap().len() >= 2);

    let replay_body = serde_json::json!({
        "projectId": project["id"],
        "limit": 2
    })
    .to_string();
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/datasets/{dataset_id}/replay"))
                .header("content-type", "application/json")
                .body(Body::from(replay_body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let summaries2: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let arr2 = summaries2.as_array().unwrap();
    assert_eq!(arr2.len(), 2);
    assert_eq!(arr2[0]["rowIndex"].as_u64().unwrap(), 0);
    assert_eq!(arr2[0]["outputDigest"].as_str().unwrap(), digest_0);

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/api/datasets/{dataset_id}/runs?rowIndex=0&limit=200"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let listed0: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let arr = listed0.as_array().unwrap();
    assert!(arr.len() >= 2);
    assert!(arr.iter().all(|x| x["rowIndex"].as_u64().unwrap() == 0));
    let t0 = arr[0]["createdAt"]
        .as_str()
        .unwrap()
        .parse::<u64>()
        .unwrap();
    let t1 = arr[1]["createdAt"]
        .as_str()
        .unwrap()
        .parse::<u64>()
        .unwrap();
    assert!(t0 >= t1);
}
