/**
 * Plugin namespace constants.
 *
 * The MCP server exposes tools as `${corePrefix}_${ns}_${tool.id}`,
 * e.g. `delendai_tanit_generate`. The plugin's own
 * `ns` segment is `tanit` (matches `package.json#name`),
 * but the historic short namespace baked into our tool names is
 * `tanit`, so `server.registerTool` is called with the fully
 * qualified id `${TANIT}_exporter_<id>` where TANIT is the
 * short historical prefix.
 *
 * Keep this file the single source of truth: every tool imports the
 * constant from here so a rename happens in exactly one place.
 */

/** Short historical namespace prefix baked into the qualified tool name. */
export const TANIT = "tanit" as const;
