export class MemoryRedis {
  rows = new Map();
  clock = 0;
  async get(key) {
    const row = this.rows.get(key);
    if (!row || row.expires <= this.clock) return null;
    return row.value;
  }
  async set(key, value, options = {}) {
    this.rows.set(key, { value, expires: this.clock + (options.PX || options.EX * 1000 || Infinity) });
    return 'OK';
  }
  async del(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.rows.delete(key);
  }
  async expire(key, seconds) {
    const row = this.rows.get(key);
    if (row) row.expires = this.clock + seconds * 1000;
  }
  async eval(_script, { keys, arguments: [seconds] }) {
    const n = Number(await this.get(keys[0])) + 1;
    const expires = this.rows.get(keys[0])?.expires;
    await this.set(keys[0], String(n), { PX: n === 1 ? Number(seconds) * 1000 : expires - this.clock });
    return n;
  }
}

export const flush = () => new Promise((resolve) => setImmediate(resolve));

export class TestSocket {
  data = {};
  connected = true;
  sent = [];
  handlers = new Map();
  connHandlers = new Map();
  conn = {
    on: (event, handler) => { this.connHandlers.set(event, handler); },
  };
  constructor(id) {
    this.id = id;
    this.handshake = { address: '127.0.0.1', headers: { 'x-real-ip': `ip-${id}` } };
  }
  on(event, handler) { this.handlers.set(event, handler); }
  emit(event, data) { this.sent.push({ event, data }); }
  async receive(event, data = {}) {
    this.handlers.get(event)?.({ data });
    await flush();
  }
  async receiveConn(event, data = {}) {
    this.connHandlers.get(event)?.(data);
    await flush();
  }
  last(event) { return this.sent.filter((message) => message.event === event).at(-1)?.data; }
  async disconnect() {
    this.connected = false;
    this.handlers.get('disconnect')?.();
    await flush();
  }
}
