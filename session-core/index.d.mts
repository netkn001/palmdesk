export interface ReaderSession {
  id: string;
  providerId: 'codex' | 'claude-code';
  source?: 'codex' | 'claude-code' | 'claude-desktop';
  title: string;
  projectPath: string;
  lastUpdatedAt: string;
  recentMessage: string;
  quality: string;
  turnState: string;
  statusDetail?: string;
}
export interface ReaderItem {
  id: string;
  type: string;
  role?: string;
  createdAt: string;
  title: string;
  text: string;
  detail: string;
  truncated: boolean;
}
export interface ReaderList {
  sessions: ReaderSession[];
  total: number;
}
export interface ReaderPage {
  session: ReaderSession;
  items: ReaderItem[];
  nextCursor?: string;
  hasMore: boolean;
}
export interface ReaderSettings {
  enabled: boolean;
  supported: boolean;
}
export function createSessionReader(options?: {
  codexHome?: string;
  claudeConfigDir?: string;
  claudeDesktopDataDir?: string;
}): {
  list(query?: string): Promise<ReaderList>;
  read(id: string, cursor?: string, options?: { includeThinking?: boolean }): Promise<ReaderPage>;
  watch(id: string, onUpdate: (page: ReaderPage) => void): Promise<() => void>;
};
