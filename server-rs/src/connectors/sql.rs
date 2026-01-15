use anyhow::Context as _;
use sqlx::Connection;

pub async fn test_connection(url: &str) -> anyhow::Result<()> {
    sqlx::any::install_default_drivers();
    let conn = <sqlx::AnyConnection as Connection>::connect(url)
        .await
        .with_context(|| "failed to connect")?;
    conn.close().await.with_context(|| "failed to close")?;
    Ok(())
}
