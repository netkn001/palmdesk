const assert = require('node:assert/strict');
const { test } = require('node:test');
const loadSource = require('./load-source.cjs');

const access = { id: 'session', token: 'temporary-token', socketId: 'phone', peerId: 'host', offerer: false };
const config = (now) => ({ iceServers: [{ urls: 'turn:turn.test:3478', username: 'u', credential: 'p' }],
  expiresAt: now + 3600000, refreshAfter: now + 3300000 });

test('desktop defaults include API, signaling and the phone homepage; web stays same-origin', () => {
  const { serviceDefaults } = loadSource('src/utils/service-defaults.ts');
  assert.deepEqual(serviceDefaults('file:', 'null'), {
    api: 'https://palmdesk-hk-test.ziniaocloud.com/api', signaling: 'https://palmdesk-hk-test.ziniaocloud.com', client: 'https://palmdesk-hk-test.ziniaocloud.com/',
  });
  assert.deepEqual(serviceDefaults('https:', 'https://selfhost.test'), {
    api: '/api', signaling: 'https://selfhost.test', client: '',
  });
  assert.equal(serviceDefaults('http:', 'http://localhost:5173').signaling, 'http://localhost:5173');
});

test('client coalesces credential requests, refreshes early and rejects expired fallback', async (t) => {
  let now = 1000000;
  let calls = 0;
  let broken = false;
  t.mock.method(Date, 'now', () => now);
  const { RemoteSession } = loadSource('src/utils/network/remote-session.ts', {
    '@/api/turn': { fetchRemoteIce: async () => {
      calls++;
      if (broken) throw new Error('unavailable');
      return config(now);
    } },
  });
  const session = new RemoteSession(access);
  const first = await Promise.all([session.getConfig(), session.getConfig()]);
  assert.equal(calls, 1);
  assert.equal(first[0], first[1]);
  now += 1000000;
  assert.equal((await session.getConfig()).expiresAt, first[0].expiresAt);
  now = first[0].refreshAfter;
  broken = true;
  assert.equal((await session.getConfig()).expiresAt, first[0].expiresAt);
  now = first[0].expiresAt;
  await assert.rejects(session.getConfig(), /unavailable/);
  broken = false;
  assert.ok((await session.getConfig()).expiresAt > now);
  session.close();
  assert.equal(session.config, undefined);
});

test('closing a session aborts pending requests and prevents late credentials from being stored', async () => {
  let finish;
  let signal;
  const { RemoteSession } = loadSource('src/utils/network/remote-session.ts', {
    '@/api/turn': { fetchRemoteIce: (_token, value) => { signal = value; return new Promise((resolve) => { finish = resolve; }); } },
  });
  const session = new RemoteSession(access);
  const request = session.getConfig();
  session.close();
  assert.equal(signal.aborted, true);
  finish(config(Date.now()));
  await assert.rejects(request, /连接已结束/);
  assert.equal(session.config, undefined);
});

test('replacement sessions and socket disconnects remove tokens and queued candidates', () => {
  const registry = loadSource('src/utils/network/remote-session.ts', { '@/api/turn': {} });
  const old = registry.registerRemoteSession(access);
  old.candidates.push({ candidate: 'candidate' });
  const current = registry.registerRemoteSession({ ...access, id: 'next', token: 'new-token' });
  assert.equal(old.closed, true);
  assert.equal(old.candidates.length, 0);
  registry.removeRemoteSession('phone', 'host', 'session');
  assert.equal(registry.getRemoteSession('phone', 'host'), current);
  registry.clearRemoteSessions('phone');
  assert.equal(current.closed, true);
  assert.equal(registry.getRemoteSession('phone', 'host'), undefined);
});
