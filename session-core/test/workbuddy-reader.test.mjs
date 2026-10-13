import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createSessionReader } from '../index.mjs';
import {
  extractWorkBuddyUserPrompt,
  isWorkBuddySessionFileSessionId,
  resolveWorkBuddyHome,
  workbuddySessionId,
} from '../src/providers/workbuddy-session-file.mjs';

const uuid = '66666666-6666-4666-8666-666666666666';
const sessionId = workbuddySessionId(uuid);
const now = Date.parse('2026-10-12T12:00:00Z');

async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'palmdesk-workbuddy-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workbuddyHome = path.join(directory, 'workbuddy-home');
  const projectDir = path.join(workbuddyHome, 'projects', 'test-project-1');
  const sessionFile = path.join(projectDir, `${uuid}.jsonl`);
  await mkdir(projectDir, { recursive: true });

  const records = [
    {
      id: 'msg-1',
      timestamp: now,
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: '<system-reminder data-role="user-context">\nOS: win32\n</system-reminder>\n<user_query>今天天气怎么样？</user_query>',
        },
      ],
      sessionId: uuid,
      cwd: 'C:\\Users\\Administrator\\WorkBuddy AI\\test-project-1',
    },
    {
      id: 'title-1',
      timestamp: now + 100,
      type: 'ai-title',
      aiTitle: '天气咨询',
      sessionId: uuid,
    },
    {
      id: 'think-1',
      timestamp: now + 200,
      type: 'reasoning',
      rawContent: [{ type: 'reasoning_text', text: '正在思考查询哪个城市的天气' }],
      sessionId: uuid,
    },
    {
      id: 'call-1',
      timestamp: now + 300,
      type: 'function_call',
      callId: 'call_search_1',
      name: 'WebSearch',
      arguments: JSON.stringify({ query: '福州天气' }),
      sessionId: uuid,
    },
    {
      id: 'result-1',
      timestamp: now + 400,
      type: 'function_call_result',
      callId: 'call_search_1',
      name: 'WebSearch',
      output: { text: '晴，27度' },
      sessionId: uuid,
    },
    {
      id: 'call-bash',
      timestamp: now + 500,
      type: 'function_call',
      callId: 'call_bash_1',
      name: 'Bash',
      arguments: JSON.stringify({ command: 'echo hello' }),
      sessionId: uuid,
    },
    {
      id: 'result-bash',
      timestamp: now + 600,
      type: 'function_call_result',
      callId: 'call_bash_1',
      name: 'Bash',
      output: 'hello\n',
      sessionId: uuid,
    },
    {
      id: 'msg-2',
      timestamp: now + 700,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: '今天天气晴朗，气温 27 度。' }],
      sessionId: uuid,
    },
  ];

  await writeFile(sessionFile, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const reader = createSessionReader({
    workbuddyHome,
    codexHome: path.join(directory, 'no-codex'),
    claudeConfigDir: path.join(directory, 'no-claude'),
    claudeDesktopDataDir: '',
  });
  return { directory, workbuddyHome, sessionFile, reader };
}

test('extractWorkBuddyUserPrompt strips system-reminder and extracts user_query', () => {
  const withTag = '<system-reminder>Some context\nRules</system-reminder>\n<user_query>你好世界</user_query>';
  assert.equal(extractWorkBuddyUserPrompt(withTag), '你好世界');

  const withoutTag = '<system-reminder>Only reminder</system-reminder>直接提问内容';
  assert.equal(extractWorkBuddyUserPrompt(withoutTag), '直接提问内容');

  const plain = '普通提问';
  assert.equal(extractWorkBuddyUserPrompt(plain), '普通提问');
});

test('isWorkBuddySessionFileSessionId validates workbuddy session format', () => {
  assert.equal(isWorkBuddySessionFileSessionId(`workbuddy:session-file:${uuid}`), true);
  assert.equal(isWorkBuddySessionFileSessionId('claude-code:session-file:33333333-3333-4333-8333-333333333333'), false);
  assert.equal(isWorkBuddySessionFileSessionId('workbuddy:session-file:invalid'), false);
});

test('WorkBuddy reader lists sessions with ai-title, clean prompt and cwd', async (t) => {
  const { reader } = await setup(t);
  const list = await reader.list();
  assert.equal(list.total, 1);
  const session = list.sessions[0];
  assert.equal(session.id, sessionId);
  assert.equal(session.providerId, 'workbuddy');
  assert.equal(session.source, 'workbuddy');
  assert.equal(session.title, '天气咨询');
  assert.equal(session.recentMessage, '今天天气晴朗，气温 27 度。');
  assert.equal(session.projectPath, 'C:\\Users\\Administrator\\WorkBuddy AI\\test-project-1');
});

test('WorkBuddy reader paginates timeline with messages, tools, bash command and thinking', async (t) => {
  const { reader } = await setup(t);
  const page = await reader.read(sessionId, undefined, { includeThinking: true });
  assert.equal(page.session.title, '天气咨询');
  assert.ok(page.items.length >= 5);

  const userMsg = page.items.find((i) => i.role === 'user');
  assert.equal(userMsg.text, '今天天气怎么样？');

  const thinking = page.items.find((i) => i.type === 'thinking');
  assert.ok(thinking);
  assert.equal(thinking.text, '正在思考查询哪个城市的天气');

  const command = page.items.find((i) => i.type === 'command');
  assert.ok(command);
  assert.equal(command.text, 'echo hello');
  assert.equal(command.detail, 'hello\n');

  const tool = page.items.find((i) => i.type === 'tool_call');
  assert.ok(tool);
  assert.equal(tool.title, '工具 · WebSearch');

  const assistantMsg = page.items.find((i) => i.role === 'assistant' && i.type === 'message');
  assert.ok(assistantMsg);
  assert.equal(assistantMsg.text, '今天天气晴朗，气温 27 度。');
});

test('WorkBuddy reader detects active sessions from sessions/*.json heartbeats', async (t) => {
  const { reader, workbuddyHome } = await setup(t);
  const sessionsDir = path.join(workbuddyHome, 'sessions');
  await mkdir(sessionsDir, { recursive: true });

  const activePid = 12345;
  await writeFile(
    path.join(sessionsDir, `${activePid}.json`),
    JSON.stringify({
      pid: activePid,
      lastHeartbeat: Date.now(),
      sessionId: 'interactive-12345',
      cwd: 'C:\\Users\\Administrator\\WorkBuddy AI\\test-project-1',
      updatedAt: Date.now(),
    })
  );

  const list = await reader.list();
  assert.equal(list.sessions[0].status, 'running');
});
