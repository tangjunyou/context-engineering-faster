use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt as _;
use tempfile::tempdir;
use tower::ServiceExt as _;

#[tokio::test]
async fn datasource_capabilities_contract_is_stable_for_sqlite_and_milvus() {
    use sqlx::{Connection, Executor};

    std::env::set_var("DATA_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");

    let dir = tempdir().unwrap();
    let data_dir = dir.path().join("data");
    let static_dir = dir.path().join("static");
    std::fs::create_dir_all(&static_dir).unwrap();
    std::fs::write(static_dir.join("index.html"), "INDEX").unwrap();

    let db_path = dir.path().join("caps.db");
    std::fs::File::create(&db_path).unwrap();
    let url = sqlite_url(&db_path);

    sqlx::any::install_default_drivers();
    let mut conn = <sqlx::AnyConnection as Connection>::connect(&url)
        .await
        .unwrap();
    conn.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)")
        .await
        .unwrap();
    conn.close().await.unwrap();

    let app = server_rs::build_app_with_data_dir(static_dir, data_dir);

    let body = serde_json::json!({
        "name": "sqlite-demo",
        "driver": "sqlite",
        "url": url,
        "allowImport": true,
        "allowWrite": false,
        "allowSchema": true,
        "allowDelete": false
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
    let sqlite_id = json["id"].as_str().unwrap().to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/datasources/{sqlite_id}/capabilities"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["id"], sqlite_id);
    assert_eq!(json["driver"], "sqlite");
    assert_eq!(json["resolver"], format!("sql://{sqlite_id}"));
    assert_eq!(json["allowImport"], true);
    assert_eq!(json["allowWrite"], false);
    assert_eq!(json["allowSchema"], true);
    assert_eq!(json["allowDelete"], false);
    assert_eq!(json["supportsTables"], true);
    assert_eq!(json["supportsColumns"], true);
    assert_eq!(json["supportsSqlQuery"], true);
    assert_eq!(json["supportsCsvImport"], true);
    assert_eq!(json["supportsSqliteRowsApi"], true);
    assert_eq!(json["supportsMilvusCollections"], false);
    assert_eq!(json["supportsMilvusOps"], false);

    let body = serde_json::json!({
        "name": "milvus-demo",
        "driver": "milvus",
        "url": "http://localhost:19530",
        "token": "root:Milvus"
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
    let milvus_id = json["id"].as_str().unwrap().to_string();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/datasources/{milvus_id}/capabilities"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["id"], milvus_id);
    assert_eq!(json["driver"], "milvus");
    assert_eq!(json["resolver"], format!("milvus://{milvus_id}"));
    assert_eq!(json["supportsTables"], false);
    assert_eq!(json["supportsColumns"], false);
    assert_eq!(json["supportsSqlQuery"], false);
    assert_eq!(json["supportsCsvImport"], false);
    assert_eq!(json["supportsSqliteRowsApi"], false);
    assert_eq!(json["supportsMilvusCollections"], true);
    assert_eq!(json["supportsMilvusOps"], true);
}

fn sqlite_url(path: &std::path::Path) -> String {
    let p = path.to_string_lossy().replace('\\', "/");
    format!("sqlite:///{p}")
}
