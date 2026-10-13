import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { pageTimelineItems } from "../core/session-registry.mjs";
import {
  createSessionFileCatalog,
  mapWithConcurrency
} from "./session-file-catalog.mjs";
import { readSessionLines, readSessionText, SessionFileTooLargeError } from "./session-file-io.mjs";

export const WORKBUDDY_SESSION_PREFIX = "workbuddy:session-file:";
const SESSION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_TITLE_MAX_LENGTH = 96;
const SUMMARY_CONCURRENCY = 8;

export function resolveWorkBuddyHome(env = process.env) {
  return (
    env.WORKBUDDY_HOME ||
    env.WORKBUDDY_DATA_DIR ||
    path.join(os.homedir(), ".workbuddy-ai")
  );
}

export function isWorkBuddySessionFileSessionId(id) {
  return Boolean(sessionFileUuidFromWorkBuddyId(id));
}

export function workbuddySessionId(uuid) {
  return `${WORKBUDDY_SESSION_PREFIX}${uuid}`;
}

export function sessionFileUuidFromWorkBuddyId(id) {
  if (typeof id !== "string" || !id.startsWith(WORKBUDDY_SESSION_PREFIX)) {
    return null;
  }
  const candidate = id.slice(WORKBUDDY_SESSION_PREFIX.length);
  return SESSION_UUID_PATTERN.test(candidate) ? candidate : null;
}

export function extractWorkBuddyUserPrompt(rawText) {
  if (typeof rawText !== "string") return "";
  const queryMatch = /<user_query>([\s\S]*?)<\/user_query>/i.exec(rawText);
  if (queryMatch) {
    return queryMatch[1].trim();
  }
  const clean = rawText
    .replace(/<system-reminder[\s\S]*?<\/system-reminder>/gi, "")
    .trim();
  return clean || rawText.trim();
}

export function createWorkBuddySessionFileCatalog({
  workbuddyHome = resolveWorkBuddyHome(),
  summaryOnly = true,
  concurrency = SUMMARY_CONCURRENCY,
  statFile = stat
} = {}) {
  return createSessionFileCatalog({
    concurrency,
    statFile,
    loadContext: async () => {
      const files = await findWorkBuddySessionJsonlFiles(workbuddyHome);
      return { files };
    },
    discoverFiles: ({ files }) => files,
    loadFile: (filePath, { fileStat }) =>
      summaryOnly
        ? summarizeWorkBuddySessionFile(filePath, { fileStat })
        : parseWorkBuddySessionFile(filePath, { fileStat }),
    onFileError: (_error, filePath, { fileStat }) =>
      staleSessionForPath(filePath, { rawAvailable: false, fileStat })
  });
}

export async function findWorkBuddySessionJsonlFiles(workbuddyHome) {
  const projectsDir = path.join(workbuddyHome, "projects");
  let projectEntries;
  try {
    projectEntries = await readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const projectDirs = projectEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(projectsDir, entry.name));

  const jsonlLists = await mapWithConcurrency(
    projectDirs,
    SUMMARY_CONCURRENCY,
    async (projectDir) => {
      try {
        const files = await readdir(projectDir, { withFileTypes: true });
        return files
          .filter((file) => file.isFile() && file.name.endsWith(".jsonl"))
          .map((file) => path.join(projectDir, file.name));
      } catch {
        return [];
      }
    }
  );

  return jsonlLists.flat();
}

async function findSessionFileById(id, workbuddyHome) {
  const uuid = sessionFileUuidFromWorkBuddyId(id);
  if (!uuid) return null;
  const files = await findWorkBuddySessionJsonlFiles(workbuddyHome);
  return files.find((file) => path.basename(file, ".jsonl").toLowerCase() === uuid.toLowerCase()) ?? null;
}

export async function parseWorkBuddySessionFile(filePath, { fileStat, includeThinking = false } = {}) {
  const parsed = await readWorkBuddySessionRecords(filePath, { fileStat });
  return buildWorkBuddySession(parsed, { includeTimeline: true, includeThinking });
}

export async function summarizeWorkBuddySessionFile(filePath, { fileStat } = {}) {
  const parsed = await readWorkBuddySessionRecords(filePath, { fileStat });
  return buildWorkBuddySession(parsed, { includeTimeline: false });
}

export async function getWorkBuddySessionFileSession(id, options = {}) {
  const workbuddyHome = options.workbuddyHome ?? resolveWorkBuddyHome();
  const filePath = Object.hasOwn(options, "sessionFilePath")
    ? options.sessionFilePath
    : await findSessionFileById(id, workbuddyHome);
  if (!filePath) return null;

  try {
    const session = await parseWorkBuddySessionFile(filePath, {
      includeThinking: options.includeThinking ?? false
    });
    return session?.id === id ? session : null;
  } catch (error) {
    if (error instanceof SessionFileTooLargeError) throw error;
    const session = await staleSessionForPath(filePath, { rawAvailable: false });
    return session?.id === id ? session : null;
  }
}

export async function getWorkBuddySessionFileTimelinePage(id, options = {}) {
  const workbuddyHome = options.workbuddyHome ?? resolveWorkBuddyHome();
  const { limit, cursor, includeThinking = false } = options;
  const session = await getWorkBuddySessionFileSession(id, {
    workbuddyHome,
    includeThinking,
    ...(Object.hasOwn(options, "sessionFilePath")
      ? { sessionFilePath: options.sessionFilePath }
      : {})
  });
  return session ? pageTimelineItems(session.timeline, { limit, cursor }) : null;
}

export async function getRawWorkBuddySessionFile(id, options = {}) {
  const workbuddyHome = options.workbuddyHome ?? resolveWorkBuddyHome();
  const filePath = Object.hasOwn(options, "sessionFilePath")
    ? options.sessionFilePath
    : await findSessionFileById(id, workbuddyHome);
  if (!filePath) return null;

  try {
    return {
      text: await readSessionText(filePath),
      source: "session-file",
      confidence: "medium"
    };
  } catch {
    return null;
  }
}

async function readWorkBuddySessionRecords(filePath, { fileStat: knownFileStat } = {}) {
  const fileStat = knownFileStat ?? (await stat(filePath));
  const records = [];
  let parseErrors = 0;
  for await (const line of readSessionLines(filePath)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record && typeof record === "object" && !Array.isArray(record)) {
        records.push(record);
      } else {
        parseErrors += 1;
      }
    } catch {
      parseErrors += 1;
    }
  }

  return {
    filePath,
    fileUpdatedAt: fileStat.mtime.toISOString(),
    records,
    parseErrors,
    rawAvailable: true
  };
}

function buildWorkBuddySession(parsed, { includeTimeline = true, includeThinking = false } = {}) {
  const { filePath, fileUpdatedAt, records, parseErrors, rawAvailable } = parsed;
  const fileBaseUuid = path.basename(filePath, ".jsonl");
  const sessionUuid = records.find((r) => r.sessionId)?.sessionId || fileBaseUuid;
  const id = workbuddySessionId(sessionUuid);

  let aiTitle = null;
  let firstUserQuery = null;
  let lastUserQuery = null;
  let lastAssistantText = null;
  let projectPath = null;
  let lastTimestamp = null;
  let lastRecordType = null;
  let lastFunctionName = null;

  const timeline = [];
  const callsById = new Map();

  for (const record of records) {
    if (record.cwd && !projectPath) {
      projectPath = record.cwd;
    }
    if (record.timestamp) {
      lastTimestamp = record.timestamp;
    }
    lastRecordType = record.type;

    if (record.type === "ai-title" && record.aiTitle) {
      aiTitle = record.aiTitle;
    }

    const createdAt = record.timestamp
      ? new Date(record.timestamp).toISOString()
      : fileUpdatedAt;

    if (record.type === "message" && record.role === "user") {
      const rawText = Array.isArray(record.content)
        ? record.content.map((c) => c.text || "").join("\n")
        : typeof record.content === "string"
          ? record.content
          : "";
      const cleanPrompt = extractWorkBuddyUserPrompt(rawText);
      if (cleanPrompt) {
        if (!firstUserQuery) firstUserQuery = cleanPrompt;
        lastUserQuery = cleanPrompt;
      }

      if (includeTimeline && cleanPrompt) {
        timeline.push({
          id: String(record.id || timeline.length + 1),
          type: "message",
          role: "user",
          content: cleanPrompt,
          createdAt,
          sourceRefs: [{ kind: "session-file", path: filePath }]
        });
      }
    }

    if (record.type === "reasoning") {
      const rawText = Array.isArray(record.rawContent)
        ? record.rawContent.map((c) => c.text || "").join("\n")
        : "";
      if (includeTimeline && includeThinking && rawText) {
        timeline.push({
          id: String(record.id || timeline.length + 1),
          type: "thinking",
          role: "assistant",
          content: rawText,
          createdAt,
          sourceRefs: [{ kind: "session-file", path: filePath }]
        });
      }
    }

    if (record.type === "message" && record.role === "assistant") {
      const rawText = Array.isArray(record.content)
        ? record.content
            .filter((c) => c.type === "output_text")
            .map((c) => c.text || "")
            .join("\n")
        : typeof record.content === "string"
          ? record.content
          : "";
      if (rawText) {
        lastAssistantText = rawText;
      }

      if (includeTimeline && rawText) {
        timeline.push({
          id: String(record.id || timeline.length + 1),
          type: "message",
          role: "assistant",
          content: rawText,
          createdAt,
          sourceRefs: [{ kind: "session-file", path: filePath }]
        });
      }
    }

    if (record.type === "function_call") {
      lastFunctionName = record.name;
      const callId = record.callId || record.id || `call_${timeline.length + 1}`;
      let parsedArgs = record.arguments;
      if (typeof parsedArgs === "string") {
        try {
          parsedArgs = JSON.parse(parsedArgs);
        } catch {
          // Keep string arguments if JSON parse fails
        }
      }

      let item;
      if (record.name === "Bash" && typeof parsedArgs?.command === "string") {
        item = {
          id: callId,
          type: "command",
          createdAt,
          command: parsedArgs.command,
          cwd: parsedArgs.cwd || projectPath || "",
          exitCode: null,
          output: "",
          sourceRefs: [{ kind: "session-file", path: filePath }]
        };
      } else {
        item = {
          id: callId,
          type: "tool_call",
          createdAt,
          name: record.name || "tool",
          input: parsedArgs,
          output: undefined,
          status: "running",
          turnState: "unknown",
          sourceRefs: [{ kind: "session-file", path: filePath }]
        };
      }

      if (includeTimeline) {
        timeline.push(item);
      }
      callsById.set(callId, item);
    }

    if (record.type === "function_call_result") {
      const callId = record.callId;
      const existing = callsById.get(callId);
      let outputText = "";
      if (typeof record.output === "string") {
        outputText = record.output;
      } else if (record.output && typeof record.output === "object") {
        outputText = record.output.text || JSON.stringify(record.output, null, 2);
      } else if (Array.isArray(record.output)) {
        outputText = record.output.map((o) => o.text || JSON.stringify(o)).join("\n");
      }

      if (existing) {
        if (existing.type === "command") {
          existing.output = outputText;
          existing.exitCode = 0;
        } else {
          existing.output = outputText;
          existing.status = "complete";
        }
      }
    }
  }

  const title = (
    aiTitle ||
    (firstUserQuery ? firstUserQuery.slice(0, SESSION_TITLE_MAX_LENGTH) : null) ||
    path.basename(path.dirname(filePath)) ||
    "未命名会话"
  ).trim();

  let turnState = "idle";
  let statusDetail = undefined;
  if (lastRecordType === "reasoning") {
    turnState = "thinking";
    statusDetail = "思考中";
  } else if (lastRecordType === "function_call") {
    turnState = "executing_tool";
    statusDetail = lastFunctionName ? `正在调用工具: ${lastFunctionName}` : "工具调用中";
  } else if (lastRecordType === "message" && records[records.length - 1]?.role === "user") {
    turnState = "thinking";
    statusDetail = "正在处理请求";
  }

  const lastUpdatedAt = lastTimestamp
    ? new Date(lastTimestamp).toISOString()
    : fileUpdatedAt;

  return {
    id,
    source: "workbuddy",
    providerId: "workbuddy",
    title,
    projectPath: projectPath || path.dirname(filePath),
    lastUpdatedAt,
    recentMessage: lastAssistantText || lastUserQuery || title,
    quality: parseErrors > 0 ? "partial" : "full",
    turnState,
    statusDetail,
    sources: [{ kind: "session-file", path: filePath }],
    ...(includeTimeline ? { timeline } : {})
  };
}

async function staleSessionForPath(filePath, { rawAvailable = true, fileStat: knownStat } = {}) {
  const fileStat = knownStat ?? (await stat(filePath).catch(() => null));
  const fileBaseUuid = path.basename(filePath, ".jsonl");
  const fileUpdatedAt = fileStat?.mtime?.toISOString() ?? new Date().toISOString();
  return {
    id: workbuddySessionId(fileBaseUuid),
    source: "workbuddy",
    providerId: "workbuddy",
    title: path.basename(path.dirname(filePath)) || "不可用会话",
    projectPath: path.dirname(filePath),
    lastUpdatedAt: fileUpdatedAt,
    recentMessage: "会话文件无法完整解析",
    quality: "stale",
    turnState: "unknown",
    sources: [{ kind: "session-file", path: filePath }]
  };
}
