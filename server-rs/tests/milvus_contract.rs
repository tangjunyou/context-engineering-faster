#![cfg(feature = "milvus")]

use std::io::{Read as _, Write as _};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

use server_rs::connectors::milvus::MilvusRestClient;

fn serve_one(response_body: &'static str) -> (String, Arc<Mutex<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let seen = Arc::new(Mutex::new(String::new()));
    let seen2 = seen.clone();
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buf = Vec::new();
        let mut tmp = [0u8; 4096];
        loop {
            let n = stream.read(&mut tmp).unwrap_or(0);
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&tmp[..n]);
            if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                break;
            }
        }
        let req = String::from_utf8_lossy(&buf).to_string();
        *seen2.lock().unwrap() = req;
        let body = response_body.as_bytes();
        let resp = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
            body.len(),
            response_body
        );
        let _ = stream.write_all(resp.as_bytes());
    });
    (format!("http://{}", addr), seen)
}

#[tokio::test]
async fn milvus_client_hits_expected_endpoints_and_headers() {
    let (base_url, seen) = serve_one(r#"{"code":0,"data":{"collectionNames":["a"]}}"#);
    let client = MilvusRestClient::new(base_url.clone(), Some("t".to_string()));
    let _ = client.list_collections().await.unwrap();
    let req = seen.lock().unwrap().clone();
    assert!(req.starts_with("POST /v2/vectordb/collections/list HTTP/1.1\r\n"));
    assert!(req.to_ascii_lowercase().contains("\r\nauthorization: bearer t\r\n"));

    let (base_url, seen) = serve_one(r#"{"code":0,"data":{"insertCount":1,"insertIds":[1]}}"#);
    let client = MilvusRestClient::new(base_url.clone(), Some("t".to_string()));
    let _ = client
        .insert_entities(serde_json::json!({"collectionName":"c","data":[{"id":1,"vector":[0.1]}]}))
        .await
        .unwrap();
    let req = seen.lock().unwrap().clone();
    assert!(req.starts_with("POST /v2/vectordb/entities/insert HTTP/1.1\r\n"));

    let (base_url, seen) = serve_one(r#"{"code":0,"data":[{"id":1,"distance":0.1}]}"#);
    let client = MilvusRestClient::new(base_url.clone(), Some("t".to_string()));
    let _ = client
        .search_entities(serde_json::json!({"collectionName":"c","data":[[0.1]],"annsField":"vector","limit":1}))
        .await
        .unwrap();
    let req = seen.lock().unwrap().clone();
    assert!(req.starts_with("POST /v2/vectordb/entities/search HTTP/1.1\r\n"));

    let (base_url, seen) = serve_one(r#"{"code":0,"data":[{"id":1}]}"#);
    let client = MilvusRestClient::new(base_url.clone(), Some("t".to_string()));
    let _ = client
        .query_entities(serde_json::json!({"collectionName":"c","filter":"id == 1","limit":1}))
        .await
        .unwrap();
    let req = seen.lock().unwrap().clone();
    assert!(req.starts_with("POST /v2/vectordb/entities/query HTTP/1.1\r\n"));
}

