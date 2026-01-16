use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use context_engine::TraceMessage;
use serde::{Deserialize, Serialize};

use crate::{now_ms, resolvers, AppState, VariableSpec};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VariableLibraryVersion {
    version_id: String,
    created_at: String,
    data: VariableLibraryData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VariableLibraryData {
    name: String,
    r#type: String,
    value: String,
    description: Option<String>,
    source: Option<String>,
    resolver: Option<String>,
    tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VariableLibraryItem {
    id: String,
    project_id: String,
    current_version_id: String,
    created_at: String,
    updated_at: String,
    versions: Vec<VariableLibraryVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VariableLibrarySummary {
    id: String,
    name: String,
    r#type: String,
    updated_at: String,
    current_version_id: String,
    tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateVariableLibraryRequest {
    name: String,
    r#type: String,
    value: String,
    description: Option<String>,
    source: Option<String>,
    resolver: Option<String>,
    tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateVariableLibraryRequest {
    name: Option<String>,
    r#type: Option<String>,
    value: Option<String>,
    description: Option<String>,
    source: Option<String>,
    resolver: Option<String>,
    tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RollbackVariableLibraryRequest {
    version_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VariableTestResponse {
    ok: bool,
    value: String,
    debug: Option<serde_json::Value>,
    trace: TraceMessage,
}

pub(crate) async fn list_variable_library(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> axum::response::Response {
    let dir = dir_for_project(&state, &project_id);
    let mut out = Vec::<VariableLibrarySummary>::new();

    let mut rd = match tokio::fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(_) => {
            return (StatusCode::OK, Json(out)).into_response();
        }
    };

    while let Ok(Some(entry)) = rd.next_entry().await {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(ext) = path.extension().and_then(|s| s.to_str()) else {
            continue;
        };
        if ext != "json" {
            continue;
        }
        let Ok(text) = tokio::fs::read_to_string(&path).await else {
            continue;
        };
        let Ok(item) = serde_json::from_str::<VariableLibraryItem>(&text) else {
            continue;
        };
        if let Some(current) = item
            .versions
            .iter()
            .find(|v| v.version_id == item.current_version_id)
        {
            out.push(VariableLibrarySummary {
                id: item.id,
                name: current.data.name.clone(),
                r#type: current.data.r#type.clone(),
                updated_at: item.updated_at,
                current_version_id: item.current_version_id,
                tags: current.data.tags.clone(),
            });
        }
    }

    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    (StatusCode::OK, Json(out)).into_response()
}

pub(crate) async fn create_variable_library_item(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(req): Json<CreateVariableLibraryRequest>,
) -> axum::response::Response {
    let id = format!("var_{}", now_ms());
    let now = now_ms().to_string();
    let version_id = format!("v_{}", now_ms());

    let data = VariableLibraryData {
        name: req.name,
        r#type: req.r#type,
        value: req.value,
        description: req.description,
        source: req.source,
        resolver: req.resolver,
        tags: req.tags.unwrap_or_default(),
    };
    let item = VariableLibraryItem {
        id: id.clone(),
        project_id: project_id.clone(),
        current_version_id: version_id.clone(),
        created_at: now.clone(),
        updated_at: now,
        versions: vec![VariableLibraryVersion {
            version_id,
            created_at: now_ms().to_string(),
            data,
        }],
    };

    if let Err(err) = write_item(&state, &project_id, &item).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "detail": err.to_string() })),
        )
            .into_response();
    }

    (StatusCode::CREATED, Json(item)).into_response()
}

pub(crate) async fn get_variable_library_item(
    State(state): State<AppState>,
    Path((project_id, id)): Path<(String, String)>,
) -> axum::response::Response {
    match read_item(&state, &project_id, &id).await {
        Ok(item) => (StatusCode::OK, Json(item)).into_response(),
        Err(_) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "not_found", "id": id })),
        )
            .into_response(),
    }
}

pub(crate) async fn delete_variable_library_item(
    State(state): State<AppState>,
    Path((project_id, id)): Path<(String, String)>,
) -> axum::response::Response {
    let path = item_path(&state, &project_id, &id);
    match tokio::fs::remove_file(&path).await {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Err(_) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "not_found", "id": id })),
        )
            .into_response(),
    }
}

pub(crate) async fn update_variable_library_item(
    State(state): State<AppState>,
    Path((project_id, id)): Path<(String, String)>,
    Json(req): Json<UpdateVariableLibraryRequest>,
) -> axum::response::Response {
    let mut item = match read_item(&state, &project_id, &id).await {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response();
        }
    };

    let current = match item
        .versions
        .iter()
        .find(|v| v.version_id == item.current_version_id)
        .cloned()
    {
        Some(v) => v,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "corrupted", "id": id })),
            )
                .into_response();
        }
    };

    let now = now_ms().to_string();
    let version_id = format!("v_{}", now_ms());

    let merged = VariableLibraryData {
        name: req.name.unwrap_or(current.data.name),
        r#type: req.r#type.unwrap_or(current.data.r#type),
        value: req.value.unwrap_or(current.data.value),
        description: req.description.or(current.data.description),
        source: req.source.or(current.data.source),
        resolver: req.resolver.or(current.data.resolver),
        tags: req.tags.unwrap_or(current.data.tags),
    };

    item.current_version_id = version_id.clone();
    item.updated_at = now;
    item.versions.push(VariableLibraryVersion {
        version_id,
        created_at: now_ms().to_string(),
        data: merged,
    });

    if let Err(err) = write_item(&state, &project_id, &item).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "detail": err.to_string() })),
        )
            .into_response();
    }

    (StatusCode::OK, Json(item)).into_response()
}

pub(crate) async fn rollback_variable_library_item(
    State(state): State<AppState>,
    Path((project_id, id)): Path<(String, String)>,
    Json(req): Json<RollbackVariableLibraryRequest>,
) -> axum::response::Response {
    let mut item = match read_item(&state, &project_id, &id).await {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response();
        }
    };

    if !item.versions.iter().any(|v| v.version_id == req.version_id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "version_not_found", "versionId": req.version_id })),
        )
            .into_response();
    }

    item.current_version_id = req.version_id;
    item.updated_at = now_ms().to_string();

    if let Err(err) = write_item(&state, &project_id, &item).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "detail": err.to_string() })),
        )
            .into_response();
    }

    (StatusCode::OK, Json(item)).into_response()
}

pub(crate) async fn clone_variable_library_item(
    State(state): State<AppState>,
    Path((project_id, id)): Path<(String, String)>,
) -> axum::response::Response {
    let mut item = match read_item(&state, &project_id, &id).await {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": id })),
            )
                .into_response();
        }
    };

    let new_id = format!("var_{}", now_ms());
    item.id = new_id.clone();
    item.created_at = now_ms().to_string();
    item.updated_at = item.created_at.clone();

    if let Err(err) = write_item(&state, &project_id, &item).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "write_failed", "detail": err.to_string() })),
        )
            .into_response();
    }

    (StatusCode::CREATED, Json(item)).into_response()
}

pub(crate) async fn test_variable(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(mut v): Json<VariableSpec>,
) -> axum::response::Response {
    let _ = project_id;
    if v.id.trim().is_empty() {
        v.id = "v_test".to_string();
    }
    if v.name.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_variable", "message": "name required" })),
        )
            .into_response();
    }

    let out = resolvers::resolve_variable_with_trace(state, v.clone()).await;
    match out.result {
        Ok(resolved) => (
            StatusCode::OK,
            Json(VariableTestResponse {
                ok: true,
                value: resolved.string_value,
                debug: resolved.debug_json,
                trace: out.trace_message,
            }),
        )
            .into_response(),
        Err(_) => (
            StatusCode::OK,
            Json(VariableTestResponse {
                ok: false,
                value: format!("[{}]", v.name),
                debug: None,
                trace: out.trace_message,
            }),
        )
            .into_response(),
    }
}

fn dir_for_project(state: &AppState, project_id: &str) -> std::path::PathBuf {
    state.data_dir.join("variable-library").join(project_id)
}

fn item_path(state: &AppState, project_id: &str, id: &str) -> std::path::PathBuf {
    dir_for_project(state, project_id).join(format!("{id}.json"))
}

async fn read_item(
    state: &AppState,
    project_id: &str,
    id: &str,
) -> anyhow::Result<VariableLibraryItem> {
    let path = item_path(state, project_id, id);
    let text = tokio::fs::read_to_string(path).await?;
    Ok(serde_json::from_str(&text)?)
}

async fn write_item(
    state: &AppState,
    project_id: &str,
    item: &VariableLibraryItem,
) -> anyhow::Result<()> {
    let dir = dir_for_project(state, project_id);
    tokio::fs::create_dir_all(&dir).await?;
    let path = dir.join(format!("{}.json", item.id));
    let text = serde_json::to_string_pretty(item)?;
    tokio::fs::write(path, text).await?;
    Ok(())
}
