/** Compatibility facade: all clients read and write the shared core history. */
export { appendHistory, readHistory, clearHistory, formatHistoryJsonl, historyPath, userHistoryDir } from "../../core/session/history-run.service.js";
export type { IHistoryAppendResult } from "../../contracts/interfaces/cli/history.interface.js";
