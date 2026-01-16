use std::{collections::HashMap, path::PathBuf};

use axum::{
    extract::Query,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use context_engine::{render_with_trace, EngineNode, NodeKind, OutputStyle, TraceRun};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{now_ms, resolvers::resolve_variable_with_trace, AppState, VariableSpec};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunRecord {
    pub(crate) run_id: String,
    pub(crate) created_at: String,
    pub(crate) project_id: String,
    pub(crate) dataset_id: String,
    pub(crate) row_index: u64,
    pub(crate) status: String,
    pub(crate) output_digest: String,
    pub(crate) missing_variables_count: u64,
    pub(crate) trace: TraceRun,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunSummary {
    pub(crate) run_id: String,
    pub(crate) created_at: String,
    pub(crate) row_index: u64,
    pub(crate) status: String,
    pub(crate) output_digest: String,
    pub(crate) missing_variables_count: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReplayDatasetRequest {
    pub(crate) project_id: String,
    pub(crate) limit: Option<u32>,
    pub(crate) offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DatasetRecord {
    id: String,
    name: String,
    rows: Vec<serde_json::Value>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredProjectDoc {
    id: String,
    name: String,
    state: StoredProjectState,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredProjectState {
    nodes: Vec<StoredFlowNode>,
    edges: Vec<StoredFlowEdge>,
    variables: Vec<StoredProjectVariable>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredProjectVariable {
    id: String,
    name: String,
    r#type: String,
    value: String,
    #[serde(default)]
    resolver: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredFlowNode {
    id: String,
    data: StoredFlowNodeData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredFlowNodeData {
    label: String,
    #[serde(rename = "type")]
    node_type: String,
    #[serde(default)]
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredFlowEdge {
    source: String,
    target: String,
}

fn runs_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("runs")
}

async fn write_run_record(state: &AppState, run: &RunRecord) -> anyhow::Result<()> {
    let dir = runs_dir(state);
    tokio::fs::create_dir_all(&dir).await?;
    let path = dir.join(format!("{}.json", run.run_id));
    let text = serde_json::to_string_pretty(run)?;
    tokio::fs::write(path, text).await?;
    Ok(())
}

async fn load_dataset_record(state: &AppState, dataset_id: &str) -> anyhow::Result<DatasetRecord> {
    let path = state
        .data_dir
        .join("datasets")
        .join(format!("{dataset_id}.json"));
    let text = tokio::fs::read_to_string(path).await?;
    Ok(serde_json::from_str(&text)?)
}

async fn load_project_doc(state: &AppState, project_id: &str) -> anyhow::Result<StoredProjectDoc> {
    let path = state
        .data_dir
        .join("projects")
        .join(format!("{project_id}.json"));
    let text = tokio::fs::read_to_string(path).await?;
    Ok(serde_json::from_str(&text)?)
}

fn node_type_to_kind(node_type: &str) -> NodeKind {
    match node_type {
        "system_prompt" => NodeKind::System,
        "user_input" => NodeKind::User,
        "messages" => NodeKind::Assistant,
        "tools" => NodeKind::Tool,
        "memory" => NodeKind::Memory,
        "retrieval" => NodeKind::Retrieval,
        _ => NodeKind::Text,
    }
}

fn topo_sort_nodes(nodes: &[StoredFlowNode], edges: &[StoredFlowEdge]) -> Vec<StoredFlowNode> {
    if edges.is_empty() {
        return nodes.to_vec();
    }

    let mut by_id = HashMap::<String, StoredFlowNode>::new();
    for n in nodes {
        by_id.insert(n.id.clone(), n.clone());
    }

    let mut indeg = HashMap::<String, usize>::new();
    let mut out = HashMap::<String, Vec<String>>::new();
    for id in by_id.keys() {
        indeg.insert(id.clone(), 0);
        out.insert(id.clone(), Vec::new());
    }

    for e in edges {
        if !by_id.contains_key(&e.source) || !by_id.contains_key(&e.target) {
            continue;
        }
        *indeg.entry(e.target.clone()).or_insert(0) += 1;
        out.entry(e.source.clone())
            .or_default()
            .push(e.target.clone());
    }

    let mut ready = indeg
        .iter()
        .filter_map(|(id, d)| if *d == 0 { Some(id.clone()) } else { None })
        .collect::<Vec<_>>();
    ready.sort();

    let mut result = Vec::<StoredFlowNode>::new();
    while let Some(id) = ready.first().cloned() {
        ready.remove(0);
        if let Some(node) = by_id.get(&id) {
            result.push(node.clone());
        }
        let mut nexts = out.get(&id).cloned().unwrap_or_default();
        nexts.sort();
        for to in nexts {
            let d = indeg.entry(to.clone()).or_insert(0);
            *d = d.saturating_sub(1);
            if *d == 0 {
                ready.push(to);
                ready.sort();
            }
        }
    }

    if result.len() != nodes.len() {
        let mut fallback = nodes.to_vec();
        fallback.sort_by(|a, b| a.id.cmp(&b.id));
        return fallback;
    }
    result
}

fn row_to_variable_overrides(row: &serde_json::Value) -> anyhow::Result<HashMap<String, String>> {
    let Some(obj) = row.as_object() else {
        anyhow::bail!("row_invalid");
    };

    if let Some(vars) = obj.get("variables") {
        let Some(vobj) = vars.as_object() else {
            anyhow::bail!("row_invalid");
        };
        let mut out = HashMap::<String, String>::new();
        for (k, v) in vobj {
            if k.starts_with('_') {
                continue;
            }
            out.insert(k.to_string(), json_value_to_string(v));
        }
        return Ok(out);
    }

    let mut out = HashMap::<String, String>::new();
    for (k, v) in obj {
        if k.starts_with('_') {
            continue;
        }
        out.insert(k.to_string(), json_value_to_string(v));
    }
    Ok(out)
}

fn json_value_to_string(v: &serde_json::Value) -> String {
    if let Some(s) = v.as_str() {
        return s.to_string();
    }
    if let Some(n) = v.as_i64() {
        return n.to_string();
    }
    if let Some(n) = v.as_f64() {
        return n.to_string();
    }
    if let Some(b) = v.as_bool() {
        return b.to_string();
    }
    serde_json::to_string(v).unwrap_or_default()
}

fn digest_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    let out = hasher.finalize();
    STANDARD.encode(out)
}

fn missing_variables_count(trace: &TraceRun) -> u64 {
    let mut set = std::collections::HashSet::<String>::new();
    for seg in &trace.segments {
        for name in &seg.missing_variables {
            if !name.trim().is_empty() {
                set.insert(name.to_string());
            }
        }
    }
    set.len() as u64
}

pub(crate) async fn replay_dataset(
    State(state): State<AppState>,
    Path(dataset_id): Path<String>,
    Json(req): Json<ReplayDatasetRequest>,
) -> axum::response::Response {
    if req.project_id.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "validation_failed" })),
        )
            .into_response();
    }

    let limit = req.limit.unwrap_or(20).min(200) as usize;
    let offset = req.offset.unwrap_or(0) as usize;

    let dataset = match load_dataset_record(&state, &dataset_id).await {
        Ok(ds) => ds,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "dataset_not_found", "id": dataset_id })),
            )
                .into_response();
        }
    };

    let project = match load_project_doc(&state, &req.project_id).await {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "project_not_found", "id": req.project_id })),
            )
                .into_response();
        }
    };

    let sorted_nodes = topo_sort_nodes(&project.state.nodes, &project.state.edges);
    let engine_nodes = sorted_nodes
        .into_iter()
        .map(|n| EngineNode {
            id: n.id,
            label: n.data.label,
            kind: node_type_to_kind(&n.data.node_type),
            content: n.data.content,
        })
        .collect::<Vec<_>>();

    let start = offset.min(dataset.rows.len());
    let end = (start + limit).min(dataset.rows.len());
    let mut summaries = Vec::<RunSummary>::new();

    for (i, row) in dataset.rows[start..end].iter().enumerate() {
        let row_index = (start + i) as u64;
        let run_id = format!("run_{}_{}", now_ms(), row_index);
        let created_at = now_ms().to_string();

        let overrides = match row_to_variable_overrides(row) {
            Ok(m) => m,
            Err(_) => {
                let trace = render_with_trace(
                    &engine_nodes,
                    &HashMap::new(),
                    OutputStyle::Labeled,
                    &run_id,
                    &created_at,
                );
                let record = RunRecord {
                    run_id: run_id.clone(),
                    created_at: created_at.clone(),
                    project_id: project.id.clone(),
                    dataset_id: dataset.id.clone(),
                    row_index,
                    status: "failed".to_string(),
                    output_digest: digest_text(""),
                    missing_variables_count: missing_variables_count(&trace),
                    trace,
                };
                let _ = write_run_record(&state, &record).await;
                summaries.push(RunSummary {
                    run_id,
                    created_at,
                    row_index,
                    status: "failed".to_string(),
                    output_digest: record.output_digest,
                    missing_variables_count: record.missing_variables_count,
                });
                continue;
            }
        };

        let mut resolved_map = HashMap::<String, String>::new();
        let mut messages = Vec::new();

        for v in &project.state.variables {
            let spec = VariableSpec {
                id: v.id.clone(),
                name: v.name.clone(),
                r#type: v.r#type.clone(),
                value: v.value.clone(),
                resolver: v.resolver.clone(),
            };
            let r = resolve_variable_with_trace(state.clone(), spec).await;
            messages.push(r.trace_message);
            if let Ok(value) = r.result {
                resolved_map.insert(v.name.clone(), value.string_value);
            }
        }

        for (k, v) in overrides {
            resolved_map.insert(k, v);
        }

        let trace = {
            let mut trace = render_with_trace(
                &engine_nodes,
                &resolved_map,
                OutputStyle::Labeled,
                &run_id,
                &created_at,
            );
            trace.messages.extend(messages);
            trace
        };

        let digest = digest_text(&trace.text);
        let missing = missing_variables_count(&trace);
        let status = "succeeded".to_string();

        let record = RunRecord {
            run_id: run_id.clone(),
            created_at: created_at.clone(),
            project_id: project.id.clone(),
            dataset_id: dataset.id.clone(),
            row_index,
            status: status.clone(),
            output_digest: digest.clone(),
            missing_variables_count: missing,
            trace: trace.clone(),
        };
        if write_run_record(&state, &record).await.is_err() {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "write_failed" })),
            )
                .into_response();
        }

        summaries.push(RunSummary {
            run_id,
            created_at,
            row_index,
            status,
            output_digest: digest,
            missing_variables_count: missing,
        });
    }

    (StatusCode::OK, Json(summaries)).into_response()
}

pub(crate) async fn list_dataset_runs(
    State(state): State<AppState>,
    Path(dataset_id): Path<String>,
    Query(query): Query<ListDatasetRunsQuery>,
) -> axum::response::Response {
    let dir = runs_dir(&state);
    let mut out = Vec::<RunSummary>::new();
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
        let Ok(text) = tokio::fs::read_to_string(&path).await else {
            continue;
        };
        let Ok(run) = serde_json::from_str::<RunRecord>(&text) else {
            continue;
        };
        if run.dataset_id != dataset_id {
            continue;
        }
        if let Some(row_index) = query.row_index {
            if run.row_index != row_index {
                continue;
            }
        }
        out.push(RunSummary {
            run_id: run.run_id,
            created_at: run.created_at,
            row_index: run.row_index,
            status: run.status,
            output_digest: run.output_digest,
            missing_variables_count: run.missing_variables_count,
        });
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    if let Some(limit) = query.limit {
        out.truncate(limit as usize);
    }
    (StatusCode::OK, Json(out)).into_response()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListDatasetRunsQuery {
    pub(crate) row_index: Option<u64>,
    pub(crate) limit: Option<u32>,
}

pub(crate) async fn get_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> axum::response::Response {
    let path = runs_dir(&state).join(format!("{run_id}.json"));
    let text = match tokio::fs::read_to_string(&path).await {
        Ok(t) => t,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not_found", "id": run_id })),
            )
                .into_response();
        }
    };
    match serde_json::from_str::<RunRecord>(&text) {
        Ok(run) => (StatusCode::OK, Json(run)).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "parse_failed", "id": run_id })),
        )
            .into_response(),
    }
}
