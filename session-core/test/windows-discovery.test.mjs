import assert from 'node:assert/strict';
import { appendFile, cp, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createSessionReader } from '../index.mjs';
import { resolveCodexHome } from '../src/providers/codex-session-file.mjs';
import { resolveClaudeConfigDir } from '../src/providers/claude-session-file.mjs';
import { resolveClaudeDesktopDataDirs } from '../src/providers/claude-desktop-sessions.mjs';
import { resolveWorkBuddyHome } from '../src/providers/workbuddy-session-file.mjs';

const fixtures = fileURLToPath(new URL('fixtures/', import.meta.url));
const codexUuid = '11111111-1111-4111-8111-111111111111';
const claudeUuid = '33333333-3333-4333-8333-333333333333';
const desktopUuid = '44444444-4444-4444-8444-444444444444';
const workbuddyUuid = '55555555-5555-4555-8555-555555555555';
const desktopId = 'local_dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const now = Date.parse('2026-09-24T00:00:00Z');
function environment(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}
const message = (uuid, i) => JSON.stringify({
  sessionId: uuid, cwd: 'C:\\项目 空间\\PalmDesk', type: i % 2 ? 'assistant' : 'user',
  uuid: `message-${i}`, timestamp: new Date(now + i).toISOString(),
  message: { content: `Windows 回复 ${i}`, stop_reason: i % 2 ? 'end_turn' : null },
});
async function put(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}
async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'palmdesk-windows-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const codexHome = path.join(directory, '用户 空间', 'Codex data');
  const claudeConfigDir = path.join(directory, '用户 空间', 'Claude CLI');
  const claudeDesktopDataDir = path.join(directory, '用户 空间', 'Claude Desktop');
  const workbuddyHome = path.join(directory, '用户 空间', 'WorkBuddy data');
  const org = path.join(claudeDesktopDataDir, 'claude-code-sessions', 'aaaaaaaa', 'bbbbbbbb');
  const transcript = path.join(org, desktopId, '.claude', 'projects', 'C--项目-空间-PalmDesk', `${desktopUuid}.jsonl`);
  const workbuddySessionFile = path.join(workbuddyHome, 'projects', 'C--项目-空间-PalmDesk', `${workbuddyUuid}.jsonl`);
  await cp(path.join(fixtures, 'codex-home'), codexHome, { recursive: true });
  await cp(path.join(fixtures, 'claude-config'), claudeConfigDir, { recursive: true });
  await put(path.join(org, `${desktopId}.json`), JSON.stringify({
    sessionId: desktopId, cliSessionId: desktopUuid, cwd: 'C:\\项目 空间\\PalmDesk',
    title: 'Windows Desktop 标题', createdAt: now, lastActivityAt: now,
  }));
  await put(transcript, Array.from({ length: 85 }, (_, i) => message(desktopUuid, i)).join('\r\n') + '\r\n');
  await put(workbuddySessionFile, [
    JSON.stringify({ type: 'ai-title', aiTitle: 'Windows WorkBuddy 标题', timestamp: now }),
    JSON.stringify({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<system-reminder>sys</system-reminder>\n<user_query>你好</user_query>' }], timestamp: now }),
    JSON.stringify({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'WorkBuddy 回复' }], timestamp: now + 1 }),
  ].join('\r\n') + '\r\n');
  return { directory, codexHome, claudeConfigDir, claudeDesktopDataDir, workbuddyHome, transcript };
}

test('Windows default roots cover native CLI, unpackaged Desktop, packaged Desktop and third-party profiles', () => {
  assert.equal(resolveCodexHome({}), path.join(os.homedir(), '.codex'));
  assert.equal(resolveClaudeConfigDir({}), path.join(os.homedir(), '.claude'));
  assert.equal(resolveWorkBuddyHome({}), path.join(os.homedir(), '.workbuddy-ai'));
  const roaming = 'D:\\用户 空间\\Roaming';
  const local = 'D:\\用户 空间\\Local';
  const cache = path.win32.join(local, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache');
  assert.deepEqual(resolveClaudeDesktopDataDirs({ APPDATA: roaming, LOCALAPPDATA: local }, 'win32'), [
    path.win32.join(roaming, 'Claude'), path.win32.join(local, 'Claude-3p'), path.win32.join(roaming, 'Claude-3p'),
    path.win32.join(cache, 'Roaming', 'Claude'), path.win32.join(cache, 'Local', 'Claude-3p'), path.win32.join(cache, 'Roaming', 'Claude-3p'),
  ]);
  const defaults = resolveClaudeDesktopDataDirs({}, 'win32');
  assert.ok(defaults.includes(path.win32.join(os.homedir(), 'AppData', 'Roaming', 'Claude')));
  assert.ok(defaults.includes(path.win32.join(os.homedir(), 'AppData', 'Local', 'Claude-3p')));
});

test('environment overrides with spaces and non-ASCII paths discover all sources, history and partial appends', async (t) => {
  const roots = await setup(t);
  environment(t, {
    CODEX_HOME: roots.codexHome,
    CLAUDE_CONFIG_DIR: roots.claudeConfigDir,
    CLAUDE_USER_DATA_DIR: roots.claudeDesktopDataDir,
    WORKBUDDY_HOME: roots.workbuddyHome,
  });
  assert.equal(resolveCodexHome(), roots.codexHome);
  assert.equal(resolveClaudeConfigDir(), roots.claudeConfigDir);
  assert.equal(resolveWorkBuddyHome(), roots.workbuddyHome);
  assert.deepEqual(resolveClaudeDesktopDataDirs(), [roots.claudeDesktopDataDir]);
  const reader = createSessionReader();
  const list = await reader.list();
  assert.deepEqual([...new Set(list.sessions.map((s) => s.source))].sort(), ['claude-code', 'claude-desktop', 'codex', 'workbuddy']);
  assert.ok((await reader.read(`codex:session-file:${codexUuid}`)).items.length);
  assert.equal((await reader.read(`claude-code:session-file:${claudeUuid}`)).items.at(-1).text, 'Done.');
  assert.equal((await reader.read(`workbuddy:session-file:${workbuddyUuid}`)).items.at(-1).text, 'WorkBuddy 回复');
  assert.equal((await reader.read(`workbuddy:session-file:${workbuddyUuid}`)).session.title, 'Windows WorkBuddy 标题');
  const id = `claude-code:session-file:${desktopUuid}`;
  const latest = await reader.read(id);
  const older = await reader.read(id, latest.nextCursor);
  const oldest = await reader.read(id, older.nextCursor);
  assert.deepEqual([latest.items.length, older.items.length, oldest.items.length], [40, 40, 5]);
  assert.equal(latest.session.title, 'Windows Desktop 标题');
  assert.equal(latest.session.projectPath, 'C:\\项目 空间\\PalmDesk');
  assert.equal((await reader.list('Windows Desktop')).total, 1);
  const next = message(desktopUuid, 85);
  await appendFile(roots.transcript, next.slice(0, -4));
  assert.equal((await reader.read(id)).items.at(-1).text, 'Windows 回复 84');
  await appendFile(roots.transcript, next.slice(-4) + '\r\n');
  assert.equal((await reader.read(id)).items.at(-1).text, 'Windows 回复 85');
  for (const arbitrary of [roots.transcript, `C:\\Windows\\win.ini`, `..\\${desktopUuid}.jsonl`, `claude-code:session-file:${desktopUuid}:$DATA`]) {
    await assert.rejects(reader.read(arbitrary), /标识/);
  }
});

test('Windows discovers Desktop in each default location and deduplicates CLI and profile copies', { skip: process.platform !== 'win32' }, async (t) => {
  const roots = await setup(t);
  environment(t, { APPDATA: path.join(roots.directory, 'Roaming 数据'), LOCALAPPDATA: path.join(roots.directory, 'Local 数据'), CLAUDE_USER_DATA_DIR: undefined });
  const reader = createSessionReader({ codexHome: roots.codexHome, claudeConfigDir: roots.claudeConfigDir });
  for (const directory of resolveClaudeDesktopDataDirs()) {
    await cp(roots.claudeDesktopDataDir, directory, { recursive: true });
    assert.equal((await reader.list('Windows Desktop')).total, 1);
    assert.equal((await reader.read(`claude-code:session-file:${desktopUuid}`)).items.at(-1).text, 'Windows 回复 84');
    await rm(directory, { recursive: true });
    assert.equal((await reader.list('Windows Desktop')).total, 0);
  }
  for (const directory of resolveClaudeDesktopDataDirs()) await cp(roots.claudeDesktopDataDir, directory, { recursive: true });
  await cp(roots.transcript, path.join(roots.claudeConfigDir, 'projects', '-repo-glassline', `${desktopUuid}.jsonl`));
  assert.equal((await reader.list('Windows Desktop')).total, 1);
});

for (const relative of [
  ['claude-code-sessions', 'aaaaaaaa'],
  ['claude-code-sessions', 'aaaaaaaa', 'bbbbbbbb'],
  ['claude-code-sessions', 'aaaaaaaa', 'bbbbbbbb', desktopId],
  ['claude-code-sessions', 'aaaaaaaa', 'bbbbbbbb', desktopId, '.claude'],
  ['claude-code-sessions', 'aaaaaaaa', 'bbbbbbbb', desktopId, '.claude', 'projects'],
  ['claude-code-sessions', 'aaaaaaaa', 'bbbbbbbb', desktopId, '.claude', 'projects', 'C--项目-空间-PalmDesk'],
]) {
  test(`Desktop rejects junctions at ${relative.at(-1)} after a cached read`, async (t) => {
    const roots = await setup(t);
    const reader = createSessionReader(roots);
    const id = `claude-code:session-file:${desktopUuid}`;
    assert.equal((await reader.read(id)).session.source, 'claude-desktop');
    const linked = path.join(roots.claudeDesktopDataDir, ...relative);
    const outside = path.join(roots.directory, 'outside');
    await rename(linked, outside);
    await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(reader.read(id), /不存在/);
  });
}

for (const [source, subdirectory] of [['codexHome', 'sessions'], ['claudeConfigDir', 'projects'], ['claudeDesktopDataDir', 'claude-code-sessions']]) {
  test(`${source}: discovery does not follow a junction or symlink replacing the session root`, async (t) => {
    const roots = await setup(t);
    const root = path.join(roots[source], subdirectory);
    const outside = path.join(roots.directory, 'outside');
    const reader = createSessionReader(roots);
    const before = await reader.list();
    await rename(root, outside);
    await symlink(outside, root, process.platform === 'win32' ? 'junction' : 'dir');
    const list = await reader.list();
    const provider = { codexHome: 'codex', claudeConfigDir: 'claude-code', claudeDesktopDataDir: 'claude-desktop' }[source];
    for (const session of before.sessions.filter((s) => s.source === provider)) {
      // Codex may retain a stale index entry, but cannot expose the linked transcript.
      const page = await reader.read(session.id).catch(() => null);
      assert.ok(!page || page.items.every((item) => item.type === 'status'));
    }
    assert.ok(list.sessions.filter((s) => s.source === provider).every((s) => s.quality === 'stale'));
  });
}
