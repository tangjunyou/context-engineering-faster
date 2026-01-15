use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
        let mut full_text = String::new();

        for node in nodes {
            let mut content = node.content.clone();
            
            // Simple interpolation
            for (name, value) in &self.variables {
                let placeholder = format!("{{{{{}}}}}", name);
                content = content.replace(&placeholder, value);
            }

            full_text.push_str(&format!("--- {} ---\n{}\n\n", node.label, content));
        }

        Ok(full_text.trim().to_string())
    }
}
