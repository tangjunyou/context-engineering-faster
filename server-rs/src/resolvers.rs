use context_engine::{TraceMessage, TraceSeverity};
use serde_json::json;
use std::{collections::HashMap, future::Future, pin::Pin};

use crate::{now_ms, AppState, VariableSpec};

type ResolverFuture = Pin<Box<dyn Future<Output = anyhow::Result<ResolvedValue>> + Send>>;
type ResolverFn = fn(AppState, String, VariableSpec) -> ResolverFuture;

const MAX_VALUE_BYTES: usize = 20_000;

pub(crate) struct ResolvedValue {
    pub string_value: String,
    pub debug_json: Option<serde_json::Value>,
}

pub(crate) struct ResolveWithTrace {
    pub result: anyhow::Result<ResolvedValue>,
    pub trace_message: TraceMessage,
}

struct ResolverRegistry {
    by_scheme: HashMap<&'static str, ResolverFn>,
}

impl ResolverRegistry {
    fn new() -> Self {
        let mut by_scheme = HashMap::<&'static str, ResolverFn>::new();
        by_scheme.insert("chat", resolve_chat);
        by_scheme.insert("sql", resolve_sql);
        by_scheme.insert("sqlite", resolve_sqlite);
        by_scheme.insert("neo4j", resolve_neo4j);
        by_scheme.insert("milvus", resolve_milvus);
        Self { by_scheme }
    }

    async fn resolve(
        &self,
        state: AppState,
        scheme: &str,
        resolver: &str,
        v: VariableSpec,
    ) -> anyhow::Result<ResolvedValue> {
        let f = self
            .by_scheme
            .get(scheme)
            .ok_or_else(|| anyhow::anyhow!("不支持的 resolver scheme：{scheme}"))?;
        f(state, resolver.to_string(), v).await
    }
}

pub(crate) async fn resolve_variable_with_trace(state: AppState, v: VariableSpec) -> ResolveWithTrace {
    let started = now_ms();

    if v.r#type != "dynamic" {
        let (clamped, truncated) = clamp_string(&v.value, MAX_VALUE_BYTES);
        return ResolveWithTrace {
            result: Ok(ResolvedValue {
                string_value: clamped,
                debug_json: None,
            }),
            trace_message: TraceMessage {
                severity: TraceSeverity::Info,
                code: "variable_static".to_string(),
                message: format!("变量 {} 使用静态值", v.name),
                details: Some(json!({
                    "variableId": v.id,
                    "variableName": v.name,
                    "type": v.r#type,
                    "durationMs": now_ms().saturating_sub(started),
                    "outputBytesLimit": MAX_VALUE_BYTES,
                    "truncated": truncated,
                })),
            },
        };
    }

    let resolver = v.resolver.clone().unwrap_or_default();
    let resolver = resolver.trim().to_string();
    if resolver.is_empty() {
        let duration_ms = now_ms().saturating_sub(started);
        return ResolveWithTrace {
            result: Err(anyhow::anyhow!("resolver_missing")),
            trace_message: TraceMessage {
                severity: TraceSeverity::Warn,
                code: "variable_resolve_failed".to_string(),
                message: format!("变量 {} 解析失败：resolver 为空", v.name),
                details: Some(json!({
                    "variableId": v.id,
                    "variableName": v.name,
                    "type": v.r#type,
                    "scheme": "",
                    "resolver": "",
                    "durationMs": duration_ms,
                    "errorCode": "resolver_missing",
                    "errorMessage": "resolver_missing",
                })),
            },
        };
    }
    let scheme = resolver.split("://").next().unwrap_or("").trim().to_string();

    let registry = ResolverRegistry::new();
    let result = registry
        .resolve(state, &scheme, &resolver, v.clone())
        .await;
    let duration_ms = now_ms().saturating_sub(started);

    match result {
        Ok(mut resolved) => {
            let (clamped, truncated) = clamp_string(&resolved.string_value, MAX_VALUE_BYTES);
            resolved.string_value = clamped;
            let value_bytes = resolved.string_value.len();
            let debug = resolved.debug_json.clone();
            ResolveWithTrace {
                result: Ok(resolved),
                trace_message: TraceMessage {
                    severity: TraceSeverity::Info,
                    code: "variable_resolved".to_string(),
                    message: format!("变量 {} 解析成功", v.name),
                    details: Some(json!({
                        "variableId": v.id,
                        "variableName": v.name,
                        "type": v.r#type,
                        "scheme": scheme,
                        "resolver": resolver,
                        "durationMs": duration_ms,
                        "valueBytes": value_bytes,
                        "outputBytesLimit": MAX_VALUE_BYTES,
                        "truncated": truncated,
                        "debug": debug,
                    })),
                },
            }
        }
        Err(err) => {
            let err_string = err.to_string();
            let error_code = classify_error_code(&err_string);
            ResolveWithTrace {
                result: Err(err),
            trace_message: TraceMessage {
                severity: TraceSeverity::Warn,
                code: "variable_resolve_failed".to_string(),
                message: format!("变量 {} 解析失败：{}", v.name, err_string),
                details: Some(json!({
                    "variableId": v.id,
                    "variableName": v.name,
                    "type": v.r#type,
                    "scheme": scheme,
                    "resolver": resolver,
                    "durationMs": duration_ms,
                    "errorCode": error_code,
                    "errorMessage": err_string,
                })),
            },
            }
        }
    }
}

fn clamp_string(s: &str, max_bytes: usize) -> (String, bool) {
    if s.len() <= max_bytes {
        return (s.to_string(), false);
    }
    let mut cut = 0usize;
    for (idx, _) in s.char_indices() {
        if idx > max_bytes {
            break;
        }
        cut = idx;
    }
    if cut == 0 {
        return ("".to_string(), true);
    }
    (s[..cut].to_string(), true)
}

fn classify_error_code(err: &str) -> String {
    let e = err.trim();
    if e == "resolver_missing" {
        return "resolver_missing".to_string();
    }
    if e == "readonly_required" {
        return "readonly_required".to_string();
    }
    if e == "feature_not_enabled" {
        return "feature_not_enabled".to_string();
    }
    if e == "unsupported_op" {
        return "unsupported_op".to_string();
    }
    if e.contains("decrypt failed") || e.contains("missing DATA_KEY") {
        return "decrypt_failed".to_string();
    }
    if e.contains("不支持的 resolver scheme") {
        return "unsupported_scheme".to_string();
    }
    if e.contains("relative URL without a base") || e.contains("error with configuration") {
        return "invalid_url".to_string();
    }
    if e.contains("unable to open database file") {
        return "sqlite_open_failed".to_string();
    }
    if e.contains("connection refused") || e.contains("Connection refused") {
        return "connect_failed".to_string();
    }
    "unknown".to_string()
}

fn resolve_chat(state: AppState, resolver: String, v: VariableSpec) -> ResolverFuture {
    Box::pin(async move {
        let session_id = resolver.trim_start_matches("chat://");
        let requested = v.value.trim().parse::<usize>().unwrap_or(20);
        let max_messages = requested.min(200);
        let s = crate::load_session(&state, session_id).await?;
        Ok(ResolvedValue {
            string_value: crate::render_session_as_text(&s, max_messages),
            debug_json: Some(json!({
                "requestedMaxMessages": requested,
                "maxMessages": max_messages,
                "sessionId": session_id,
                "messageCount": s.messages.len(),
            })),
        })
    })
}

fn resolve_sql(state: AppState, resolver: String, v: VariableSpec) -> ResolverFuture {
    Box::pin(async move {
        if v.value.trim().is_empty() {
            anyhow::bail!("SQL 不能为空");
        }
        let data_source_id = resolver.trim_start_matches("sql://");
        let url = crate::decrypt_datasource_url(&state, data_source_id).await?;
        let out = crate::resolve_sql_value(&url, &v.value).await?;
        Ok(ResolvedValue {
            string_value: out,
            debug_json: Some(json!({
                "dataSourceId": data_source_id,
            })),
        })
    })
}

fn resolve_sqlite(state: AppState, resolver: String, v: VariableSpec) -> ResolverFuture {
    let _ = state;
    Box::pin(async move {
        if v.value.trim().is_empty() {
            anyhow::bail!("SQL 不能为空");
        }
        let out = crate::resolve_sql_value(&resolver, &v.value).await?;
        Ok(ResolvedValue {
            string_value: out,
            debug_json: Some(json!({
                "url": "<redacted>",
            })),
        })
    })
}

fn resolve_neo4j(state: AppState, resolver: String, v: VariableSpec) -> ResolverFuture {
    Box::pin(async move {
        if v.value.trim().is_empty() {
            anyhow::bail!("Cypher 不能为空");
        }
        let data_source_id = resolver.trim_start_matches("neo4j://");
        let out = crate::resolve_neo4j_value(&state, data_source_id, &v.value).await?;
        Ok(ResolvedValue {
            string_value: out,
            debug_json: Some(json!({
                "dataSourceId": data_source_id,
            })),
        })
    })
}

fn resolve_milvus(state: AppState, resolver: String, v: VariableSpec) -> ResolverFuture {
    Box::pin(async move {
        let data_source_id = resolver.trim_start_matches("milvus://");
        let out = crate::resolve_milvus_value(&state, data_source_id, &v.value).await?;
        Ok(ResolvedValue {
            string_value: out,
            debug_json: Some(json!({
                "dataSourceId": data_source_id,
            })),
        })
    })
}
