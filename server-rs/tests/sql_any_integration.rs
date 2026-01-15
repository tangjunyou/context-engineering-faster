#[tokio::test]
async fn sql_any_connects_postgres_when_configured() {
    let Ok(url) = std::env::var("TEST_POSTGRES_URL") else {
        return;
    };
    server_rs::connectors::sql::test_connection(&url)
        .await
        .unwrap();
}

#[tokio::test]
async fn sql_any_connects_mysql_when_configured() {
    let Ok(url) = std::env::var("TEST_MYSQL_URL") else {
        return;
    };
    server_rs::connectors::sql::test_connection(&url).await.unwrap();
}

