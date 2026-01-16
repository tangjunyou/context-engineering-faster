use std::{collections::HashMap, path::PathBuf};

use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};

use crate::{is_safe_identifier, now_ms, AppState};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorCollection {
    name: String,
    dimension: u32,
    distance: String,
    created_at: String,
}

fn vector_base_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("vector")
}

pub(super) async fn list_vector_collections(
    State(state): State<AppState>,
) -> axum::response::Response {
    let dir = vector_base_dir(&state).join("collections");
    let mut out = Vec::<VectorCollection>::new();
    let mut rd = match tokio::fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(_) => {
            return (StatusCode::OK, Json(out)).into_response();
        }
    };
    while let Ok(Some(entry)) = rd.next_entry().await {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Ok(text) = tokio::fs::read_to_string(&path).await {
            if let Ok(c) = serde_json::from_str::<VectorCollection>(&text) {
                out.push(c);
            }
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    (StatusCode::OK, Json(out)).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreateVectorCollectionRequest {
    name: String,
    dimension: u32,
    distance: String,
}

pub(super) async fn create_vector_collection(
    State(state): State<AppState>,
    Json(req): Json<CreateVectorCollectionRequest>,
) -> axum::response::Response {
    if !is_safe_identifier(&req.name) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_collection" })),
        )
            .into_response();
    }
    if req.dimension == 0 || req.dimension > 4096 {
        return (
            StatusCode::BAD_REQUEST,
            Json(
                serde_json::json!({ "error": "validation_failed", "message": "invalid_dimension" }),
            ),
        )
            .into_response();
    }
    let distance = req.distance.trim().to_ascii_lowercase();
    if distance != "cosine" {
        return (
            StatusCode::BAD_REQUEST,
            Json(
                serde_json::json!({ "error": "validation_failed", "message": "unsupported_distance" }),
            ),
        )
            .into_response();
    }

    let base = vector_base_dir(&state);
    let col_dir = base.join("collections");
    let points_dir = base.join("points");
    if tokio::fs::create_dir_all(&col_dir).await.is_err()
        || tokio::fs::create_dir_all(&points_dir).await.is_err()
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed" })),
        )
            .into_response();
    }

    let meta = VectorCollection {
        name: req.name.clone(),
        dimension: req.dimension,
        distance: distance.to_string(),
        created_at: now_ms().to_string(),
    };
    let path = col_dir.join(format!("{}.json", req.name));
    let text = match serde_json::to_string_pretty(&meta) {
        Ok(t) => t,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
            )
                .into_response();
        }
    };
    if let Err(err) = tokio::fs::write(&path, text).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
        )
            .into_response();
    }
    let points_path = points_dir.join(format!("{}.jsonl", req.name));
    if tokio::fs::metadata(&points_path).await.is_err() {
        let _ = tokio::fs::write(&points_path, b"").await;
    }

    (StatusCode::OK, Json(meta)).into_response()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct VectorPoint {
    pub(super) id: String,
    pub(super) vector: Vec<f32>,
    #[serde(default)]
    pub(super) payload: serde_json::Value,
    pub(super) batch_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct UpsertVectorPointsRequest {
    collection: String,
    points: Vec<VectorPoint>,
    batch_id: Option<String>,
}

pub(super) async fn upsert_vector_points(
    State(state): State<AppState>,
    Json(req): Json<UpsertVectorPointsRequest>,
) -> axum::response::Response {
    if !is_safe_identifier(&req.collection) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_collection" })),
        )
            .into_response();
    }
    if req.points.is_empty() || req.points.len() > 10_000 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "limit_exceeded", "message": "too_many_points" })),
        )
            .into_response();
    }

    let base = vector_base_dir(&state);
    let col_path = base
        .join("collections")
        .join(format!("{}.json", req.collection));
    let meta_text = match tokio::fs::read_to_string(&col_path).await {
        Ok(t) => t,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "collection": req.collection })),
            )
                .into_response();
        }
    };
    let meta: VectorCollection = match serde_json::from_str(&meta_text) {
        Ok(m) => m,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "parse_failed" })),
            )
                .into_response();
        }
    };

    if req
        .points
        .iter()
        .any(|p| p.id.trim().is_empty() || p.vector.len() != meta.dimension as usize)
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "validation_failed", "message": "dimension_mismatch" })),
        )
            .into_response();
    }

    let points_path = base
        .join("points")
        .join(format!("{}.jsonl", req.collection));
    let existing = tokio::fs::read_to_string(&points_path)
        .await
        .unwrap_or_default();
    let mut map = HashMap::<String, VectorPoint>::new();
    for line in existing.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(p) = serde_json::from_str::<VectorPoint>(line) {
            map.insert(p.id.clone(), p);
        }
    }
    let batch_id = req.batch_id.clone();
    for mut p in req.points {
        if p.payload.is_null() {
            p.payload = serde_json::Value::Object(serde_json::Map::new());
        }
        if p.batch_id.is_none() {
            p.batch_id = batch_id.clone();
        }
        map.insert(p.id.clone(), p);
    }

    let mut out = String::new();
    for p in map.values() {
        if let Ok(line) = serde_json::to_string(p) {
            out.push_str(&line);
            out.push('\n');
        }
    }
    if let Err(err) = tokio::fs::write(&points_path, out).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({ "upserted": map.len() })),
    )
        .into_response()
}

pub(super) async fn vector_upsert_points_internal(
    state: &AppState,
    collection: &str,
    points: Vec<VectorPoint>,
) -> anyhow::Result<u64> {
    if !is_safe_identifier(collection) {
        anyhow::bail!("invalid_collection");
    }
    let base = vector_base_dir(state);
    let col_path = base.join("collections").join(format!("{collection}.json"));
    let meta_text = tokio::fs::read_to_string(&col_path).await?;
    let meta: VectorCollection = serde_json::from_str(&meta_text)?;
    if points
        .iter()
        .any(|p| p.id.trim().is_empty() || p.vector.len() != meta.dimension as usize)
    {
        anyhow::bail!("dimension_mismatch");
    }
    let points_path = base.join("points").join(format!("{collection}.jsonl"));
    let existing = tokio::fs::read_to_string(&points_path)
        .await
        .unwrap_or_default();
    let mut map = HashMap::<String, VectorPoint>::new();
    for line in existing.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(p) = serde_json::from_str::<VectorPoint>(line) {
            map.insert(p.id.clone(), p);
        }
    }
    for p in points {
        map.insert(p.id.clone(), p);
    }
    let mut out = String::new();
    for p in map.values() {
        out.push_str(&serde_json::to_string(p)?);
        out.push('\n');
    }
    tokio::fs::write(&points_path, out).await?;
    Ok(map.len() as u64)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorFilter {
    must: Option<Vec<VectorFilterCondition>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorFilterCondition {
    key: String,
    r#match: VectorMatch,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorMatch {
    value: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SearchVectorRequest {
    collection: String,
    vector: Vec<f32>,
    top_k: Option<u32>,
    filter: Option<VectorFilter>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VectorSearchHit {
    id: String,
    score: f32,
    payload: serde_json::Value,
}

pub(super) async fn search_vector(
    State(state): State<AppState>,
    Json(req): Json<SearchVectorRequest>,
) -> axum::response::Response {
    if !is_safe_identifier(&req.collection) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_collection" })),
        )
            .into_response();
    }
    let top_k = req.top_k.unwrap_or(10).min(100) as usize;

    let base = vector_base_dir(&state);
    let col_path = base
        .join("collections")
        .join(format!("{}.json", req.collection));
    let meta_text = match tokio::fs::read_to_string(&col_path).await {
        Ok(t) => t,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "collection": req.collection })),
            )
                .into_response();
        }
    };
    let meta: VectorCollection = match serde_json::from_str(&meta_text) {
        Ok(m) => m,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "parse_failed" })),
            )
                .into_response();
        }
    };
    if req.vector.len() != meta.dimension as usize {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "validation_failed", "message": "dimension_mismatch" })),
        )
            .into_response();
    }

    let points_path = base
        .join("points")
        .join(format!("{}.jsonl", req.collection));
    let text = tokio::fs::read_to_string(&points_path)
        .await
        .unwrap_or_default();
    let mut hits = Vec::<VectorSearchHit>::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(p) = serde_json::from_str::<VectorPoint>(line) else {
            continue;
        };
        if !vector_point_matches_filter(&p, req.filter.as_ref()) {
            continue;
        }
        let score = cosine_similarity(&req.vector, &p.vector);
        hits.push(VectorSearchHit {
            id: p.id,
            score,
            payload: p.payload,
        });
    }
    hits.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    hits.truncate(top_k);
    (StatusCode::OK, Json(serde_json::json!({ "hits": hits }))).into_response()
}

fn vector_point_matches_filter(p: &VectorPoint, filter: Option<&VectorFilter>) -> bool {
    let Some(filter) = filter else {
        return true;
    };
    let Some(must) = &filter.must else {
        return true;
    };
    for cond in must {
        if cond.key.trim().is_empty() {
            return false;
        }
        let Some(obj) = p.payload.as_object() else {
            return false;
        };
        let Some(v) = obj.get(&cond.key) else {
            return false;
        };
        if v != &cond.r#match.value {
            return false;
        }
    }
    true
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DeleteVectorPointsRequest {
    collection: String,
    filter: Option<VectorFilter>,
    batch_id: Option<String>,
}

pub(super) async fn delete_vector_points(
    State(state): State<AppState>,
    Json(req): Json<DeleteVectorPointsRequest>,
) -> axum::response::Response {
    if !is_safe_identifier(&req.collection) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_collection" })),
        )
            .into_response();
    }
    let base = vector_base_dir(&state);
    let points_path = base
        .join("points")
        .join(format!("{}.jsonl", req.collection));
    let text = tokio::fs::read_to_string(&points_path)
        .await
        .unwrap_or_default();
    let mut kept = Vec::<VectorPoint>::new();
    let mut deleted: u64 = 0;
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(p) = serde_json::from_str::<VectorPoint>(line) else {
            continue;
        };
        let by_batch = req
            .batch_id
            .as_deref()
            .is_some_and(|bid| p.batch_id.as_deref() == Some(bid));
        let by_filter = vector_point_matches_filter(&p, req.filter.as_ref());
        let should_delete = if req.batch_id.is_some() {
            by_batch && by_filter
        } else {
            by_filter
        };
        if should_delete {
            deleted += 1;
        } else {
            kept.push(p);
        }
    }
    let mut out = String::new();
    for p in kept {
        if let Ok(line) = serde_json::to_string(&p) {
            out.push_str(&line);
            out.push('\n');
        }
    }
    if let Err(err) = tokio::fs::write(&points_path, out).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "message": err.to_string() })),
        )
            .into_response();
    }
    (
        StatusCode::OK,
        Json(serde_json::json!({ "deleted": deleted })),
    )
        .into_response()
}
