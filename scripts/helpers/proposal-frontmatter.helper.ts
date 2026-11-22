/**
 * Parsea el frontmatter YAML-like y devuelve los SHAs `shipped-in` o
 * `shippedIn`.
 *
 * Acepta dos formas (lo que aparece en el repo):
 *
 *   shipped-in:
 *     - cc134ce  # comentario
 *     - 3f6b533
 *
 *   shipped-in: [cc134ce, 3f6b533]
 *   shippedIn: [cc134ce, 3f6b533]  (legacy)
 *
 * Los valores malformados se conservan para que la comprobación de SHA
 * alcanzable los rechace; nunca se filtran junto a otro SHA válido.
 */
export function parseShippedIn(frontmatter: string): string[] {
  const lines = frontmatter.split(/\r?\n/);
  const out: string[] = [];
  const cleanValue = (value: string): string =>
    value.replace(/\s+#.*$/, "").trim().replace(/^["'`]|["'`]$/g, "").trim();

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(?:shipped-in|shippedIn):[ \t]*(.*)$/.exec(lines[index] ?? "");
    if (!match) continue;
    const value = cleanValue(match[1] ?? "");
    if (value.startsWith("[")) {
      const inline = /^\[([^\]]*)\]$/.exec(value);
      if (!inline) {
        out.push(value);
        continue;
      }
      const entries = (inline[1] ?? "").trim();
      if (entries) out.push(...entries.split(",").map(cleanValue).filter(Boolean));
      continue;
    }
    if (value) {
      out.push(value);
      continue;
    }

    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next] ?? "";
      if (!line.trim()) continue;
      if (!/^\s+/.test(line)) break;
      const item = /^\s+-\s*(.*?)\s*$/.exec(line);
      if (!item) {
        const malformed = cleanValue(line);
        if (malformed) out.push(malformed);
        continue;
      }
      const itemValue = cleanValue(item[1] ?? "");
      if (itemValue) out.push(itemValue);
    }
  }
  return out;
}
