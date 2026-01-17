#[tokio::test]
async fn sql_preview_rows_works_for_postgres_when_configured() {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use http_body_util::BodyExt as _;
    use sqlx::{Connection, Executor};
    use tempfile::tempdir;
    use tower::ServiceExt as _;

    let Ok(url) = std::env::var("TEST_POSTGRES_URL") else {
        return;
    };

    sqlx::any::install_default_drivers();
    let table = format!("ceviz_items_{}", now_ms());
    let mut conn = <sqlx::AnyConnection as Connection>::connect(&url)
        .await
        .unwrap();
    conn.execute(format!("DROP TABLE IF EXISTS {table}").as_str())
        .await
        .unwrap();
    conn.execute(format!("CREATE TABLE {table} (id INT PRIMARY KEY, name TEXT)").as_str())
        .await
        .unwrap();
    conn.execute(format!("INSERT INTO {table} (id, name) VALUES (1, 'Alice')").as_str())
        .await
        .unwrap();
    conn.close().await.unwrap();

    std::env::set_var("DATA_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");

    let dir = tempdir().unwrap();
    let data_dir = dir.path().join("data");
    let static_dir = dir.path().join("static");
    std::fs::create_dir_all(&static_dir).unwrap();
    std::fs::write(static_dir.join("index.html"), "INDEX").unwrap();
    let app = server_rs::build_app_with_data_dir(static_dir, data_dir);

    let body = serde_json::json!({
        "name": "pg",
        "driver": "postgres",
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
                    "/api/datasources/{id}/tables/{table}/preview?limit=5"
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
    assert!(!rows.is_empty());
}

#[tokio::test]
async fn sql_preview_rows_works_for_mysql_when_configured() {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use http_body_util::BodyExt as _;
    use sqlx::{Connection, Executor};
    use tempfile::tempdir;
    use tower::ServiceExt as _;

    let Ok(url) = std::env::var("TEST_MYSQL_URL") else {
        return;
    };

    sqlx::any::install_default_drivers();
    let table = format!("ceviz_items_{}", now_ms());
    let mut conn = <sqlx::AnyConnection as Connection>::connect(&url)
        .await
        .unwrap();
    conn.execute(format!("DROP TABLE IF EXISTS {table}").as_str())
        .await
        .unwrap();
    conn.execute(format!("CREATE TABLE {table} (id INT PRIMARY KEY, name TEXT)").as_str())
        .await
        .unwrap();
    conn.execute(format!("INSERT INTO {table} (id, name) VALUES (1, 'Alice')").as_str())
        .await
        .unwrap();
    conn.close().await.unwrap();

    std::env::set_var("DATA_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");

    let dir = tempdir().unwrap();
    let data_dir = dir.path().join("data");
    let static_dir = dir.path().join("static");
    std::fs::create_dir_all(&static_dir).unwrap();
    std::fs::write(static_dir.join("index.html"), "INDEX").unwrap();
    let app = server_rs::build_app_with_data_dir(static_dir, data_dir);

    let body = serde_json::json!({
        "name": "mysql",
        "driver": "mysql",
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
                    "/api/datasources/{id}/tables/{table}/preview?limit=5"
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
    assert!(!rows.is_empty());
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}
