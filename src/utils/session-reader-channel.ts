// A dedicated reliable DataChannel keeps transcript traffic off the input queue.
const chunkSize = 8000;
const maxBytes = 8 * 1024 * 1024;
const encoder = new TextEncoder();

type Request = { method: string; id?: string; cursor?: string; query?: string };
type Pending = {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  parts: string[];
  total?: number;
  bytes: number;
};

function parse(event: MessageEvent) {
  if (typeof event.data !== 'string' || event.data.length > 65536) return;
  try {
    const value = JSON.parse(event.data);
    if (value && typeof value === 'object') return value;
  } catch {
    /* Ignore malformed frames. */
  }
}

export class ReaderClient {
  private pending = new Map<string, Pending>();
  private pushListeners = new Set<(data: any) => void>();
  private sequence = 0;
  private closed = false;

  constructor(
    private incoming: RTCDataChannel,
    private outgoing: RTCDataChannel,
    private onReset: () => void = () => {}
  ) {
    incoming.addEventListener('message', this.receive);
    incoming.addEventListener('close', this.dispose);
    outgoing.addEventListener('close', this.dispose);
  }

  onPush(listener: (data: any) => void): () => void {
    this.pushListeners.add(listener);
    return () => this.pushListeners.delete(listener);
  }

  request<T>(request: Request): Promise<T> {
    if (this.closed || this.outgoing.readyState !== 'open')
      return Promise.reject(new Error('会话通道尚未连接'));
    if (this.pending.size >= 3)
      return Promise.reject(new Error('正在读取，请稍后重试'));
    const id = String((this.sequence += 1));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(id, '读取超时，请重试'), 30000);
      this.pending.set(id, { resolve, reject, timer, parts: [], bytes: 0 });
      try {
        this.outgoing.send(JSON.stringify({ type: 'request', id, request }));
      } catch {
        this.fail(id, '会话通道已断开');
      }
    });
  }

  private fail(id: string, reason: string) {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.reject(new Error(reason));
  }

  private receive = (event: MessageEvent) => {
    const frame = parse(event);
    if (!frame) return;
    if (frame.type === 'push') {
      this.pushListeners.forEach((listener) => {
        try {
          listener(frame.data);
        } catch {
          /* ignore */
        }
      });
      return;
    }
    if (frame.type === 'reset') {
      this.pending.forEach((_value, id) => this.fail(id, '会话读取设置已更改'));
      this.onReset();
      return;
    }
    const pending = this.pending.get(frame.id);
    if (!pending) return;
    if (frame.type === 'error') {
      this.fail(
        frame.id,
        typeof frame.message === 'string'
          ? frame.message.slice(0, 240)
          : '读取失败'
      );
      return;
    }
    if (frame.type !== 'response') return;
    if (
      typeof frame.text !== 'string' ||
      frame.text.length > chunkSize ||
      !Number.isInteger(frame.total) ||
      frame.total < 1 ||
      frame.total > 1200 ||
      frame.index !== pending.parts.length ||
      (pending.total !== undefined && frame.total !== pending.total)
    ) {
      this.fail(frame.id, '会话数据不完整，请重试');
      return;
    }
    pending.total = frame.total;
    pending.bytes += encoder.encode(frame.text).length;
    if (pending.bytes > maxBytes) {
      this.fail(frame.id, '本页内容过大，请在原窗口查看');
      return;
    }
    pending.parts.push(frame.text);
    if (pending.parts.length === frame.total) {
      try {
        const result = JSON.parse(pending.parts.join(''));
        clearTimeout(pending.timer);
        this.pending.delete(frame.id);
        pending.resolve(result);
      } catch {
        this.fail(frame.id, '无法解析会话内容');
      }
    }
  };

  dispose = () => {
    if (this.closed) return;
    this.closed = true;
    this.incoming.removeEventListener('message', this.receive);
    this.incoming.removeEventListener('close', this.dispose);
    this.outgoing.removeEventListener('close', this.dispose);
    this.pushListeners.clear();
    this.pending.forEach((_value, id) => this.fail(id, '会话通道已断开'));
  };
}

export class ReaderHost {
  private queue = Promise.resolve();
  private queued = 0;
  private busy = false;
  private closed = false;
  private generation = 0;

  constructor(
    private incoming: RTCDataChannel,
    private outgoing: RTCDataChannel,
    private handle: (request: Request) => Promise<unknown>,
    private allowed: (method: string) => boolean
  ) {
    incoming.addEventListener('message', this.receive);
    incoming.addEventListener('close', this.dispose);
    outgoing.addEventListener('close', this.dispose);
  }

  reset() {
    this.generation += 1;
    if (!this.closed && this.outgoing.readyState === 'open')
      this.outgoing.send(JSON.stringify({ type: 'reset' }));
  }

  push(data: unknown) {
    if (this.closed || !this.allowed('status') || this.outgoing.readyState !== 'open')
      return;
    try {
      this.outgoing.send(JSON.stringify({ type: 'push', data }));
    } catch {
      /* ignore send failure */
    }
  }

  private receive = (event: MessageEvent) => {
    const frame = parse(event);
    if (
      frame?.type !== 'request' ||
      typeof frame.id !== 'string' ||
      !/^\d{1,12}$/.test(frame.id) ||
      !frame.request ||
      !['status', 'list', 'read', 'watch', 'unwatch'].includes(
        frame.request.method
      ) ||
      event.data.length > 4096
    )
      return;
    if (this.queued >= 3) {
      this.sendError(frame.id, '正在读取，请稍后重试');
      return;
    }
    const generation = this.generation;
    this.queued += 1;
    this.queue = this.queue
      .then(async () => {
        if (generation === this.generation)
          await this.respond(frame.id, frame.request);
      })
      .catch(() => {
        /* Closing a channel can race with send. */
      })
      .finally(() => {
        this.queued -= 1;
      });
  };

  private async respond(id: string, request: Request) {
    if (this.closed || !this.allowed('status')) return;
    if (this.busy) {
      this.sendError(id, '正在读取，请稍后重试');
      return;
    }
    this.busy = true;
    const generation = this.generation;
    const current = () =>
      !this.closed &&
      generation === this.generation &&
      this.allowed(request.method);
    try {
      if (!current()) throw new Error('请在电脑 PalmDesk 中开启「会话阅读」');
      const result = await this.handle(request);
      if (!current()) return;
      const text = JSON.stringify(result);
      if (encoder.encode(text).length > maxBytes)
        throw new Error('本页内容过大，请在原窗口查看');
      const total = Math.max(1, Math.ceil(text.length / chunkSize));
      const deadline = Date.now() + 25000;
      for (let index = 0; index < total; index += 1) {
        while (this.outgoing.bufferedAmount > 65536) {
          if (!current() || this.outgoing.readyState !== 'open') return;
          if (Date.now() > deadline) throw new Error('会话传输超时，请重试');
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
        if (!current() || this.outgoing.readyState !== 'open') return;
        this.outgoing.send(
          JSON.stringify({
            type: 'response',
            id,
            index,
            total,
            text: text.slice(index * chunkSize, (index + 1) * chunkSize),
          })
        );
      }
    } catch (error) {
      if (generation === this.generation)
        this.sendError(id, error instanceof Error ? error.message : '读取失败');
    } finally {
      this.busy = false;
    }
  }

  private sendError(id: string, message: string) {
    if (
      !this.closed &&
      this.allowed('status') &&
      this.outgoing.readyState === 'open'
    )
      this.outgoing.send(
        JSON.stringify({ type: 'error', id, message: message.slice(0, 240) })
      );
  }

  dispose = () => {
    this.closed = true;
    this.generation += 1;
    this.incoming.removeEventListener('message', this.receive);
    this.incoming.removeEventListener('close', this.dispose);
    this.outgoing.removeEventListener('close', this.dispose);
  };
}
