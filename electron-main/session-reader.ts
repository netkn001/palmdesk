import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createSessionReader } from '../session-core/index.mjs';

export class DesktopSessionReader {
  private enabled = false;
  private generation = 0;
  private reader?: ReturnType<typeof createSessionReader>;
  private ready: Promise<void>;
  private saving = false;

  private watchers = new Map<string, () => void>();

  constructor(
    private directory: string,
    private platform = process.platform,
    private codexHome?: string,
    private claudeConfigDir?: string,
    private claudeDesktopDataDir?: string,
    private workbuddyHome?: string
  ) {
    this.enabled = this.supported;
    this.ready = this.load();
  }

  private get supported() {
    return this.platform === 'darwin' || this.platform === 'win32';
  }

  private clearWatchers() {
    this.watchers.forEach((unwatch) => {
      try {
        unwatch();
      } catch {
        /* ignore cleanup errors */
      }
    });
    this.watchers.clear();
  }

  private async load() {
    try {
      const content = await readFile(
        path.join(this.directory, 'session-reader.json'),
        'utf8'
      );
      const value = JSON.parse(content);
      this.enabled = value?.enabled === true && this.supported;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        this.enabled = this.supported;
      } else {
        this.enabled = false;
      }
    }
  }

  async settings() {
    await this.ready;
    return { enabled: this.enabled, supported: this.supported };
  }

  async configure(enabled: unknown) {
    await this.ready;
    if (typeof enabled !== 'boolean') throw new Error('无效的读取设置');
    if (!this.supported) throw new Error('会话阅读支持 macOS 和 Windows');
    if (this.saving) throw new Error('正在保存，请稍后重试');
    this.saving = true;
    this.generation += 1;
    this.enabled = false;
    this.clearWatchers();
    this.reader = undefined;
    try {
      await mkdir(this.directory, { recursive: true });
      const file = path.join(this.directory, 'session-reader.json');
      await writeFile(`${file}.tmp`, JSON.stringify({ enabled }), {
        mode: 0o600,
      });
      await rename(`${file}.tmp`, file);
      this.enabled = enabled;
      return await this.settings();
    } finally {
      this.saving = false;
    }
  }

  async request(
    data: {
      method?: unknown;
      id?: unknown;
      cursor?: unknown;
      query?: unknown;
    },
    onPush?: (update: unknown) => void
  ) {
    await this.ready;
    if (data.method === 'status') return await this.settings();
    if (!this.enabled) throw new Error('请在电脑 PalmDesk 中开启「会话阅读」');
    const generation = this.generation;
    this.reader ||= createSessionReader({
      codexHome: this.codexHome,
      claudeConfigDir: this.claudeConfigDir,
      claudeDesktopDataDir: this.claudeDesktopDataDir,
      workbuddyHome: this.workbuddyHome,
    });
    let result: unknown;
    if (data.method === 'list') {
      if (
        data.query !== undefined &&
        (typeof data.query !== 'string' || data.query.length > 200)
      )
        throw new Error('搜索内容过长');
      result = await this.reader.list(data.query as string | undefined);
    } else if (data.method === 'read') {
      result = await this.reader.read(
        data.id as string,
        data.cursor as string | undefined,
        { includeThinking: true }
      );
    } else if (data.method === 'watch') {
      if (typeof data.id !== 'string') throw new Error('无效的会话标识');
      this.watchers.get(data.id)?.();
      this.watchers.delete(data.id);
      const unwatch = await this.reader.watch(data.id, (update) => {
        if (this.enabled && generation === this.generation) {
          onPush?.(update);
        }
      });
      this.watchers.set(data.id, unwatch);
      result = { watched: true };
    } else if (data.method === 'unwatch') {
      if (typeof data.id === 'string') {
        this.watchers.get(data.id)?.();
        this.watchers.delete(data.id);
      }
      result = { watched: false };
    } else throw new Error('不支持的会话请求');
    if (!this.enabled || generation !== this.generation)
      throw new Error('会话读取已关闭');
    return result;
  }
}
