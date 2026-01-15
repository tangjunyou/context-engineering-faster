use std::fs;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt as _;
use tempfile::tempdir;
use tower::ServiceExt as _;

#[tokio::test]
async fn serves_existing_static_file() {
    let dir = tempdir().unwrap();
    fs::create_dir_all(dir.path().join("assets")).unwrap();
    fs::write(dir.path().join("index.html"), "INDEX").unwrap();
    fs::write(dir.path().join("assets/app.js"), "APP").unwrap();

    let app = server_rs::build_app(dir.path().to_path_buf());

    let response = app
        .oneshot(Request::builder().uri("/assets/app.js").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&bytes[..], b"APP");
}

#[tokio::test]
async fn falls_back_to_index_for_unknown_routes() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("index.html"), "INDEX").unwrap();

    let app = server_rs::build_app(dir.path().to_path_buf());

    for uri in ["/", "/some/route", "/deep/nested/route"] {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&bytes[..], b"INDEX");
    }
}

