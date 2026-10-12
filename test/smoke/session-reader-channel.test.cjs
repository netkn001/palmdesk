const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./load-source.cjs');
const { ReaderClient, ReaderHost } = load('src/utils/session-reader-channel.ts');

class Channel extends EventTarget {
  readyState = 'open';
  bufferedAmount = 0;
  sent = [];
  send(text) {
    assert.equal(this.readyState, 'open');
    this.sent.push(text);
    queueMicrotask(() => this.target.dispatchEvent(new MessageEvent('message', { data: text })));
  }
  close() {
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
  }
}
function connection(t, handler, allowed = () => true) {
  const clientOut = new Channel();
  const hostIn = new Channel();
  const hostOut = new Channel();
  const clientIn = new Channel();
  clientOut.target = hostIn;
  hostOut.target = clientIn;
  let resets = 0;
  const client = new ReaderClient(clientIn, clientOut, () => { resets += 1; });
  const host = new ReaderHost(hostIn, hostOut, handler, allowed);
  t.after(() => { client.dispose(); host.dispose(); });
  return { client, host, hostOut, clientIn, resets: () => resets };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('large multilingual results are chunked under SCTP limits and reassembled exactly', async (t) => {
  const payload = { text: '中文🙂\n\u0000'.repeat(40000) };
  const h = connection(t, async () => payload);
  assert.deepEqual(await h.client.request({ method: 'read', id: 'fixture' }), payload);
  assert.ok(h.hostOut.sent.length > 10);
  assert.ok(h.hostOut.sent.every((text) => Buffer.byteLength(text) < 65536));
});

test('navigation requests queue behind an in-flight read without mixing replies', async (t) => {
  let unblock;
  const wait = new Promise((resolve) => { unblock = resolve; });
  const h = connection(t, async (request) => {
    if (request.id === 'first') await wait;
    return { id: request.id };
  });
  const first = h.client.request({ method: 'read', id: 'first' });
  const second = h.client.request({ method: 'read', id: 'second' });
  await tick();
  unblock();
  assert.deepEqual(await Promise.all([first, second]), [{ id: 'first' }, { id: 'second' }]);
});

test('revocation cancels a transfer under backpressure and clears the client immediately', async (t) => {
  let enabled = true;
  const h = connection(t, async () => ({ secret: 'content' }), (method) => method === 'status' || enabled);
  h.hostOut.bufferedAmount = 100000;
  const pending = h.client.request({ method: 'read', id: 'fixture' });
  const rejected = assert.rejects(pending, /设置已更改/);
  await tick();
  enabled = false;
  h.host.reset();
  await rejected;
  h.hostOut.bufferedAmount = 0;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(h.resets(), 1);
  assert.ok(h.hostOut.sent.every((text) => !text.includes('secret')));
  await assert.rejects(h.client.request({ method: 'read', id: 'fixture' }), /开启/);
});

test('unauthenticated requests never reach the desktop reader', async (t) => {
  let calls = 0;
  const h = connection(t, async () => { calls += 1; return {}; }, () => false);
  const pending = h.client.request({ method: 'status' });
  const rejected = assert.rejects(pending, /断开/);
  await tick();
  assert.equal(calls, 0);
  h.clientIn.close();
  await rejected;
});

test('out-of-order fragments fail rather than displaying a partial result', async (t) => {
  const h = connection(t, () => new Promise(() => {}));
  const pending = h.client.request({ method: 'read', id: 'fixture' });
  h.clientIn.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'response', id: '1', index: 1, total: 2, text: '{}' }) }));
  await assert.rejects(pending, /不完整/);
});

test('ReaderHost push delivers real-time incremental frames to ReaderClient onPush listener', async (t) => {
  const handled = [];
  const h = connection(t, async (request) => {
    handled.push(request);
    return { watched: true };
  });

  const pushes = [];
  const unlisten = h.client.onPush((data) => pushes.push(data));

  // Client sends watch request
  const watchResult = await h.client.request({ method: 'watch', id: 'session-123' });
  assert.deepEqual(watchResult, { watched: true });
  assert.equal(handled[0].method, 'watch');
  assert.equal(handled[0].id, 'session-123');

  // Host pushes an incremental frame
  const frame = { id: 'session-123', event: 'append', turnState: 'thinking' };
  h.host.push(frame);
  await tick();

  assert.equal(pushes.length, 1);
  assert.deepEqual(pushes[0], frame);

  // Unlisten removes callback
  unlisten();
  h.host.push({ id: 'session-123', event: 'append', turnState: 'idle' });
  await tick();
  assert.equal(pushes.length, 1);
});

