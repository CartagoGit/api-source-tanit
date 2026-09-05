/**
 * Fixed values the plugin shares with itself.
 */

/**
 * Version of the contract this plugin knows how to read.
 *
 * It must stay in lockstep with `GENERATE_REPORT_VERSION` in
 * `contracts/generate-report.interface.ts`. A test checks it: if
 * someone bumps one without the other, the plugin stops reading the
 * CLI and the gate catches it — instead of production.
 */
export const SUPPORTED_REPORT_VERSION = 3;
