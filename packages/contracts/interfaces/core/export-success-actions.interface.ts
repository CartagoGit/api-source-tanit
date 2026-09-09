export interface ExportSuccessActionsPort {
  openFolder(path: string): Promise<void>;
  openPostman(): Promise<void>;
}