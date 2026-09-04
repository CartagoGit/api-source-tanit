/**
 * The fixed numbers and names that govern execution.
 *
 * Each one is read by more than one place, which is what makes them
 * a contract and not an internal detail: the value adjuster and the
 * test that checks it cannot each keep their own.
 */

/**
 * How many files are read in parallel when scanning.
 *
 * Not one (pointlessly slow) and not unbounded (a large project opens
 * thousands of descriptors and the OS starts refusing). Sixteen is
 * the measured point past which it stops improving.
 */
export const READ_CONCURRENCY = 16;

/**
 * How long `watch` waits before regenerating after a change.
 *
 * A save in an editor fires several events in quick succession;
 * without a debounce, the collection regenerates three times per
 * Ctrl+S.
 */
export const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Environment variable that constrains where the output can be written.
 *
 * Empty when a human invokes it: `--output-dir /wherever` is a legit
 * use. **The MCP plugin** sets this when invoking the CLI, because
 * there the path is chosen by an agent and a `../` would write
 * outside the project.
 *
 * The name is shared by whoever writes it (the plugin) and whoever
 * reads it (`ensureOutputDir`), so it lives where both can see it.
 */
export const CONTAINMENT_ROOT_VAR = "POSTMAN_CONTAIN_ROOT";
