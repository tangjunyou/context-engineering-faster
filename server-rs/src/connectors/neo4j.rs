#[cfg(feature = "neo4j")]
pub async fn test_connection(uri: &str, user: &str, pass: &str) -> anyhow::Result<()> {
    use neo4rs::{query, Graph};

    let graph = Graph::new(uri, user, pass)?;
    let mut result = graph.execute(query("RETURN 1")).await?;
    let _ = result.next().await?;
    Ok(())
}

#[cfg(not(feature = "neo4j"))]
pub async fn test_connection(_uri: &str, _user: &str, _pass: &str) -> anyhow::Result<()> {
    Err(anyhow::anyhow!("neo4j feature 未启用"))
}
