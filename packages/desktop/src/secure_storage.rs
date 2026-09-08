//! Native secure-storage boundary. Production wiring can replace the
//! implementation with the platform keyring without changing the webview API.

use keyring::Entry;

impl SecureStorage {
    pub fn save(&self, service: String, value: String) -> Result<(), String> {
        Entry::new("tanit", &service).map_err(|error| error.to_string())?.set_password(&value).map_err(|error| error.to_string())
    }

    pub fn retrieve(&self, service: &str) -> Result<Option<String>, String> {
        match Entry::new("tanit", service).map_err(|error| error.to_string())?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    pub fn delete(&self, service: &str) -> Result<(), String> {
        match Entry::new("tanit", service).map_err(|error| error.to_string())?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}