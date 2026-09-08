//! Native secure-storage boundary. Production wiring can replace the
//! implementation with the platform keyring without changing the webview API.

use std::collections::HashMap;
use std::sync::Mutex;

pub struct SecureStorage {
    values: Mutex<HashMap<String, String>>,
}

impl Default for SecureStorage {
    fn default() -> Self {
        Self { values: Mutex::new(HashMap::new()) }
    }
}

impl SecureStorage {
    pub fn save(&self, service: String, value: String) -> Result<(), String> {
        self.values.lock().map_err(|_| "secure storage unavailable".to_string())?.insert(service, value);
        Ok(())
    }

    pub fn retrieve(&self, service: &str) -> Result<Option<String>, String> {
        Ok(self.values.lock().map_err(|_| "secure storage unavailable".to_string())?.get(service).cloned())
    }

    pub fn delete(&self, service: &str) -> Result<(), String> {
        self.values.lock().map_err(|_| "secure storage unavailable".to_string())?.remove(service);
        Ok(())
    }
}