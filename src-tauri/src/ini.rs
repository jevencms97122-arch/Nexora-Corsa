//! Lecture et modification minimales de fichiers `.ini` : les commentaires, l'ordre et les clés inconnues sont conservés.

/// Valeur d'une clé, sans le commentaire final (` ; …`). Sections et clés sont insensibles à la casse.
pub fn get(text: &str, section: &str, key: &str) -> Option<String> {
    let mut current = String::new();
    for line in text.lines() {
        let t = line.trim();
        if let Some(name) = t.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            current = name.to_string();
        } else if current.eq_ignore_ascii_case(section) && !t.starts_with(';') {
            if let Some((k, v)) = t.split_once('=') {
                if k.trim().eq_ignore_ascii_case(key) {
                    return Some(v.split(';').next().unwrap_or("").trim().to_string());
                }
            }
        }
    }
    None
}

/// Met à jour (ou ajoute) les valeurs `(section, clé, valeur)`. Une section absente est créée à la fin.
pub fn set_values(existing: &str, updates: &[(&str, &str, String)]) -> String {
    let mut lines: Vec<String> = existing.lines().map(str::to_string).collect();
    for (section, key, value) in updates {
        let mut in_section = false;
        let mut section_end: Option<usize> = None; // position juste après la dernière ligne utile de la section
        let mut replaced = false;
        for i in 0..lines.len() {
            let t = lines[i].trim().to_string();
            if let Some(name) = t.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
                if in_section {
                    break;
                }
                in_section = name.eq_ignore_ascii_case(section);
                if in_section {
                    section_end = Some(i + 1);
                }
                continue;
            }
            if in_section {
                if !t.is_empty() {
                    section_end = Some(i + 1);
                }
                if !t.starts_with(';') {
                    if let Some((k, _)) = t.split_once('=') {
                        if k.trim().eq_ignore_ascii_case(key) {
                            lines[i] = format!("{key}={value}");
                            replaced = true;
                            break;
                        }
                    }
                }
            }
        }
        if replaced {
            continue;
        }
        match section_end {
            Some(at) => lines.insert(at, format!("{key}={value}")),
            None => {
                if lines.last().is_some_and(|l| !l.trim().is_empty()) {
                    lines.push(String::new());
                }
                lines.push(format!("[{section}]"));
                lines.push(format!("{key}={value}"));
            }
        }
    }
    let mut out = lines.join("\r\n");
    out.push_str("\r\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "[BASIC]\r\nENABLED=0 ; Active; 1 or 0\r\nOTHER=5\r\n\r\n[TAA]\r\nENABLED=1\r\n; commentaire\r\nBLUR_NEW=0.5\r\n";

    #[test]
    fn reads_values_without_trailing_comments() {
        assert_eq!(get(SAMPLE, "BASIC", "ENABLED").as_deref(), Some("0"));
        assert_eq!(get(SAMPLE, "taa", "enabled").as_deref(), Some("1"));
        assert_eq!(get(SAMPLE, "TAA", "MISSING"), None);
        assert_eq!(get(SAMPLE, "NOPE", "ENABLED"), None);
    }

    #[test]
    fn replaces_in_the_right_section_only() {
        let out = set_values(SAMPLE, &[("TAA", "ENABLED", "0".into()), ("BASIC", "ENABLED", "1".into())]);
        assert_eq!(get(&out, "BASIC", "ENABLED").as_deref(), Some("1"));
        assert_eq!(get(&out, "TAA", "ENABLED").as_deref(), Some("0"));
        assert_eq!(get(&out, "BASIC", "OTHER").as_deref(), Some("5"));
        assert!(out.contains("; commentaire"));
    }

    #[test]
    fn adds_missing_keys_and_sections() {
        let out = set_values(SAMPLE, &[("BASIC", "NEW", "9".into()), ("SSLR", "ENABLED", "1".into())]);
        // la clé ajoutée reste dans sa section (avant [TAA]) ; la nouvelle section arrive à la fin
        assert!(out.find("NEW=9").unwrap() < out.find("[TAA]").unwrap());
        assert_eq!(get(&out, "SSLR", "ENABLED").as_deref(), Some("1"));
        assert_eq!(get(&out, "TAA", "BLUR_NEW").as_deref(), Some("0.5"));
        // à partir de rien
        let fresh = set_values("", &[("A", "B", "1".into())]);
        assert_eq!(get(&fresh, "A", "B").as_deref(), Some("1"));
    }

    #[test]
    fn is_stable_when_applied_twice() {
        let updates = [("BASIC", "ENABLED", "1".to_string()), ("TAA", "BLUR_NEW", "0.2".to_string())];
        let once = set_values(SAMPLE, &[(updates[0].0, updates[0].1, updates[0].2.clone()), (updates[1].0, updates[1].1, updates[1].2.clone())]);
        let twice = set_values(&once, &[(updates[0].0, updates[0].1, updates[0].2.clone()), (updates[1].0, updates[1].1, updates[1].2.clone())]);
        assert_eq!(once, twice);
    }
}
