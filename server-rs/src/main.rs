use std::{net::SocketAddr, path::PathBuf};

use anyhow::Context as _;
use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt as _, util::SubscriberInitExt as _};

#[derive(Parser, Debug)]
struct Args {
    #[arg(long, env = "PORT", default_value = "3000")]
    port: u16,
    #[arg(long, env = "STATIC_DIR", default_value = "dist/public")]
    static_dir: PathBuf,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            "server_rs=info,tower_http=info,axum=info".to_string().into()
        }))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let args = Args::parse();
    let app = server_rs::build_app(args.static_dir.clone());

    let addr = SocketAddr::from(([0, 0, 0, 0], args.port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind to {addr}"))?;

    tracing::info!(%addr, static_dir = %args.static_dir.display(), "rust server listening");

    axum::serve(listener, app.into_make_service())
        .await
        .context("server exited")?;

    Ok(())
}
