import { watchFile, unwatchFile } from 'node:fs';
import { createHash } from 'node:crypto';

import { createCodexProvider } from './src/providers/codex.mjs';
import { createClaudeCodeProvider } from './src/providers/claude-code.mjs';
import { createWorkBuddyProvider } from './src/providers/workbuddy.mjs';

const sessionIdPattern =
  /^(codex|claude-code|workbuddy):session-file:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const textLimit = 16384;

export function createSessionReader(options = {}) {
  // File-backed reads work without attaching to, resuming or executing an agent.
  const hasCustomOtherHomes =
    options.codexHome !== undefined ||
    options.claudeConfigDir !== undefined ||
    options.claudeDesktopDataDir !== undefined;
  const workbuddyHome =
    options.workbuddyHome !== undefined
      ? options.workbuddyHome
      : hasCustomOtherHomes
        ? ''
        : undefined;

  const providers = options.providers ?? [
    createCodexProvider({
      codexHome: options.codexHome,
      listAgentProcesses: () => Promise.resolve([]),
    }),
    createClaudeCodeProvider({
      claudeConfigDir: options.claudeConfigDir,
      claudeDesktopDataDir: options.claudeDesktopDataDir,
      listAgentProcesses: () => Promise.resolve([]),
    }),
    createWorkBuddyProvider({
      workbuddyHome,
    }),
  ];
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));

  async function listProvider(provider) {
    return (await provider.listSessions()).filter(
      (session) => sessionIdPattern.exec(session.id)?.[1] === provider.id
    );
  }

  const readerInstance = {
    async list(query = '') {
      const sessions = (await Promise.all(providers.map(listProvider))).flat();
      const search = String(query).trim().toLocaleLowerCase();
      const matches = sessions
        .map(summary)
        .filter((session) =>
          [session.title, session.projectPath, session.recentMessage].some(
            (value) => value.toLocaleLowerCase().includes(search)
          )
        )
        .sort(
          (a, b) =>
            b.lastUpdatedAt.localeCompare(a.lastUpdatedAt) ||
            a.id.localeCompare(b.id)
        );
      return { sessions: matches.slice(0, 100), total: matches.length };
    },

    async read(id, cursor, readOptions = {}) {
      if (typeof id !== 'string' || !sessionIdPattern.test(id))
        throw new Error('无效的会话标识');
      if (
        cursor !== undefined &&
        (typeof cursor !== 'string' || !/^\d{1,9}$/.test(cursor))
      )
        throw new Error('无效的历史位置');
      const provider = providerById.get(sessionIdPattern.exec(id)[1]);
      if (!provider) throw new Error('不支持的会话来源');
      const sessions = await listProvider(provider);
      const session = sessions.find((entry) => entry.id === id);
      if (!session) throw new Error('会话已不存在，请刷新列表');
      const page = await provider.getSessionTimelinePage(id, {
        limit: 40,
        cursor,
        includeThinking: readOptions.includeThinking ?? options.includeThinking ?? false,
      });
      if (!page) throw new Error('无法读取会话，请确认源文件仍然可用');
      return {
        session: summary(session),
        items: page.items.map(projectItem),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      };
    },

    async watch(id, onUpdate) {
      if (typeof id !== 'string' || !sessionIdPattern.test(id))
        throw new Error('无效的会话标识');
      const provider = providerById.get(sessionIdPattern.exec(id)[1]);
      if (!provider) throw new Error('不支持的会话来源');
      const session = await provider.getSession(id);
      const filePath = session?.sources?.find(
        (entry) => entry.kind === 'session-file'
      )?.path;
      if (!filePath) return () => {};

      let disposed = false;
      const listener = async (curr, prev) => {
        if (disposed) return;
        if ((curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size) && curr.size > 0) {
          try {
            const page = await readerInstance.read(id, undefined, {
              includeThinking: true,
            });
            if (!disposed && page) {
              onUpdate(page);
            }
          } catch {
            /* ignore transient concurrent write reads */
          }
        }
      };

      watchFile(filePath, { interval: 400 }, listener);
      return () => {
        disposed = true;
        unwatchFile(filePath, listener);
      };
    },
  };

  return readerInstance;
}

function summary(session) {
  return {
    id: session.id,
    providerId: sessionIdPattern.exec(session.id)[1],
    source:
      session.source === 'claude-desktop'
        ? 'claude-desktop'
        : sessionIdPattern.exec(session.id)[1],
    title: clip(session.title || '未命名会话', 160),
    projectPath: clip(session.projectPath, 512),
    lastUpdatedAt: clip(session.lastUpdatedAt, 40),
    recentMessage: clip(session.recentMessage, 300),
    quality: session.quality || 'partial',
    status: session.status || 'idle',
    turnState: session.turnState || 'unknown',
    statusDetail: session.statusDetail ? clip(session.statusDetail, 200) : undefined,
  };
}

function projectItem(item) {
  let title = '';
  let text = '';
  let detail = '';
  if (item.type === 'message') text = item.content;
  else if (item.type === 'thinking') {
    title = '思考过程';
    text = item.content;
  } else if (item.type === 'command') {
    title =
      typeof item.exitCode === 'number'
        ? `命令 · 退出码 ${item.exitCode}`
        : '命令';
    text = item.command;
    detail = item.output;
  } else if (item.type === 'tool_call') {
    title = `工具 · ${item.name}`;
    text = stringify(item.input);
    detail = stringify(item.output);
  } else if (item.type === 'file_change') {
    title = item.path;
    text = item.summary;
    detail = item.diff;
  } else {
    title = '状态';
    text = item.detail || item.status;
  }
  return {
    id: createHash('sha256').update(String(item.id)).digest('hex'),
    type: item.type,
    role: item.role,
    createdAt: clip(item.createdAt, 40),
    title: clip(title, 512),
    text: clip(text, textLimit),
    detail: clip(detail, textLimit),
    truncated:
      String(text ?? '').length > textLimit ||
      String(detail ?? '').length > textLimit,
  };
}

function clip(value, limit) {
  return String(value ?? '').slice(0, limit);
}

function stringify(value) {
  return typeof value === 'string'
    ? value
    : value === undefined
      ? ''
      : JSON.stringify(value, null, 2);
}
