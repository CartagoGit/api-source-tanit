/**
 * Plugin namespace constants.
 *
 * The MCP server exposes tools as `${corePrefix}_${ns}_${tool.id}`,
 * e.g. `mcp-vertex_postman-exporter_generate`. The plugin's own
 * `ns` segment is `postman-exporter` (matches `package.json#name`),
 * but the historic short namespace baked into our tool names is
 * `postman`, so `server.registerTool` is called with the fully
 * qualified id `${NAMESPACE}_exporter_<id>` where NAMESPACE is the
 * short historical prefix.
 *
 * Keep this file the single source of truth: every tool imports the
 * constant from here so a rename happens in exactly one place.
 */

/** Short historical namespace prefix baked into the qualified tool name. */
export const NAMESPACE = "postman" as const;
