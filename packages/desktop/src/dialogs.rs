//! Native folder-picker contract for the Tauri shell.
//!
//! The dependency is registered by the desktop composition root. This module
//! keeps the command payload small and platform-neutral: the dialog plugin
//! delegates to NSOpenPanel, IFileOpenDialog, or the XDG portal chooser.

pub const DIALOG_COMMAND: &str = "plugin:dialog|open";

pub fn folder_dialog_options() -> FolderDialogOptions {
    FolderDialogOptions { directory: true, multiple: false }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FolderDialogOptions {
    pub directory: bool,
    pub multiple: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solo_pide_una_carpeta() {
        assert_eq!(DIALOG_COMMAND, "plugin:dialog|open");
        assert_eq!(folder_dialog_options(), FolderDialogOptions { directory: true, multiple: false });
    }
}