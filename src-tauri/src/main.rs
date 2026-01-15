use std::io::{Read as _, Write as _};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine as _;
use rand::rngs::OsRng;
use rand::RngCore;
use tauri::webview::WebviewWindowBuilder;
use tauri::{Manager as _, WebviewUrl, WindowEvent};
use tauri_plugin_shell::ShellExt as _;

struct SidecarState(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

impl SidecarState {
    fn take(&self) -> Option<tauri_plugin_shell::process::CommandChild> {
        self.0.lock().ok().and_then(|mut g| g.take())
    }

    fn set(&self, child: tauri_plugin_shell::process::CommandChild) {
        if let Ok(mut g) = self.0.lock() {
            *g = Some(child);
        }
    }
}

fn wait_for_healthz(port: u16, timeout: Duration) -> std::io::Result<()> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if let Ok(mut stream) = TcpStream::connect_timeout(
            &format!("127.0.0.1:{port}").parse().unwrap(),
            Duration::from_millis(200),
        ) {
            stream.set_read_timeout(Some(Duration::from_millis(300)))?;
            stream.set_write_timeout(Some(Duration::from_millis(300)))?;
            stream.write_all(
                b"GET /api/healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
            )?;
            let mut buf = [0u8; 256];
            let n = stream.read(&mut buf).unwrap_or(0);
            let head = String::from_utf8_lossy(&buf[..n]);
            if head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200") {
                return Ok(());
            }
        }
        std::thread::sleep(Duration::from_millis(120));
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        "healthz_not_ready",
    ))
}

fn main() {
    tauri::Builder::default()
        .manage(SidecarState(Mutex::new(None)))
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let listener = TcpListener::bind("127.0.0.1:0")?;
            let port = listener.local_addr()?.port();
            drop(listener);

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let key_path = data_dir.join("data_key.b64");
            let data_key = if key_path.is_file() {
                std::fs::read_to_string(&key_path)?.trim().to_string()
            } else {
                let mut buf = [0u8; 32];
                OsRng.fill_bytes(&mut buf);
                let s = base64::engine::general_purpose::STANDARD.encode(buf);
                std::fs::write(&key_path, format!("{s}\n"))?;
                s
            };

            let resource_dir = app.path().resource_dir()?;
            let static_dir = resource_dir.join("public");

            let port_s = port.to_string();
            let static_dir_s = static_dir.to_string_lossy().to_string();
            let data_dir_s = data_dir.to_string_lossy().to_string();

            let sidecar = app
                .shell()
                .sidecar("server-rs")?
                .args(["--port", &port_s, "--static-dir", &static_dir_s])
                .env("DATA_DIR", data_dir_s)
                .env("DATA_KEY", data_key);
            let (_rx, child) = sidecar.spawn()?;
            app.state::<SidecarState>().set(child);

            wait_for_healthz(port, Duration::from_secs(8))?;

            let url = format!("http://127.0.0.1:{port}/").parse()?;
            WebviewWindowBuilder::new(app, "main".to_string(), WebviewUrl::External(url))
                .title("ContextArchitect")
                .build()?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle().clone();
                let window = window.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(child) = app.state::<SidecarState>().take() {
                        let _ = child.kill();
                    }
                    let _ = window.close();
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
