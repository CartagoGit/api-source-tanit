//! Normaliza eventos de arrastre del webview a una única ruta.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DroppedFolder {
    pub path: String,
}

pub fn first_contained_path(paths: &[String], workspace_root: Option<&str>) -> Option<DroppedFolder> {
    paths.iter().map(|path| path.replace('\\', "/")).find(|path| {
        let clean = path.trim_end_matches('/');
        workspace_root.map_or(true, |root| {
            let normalized_root = root.replace('\\', "/").trim_end_matches('/').to_string();
            clean == normalized_root || clean.starts_with(&(normalized_root + "/"))
        })
    }).map(|path| DroppedFolder { path })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entrega_solo_rutas_contenidas() {
        let paths = vec!["/tmp/other".into(), "/tmp/work/api".into()];
        assert_eq!(first_contained_path(&paths, Some("/tmp/work")), Some(DroppedFolder { path: "/tmp/work/api".into() }));
    }
}