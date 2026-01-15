use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize)]
pub struct Variable {
    pub id: String,
    pub name: String,
    pub value: String,
}

#[derive(Serialize, Deserialize)]
pub struct ContextNode {
    pub id: String,
    pub label: String,
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OutputStyle {
    Plain,
    Labeled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    System,
    User,
    Assistant,
    Tool,
    Memory,
    Retrieval,
    Text,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineNode {
    pub id: String,
    pub label: String,
    pub kind: NodeKind,
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TraceSeverity {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceMessage {
    pub severity: TraceSeverity,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceSegment {
    pub node_id: String,
    pub label: String,
    pub kind: NodeKind,
    pub template: String,
    pub rendered: String,
    pub missing_variables: Vec<String>,
    pub messages: Vec<TraceMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceRun {
    pub run_id: String,
    pub created_at: String,
    pub output_style: OutputStyle,
    pub text: String,
    pub segments: Vec<TraceSegment>,
    pub messages: Vec<TraceMessage>,
}

#[wasm_bindgen]
pub struct ContextEngine {
    variables: HashMap<String, String>,
}

impl Default for ContextEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl ContextEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> ContextEngine {
        ContextEngine {
            variables: HashMap::new(),
        }
    }

    pub fn set_variables(&mut self, val: JsValue) -> Result<(), JsValue> {
        let variables: Vec<Variable> = serde_wasm_bindgen::from_value(val)?;
        self.variables.clear();
        for v in variables {
            self.variables.insert(v.name, v.value);
        }
        Ok(())
    }

    pub fn process_context(&self, nodes_val: JsValue) -> Result<String, JsValue> {
        let nodes: Vec<ContextNode> = serde_wasm_bindgen::from_value(nodes_val)?;
        let nodes = nodes
            .into_iter()
            .map(|n| EngineNode {
                id: n.id,
                label: n.label,
                kind: NodeKind::Text,
                content: n.content,
            })
            .collect::<Vec<_>>();

        let trace = render_with_trace(&nodes, &self.variables, OutputStyle::Labeled, "wasm", "");
        Ok(trace.text)
    }
}

pub fn render_with_trace(
    nodes: &[EngineNode],
    variables: &HashMap<String, String>,
    output_style: OutputStyle,
    run_id: &str,
    created_at: &str,
) -> TraceRun {
    let mut segments = Vec::with_capacity(nodes.len());
    let mut full_segments = Vec::with_capacity(nodes.len());

    for node in nodes {
        let mut messages = Vec::new();
        let (body, missing_variables) = interpolate_template(&node.content, variables);
        if !missing_variables.is_empty() {
            messages.push(TraceMessage {
                severity: TraceSeverity::Warn,
                code: "missing_variable".to_string(),
                message: format!(
                    "缺失变量：{}",
                    missing_variables
                        .iter()
                        .map(|s| s.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            });
        }

        let rendered = match output_style {
            OutputStyle::Plain => body,
            OutputStyle::Labeled => format!("--- {} ---\n{}", node.label, body),
        };

        full_segments.push(rendered.clone());
        segments.push(TraceSegment {
            node_id: node.id.clone(),
            label: node.label.clone(),
            kind: node.kind,
            template: node.content.clone(),
            rendered,
            missing_variables,
            messages,
        });
    }

    TraceRun {
        run_id: run_id.to_string(),
        created_at: created_at.to_string(),
        output_style,
        text: full_segments.join("\n\n").trim().to_string(),
        segments,
        messages: Vec::new(),
    }
}

fn interpolate_template(
    template: &str,
    variables: &HashMap<String, String>,
) -> (String, Vec<String>) {
    let mut out = String::with_capacity(template.len());
    let mut missing = Vec::<String>::new();

    let bytes = template.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' && i + 1 < bytes.len() && bytes[i + 1] == b'{' {
            let start = i;
            i += 2;
            let name_start = i;

            while i + 1 < bytes.len() && !(bytes[i] == b'}' && bytes[i + 1] == b'}') {
                i += 1;
            }

            if i + 1 >= bytes.len() {
                out.push_str(&template[start..]);
                break;
            }

            let name = template[name_start..i].trim();
            let placeholder = &template[start..i + 2];
            if name.is_empty() {
                out.push_str(placeholder);
            } else if let Some(value) = variables.get(name) {
                out.push_str(value);
            } else {
                missing.push(name.to_string());
                out.push_str(placeholder);
            }
            i += 2;
        } else {
            out.push(bytes[i] as char);
            i += 1;
        }
    }

    missing.sort();
    missing.dedup();
    (out, missing)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_labeled_and_interpolates() {
        let nodes = vec![
            EngineNode {
                id: "n1".to_string(),
                label: "System".to_string(),
                kind: NodeKind::System,
                content: "Hello {{name}}".to_string(),
            },
            EngineNode {
                id: "n2".to_string(),
                label: "User".to_string(),
                kind: NodeKind::User,
                content: "Ask: {{q}}".to_string(),
            },
        ];
        let vars = HashMap::from([
            ("name".to_string(), "Alice".to_string()),
            ("q".to_string(), "hi".to_string()),
        ]);

        let trace = render_with_trace(&nodes, &vars, OutputStyle::Labeled, "t1", "now");
        assert_eq!(
            trace.text,
            "--- System ---\nHello Alice\n\n--- User ---\nAsk: hi"
        );
        assert_eq!(trace.segments.len(), 2);
        assert!(trace.segments[0].missing_variables.is_empty());
        assert!(trace.segments[1].missing_variables.is_empty());
    }

    #[test]
    fn reports_missing_variable_and_keeps_placeholder() {
        let nodes = vec![EngineNode {
            id: "n1".to_string(),
            label: "System".to_string(),
            kind: NodeKind::System,
            content: "Hello {{missing}}".to_string(),
        }];
        let vars = HashMap::new();

        let trace = render_with_trace(&nodes, &vars, OutputStyle::Labeled, "t1", "now");
        assert_eq!(trace.segments.len(), 1);
        assert_eq!(trace.segments[0].missing_variables, vec!["missing"]);
        assert!(trace.segments[0].rendered.contains("Hello {{missing}}"));
        assert!(!trace.segments[0].messages.is_empty());
    }

    #[test]
    fn allows_empty_content() {
        let nodes = vec![EngineNode {
            id: "n1".to_string(),
            label: "Empty".to_string(),
            kind: NodeKind::Text,
            content: "".to_string(),
        }];
        let vars = HashMap::new();

        let trace = render_with_trace(&nodes, &vars, OutputStyle::Labeled, "t1", "now");
        assert_eq!(trace.text, "--- Empty ---");
    }
}
