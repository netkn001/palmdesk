import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { validateImage } from '../src/utils/image-payload';

import type { ICaptureSource, RemoteInput } from '../src/pure-interface';
import type { ImagePayload } from '../src/utils/image-payload';

function sameWindow(a: ICaptureSource, b: ICaptureSource) {
  return (
    a.id === b.id &&
    a.nativeId === b.nativeId &&
    a.ownerPid === b.ownerPid &&
    a.bundleId === b.bundleId
  );
}

export interface InputDriver {
  position: (point: { x: number; y: number }) => Promise<unknown>;
  buttonDown: (button: 'left' | 'right') => Promise<unknown>;
  buttonUp: (button: 'left' | 'right') => Promise<unknown>;
  click: (button: 'left' | 'right', double: boolean) => Promise<unknown>;
  scroll: (
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number
  ) => Promise<unknown>;
  text: (value: string, source: ICaptureSource) => Promise<unknown>;
  keysDown: (keys: number[]) => Promise<unknown>;
  keysUp: (keys: number[]) => Promise<unknown>;
  validKey: (key: number) => boolean;
  canPasteImage?: (source: ICaptureSource) => boolean;
  pasteImage?: (
    image: ImagePayload,
    source: ICaptureSource,
    current: () => boolean
  ) => Promise<unknown>;
}

export class InputUnavailableError extends Error {}

export function normalizedPoint(
  source: ICaptureSource,
  x: unknown,
  y: unknown
) {
  if (
    (source.boundsSource !== 'window' && source.boundsSource !== 'screen') ||
    !source.bounds
  )
    throw new Error('无法读取精确窗口边界，已停止输入');
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  )
    throw new Error('无效的鼠标坐标');
  const b = source.bounds;
  if (
    ![b.x, b.y, b.width, b.height].every(Number.isFinite) ||
    b.width < 1 ||
    b.height < 1
  )
    throw new Error('无效的窗口边界，已停止输入');
  return {
    x: Math.round(
      b.x + ((b.width - 1) * Math.max(0, Math.min(1000, x))) / 1000
    ),
    y: Math.round(
      b.y + ((b.height - 1) * Math.max(0, Math.min(1000, y))) / 1000
    ),
  };
}

export class CaptureSession {
  private generation = 0;
  private serial: Promise<unknown> = Promise.resolve();
  private active?: { id: string; source: ICaptureSource; inputError?: string };
  private keys = new Set<number>();
  private buttons = new Set<'left' | 'right'>();
  private imageJob?: { sessionId: string; id: number; cancelled: boolean };

  constructor(
    private driver: InputDriver,
    private list: () => Promise<ICaptureSource[]>,
    private focus: (source: ICaptureSource) => Promise<ICaptureSource>
  ) {}

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.serial.then(task);
    this.serial = result.catch(() => {});
    return result;
  }

  private async release(required = false) {
    const keys = [...this.keys];
    const buttons = [...this.buttons];
    this.keys.clear();
    this.buttons.clear();
    const releases = [
      ...(keys.length
        ? [
            {
              run: () => this.driver.keysUp(keys),
              retain: () => keys.forEach((key) => this.keys.add(key)),
            },
          ]
        : []),
      ...buttons.map((button) => ({
        run: () => this.driver.buttonUp(button),
        retain: () => this.buttons.add(button),
      })),
    ];
    const results = await Promise.allSettled(
      releases.map(({ run }) => Promise.resolve().then(run))
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') releases[index].retain();
    });
    if (required && results.some((result) => result.status === 'rejected'))
      throw new InputUnavailableError(
        '无法释放电脑上按下的键或鼠标按钮，请松开后手动重试'
      );
  }

  begin(
    sourceId: string,
    expectedSource?: Pick<ICaptureSource, 'ownerPid' | 'bundleId'>
  ) {
    this.generation += 1;
    const generation = this.generation;
    this.active = undefined;
    return this.enqueue(async () => {
      await this.release();
      let source = (await this.list()).find((item) => item.id === sourceId);
      if (generation !== this.generation) throw new Error('捕获请求已取消');
      if (
        !source ||
        (source.boundsSource !== 'window' &&
          source.boundsSource !== 'screen') ||
        !source.bounds
      )
        throw new Error('选定窗口已不可用');
      if (
        expectedSource &&
        (source.ownerPid !== expectedSource.ownerPid ||
          source.bundleId !== expectedSource.bundleId)
      )
        throw new Error('选定窗口身份已变化，请刷新窗口列表');
      if (!source.isOnScreen || !source.captureId) {
        if (source.boundsSource === 'screen') {
          throw new Error('选定屏幕当前不可用');
        }
        const focused = await this.focus(source);
        if (generation !== this.generation) throw new Error('捕获请求已取消');
        if (!sameWindow(source, focused)) throw new Error('选定窗口身份已变化');
        // Restored windows and desktop transitions can reach Electron's catalog later.
        const deadline = Date.now() + 2000;
        for (;;) {
          const current = (await this.list()).find(
            (item) => item.id === sourceId
          );
          if (generation !== this.generation) throw new Error('捕获请求已取消');
          if (!current) throw new Error('选定窗口已不可用');
          if (!sameWindow(source, current))
            throw new Error('选定窗口身份已变化');
          if (current.isOnScreen && current.captureId) {
            source = current;
            break;
          }
          if (Date.now() >= deadline)
            throw new Error('窗口尚未出现在当前桌面，无法启动捕获');
          await delay(100);
          if (generation !== this.generation) throw new Error('捕获请求已取消');
        }
      }
      normalizedPoint(source, 0, 0);
      this.active = { id: randomUUID(), source };
      return {
        sessionId: this.active.id,
        source,
        stream: { id: source.captureId! },
        imagePaste: !!this.driver.canPasteImage?.(source),
      };
    });
  }

  end(sessionId?: string) {
    if (sessionId && sessionId !== this.active?.id) return Promise.resolve();
    this.generation += 1;
    this.active = undefined;
    return this.enqueue(() => this.release());
  }

  async refresh() {
    const generation = this.generation;
    const active = this.active;
    try {
      const sources = await this.list();
      if (active && this.active === active && generation === this.generation) {
        const previous = active.source;
        const retained = sources.find(
          (source) =>
            sameWindow(source, previous) &&
            source.isOnScreen &&
            source.captureId === previous.captureId
        );
        if (retained) active.source = retained;
        else await this.end(active.id);
      }
      return { sources, sessionId: this.active?.id || '' };
    } catch (error) {
      if (generation === this.generation && this.active === active)
        await this.end(active?.id);
      throw error;
    }
  }

  cancelImagePaste(sessionId: string, id: number) {
    if (this.imageJob?.sessionId === sessionId && this.imageJob.id === id)
      this.imageJob.cancelled = true;
  }

  pasteImage(sessionId: string, id: number, image: ImagePayload) {
    if (this.imageJob) return Promise.reject(new Error('已有图片正在粘贴'));
    if (!Number.isSafeInteger(id) || id < 1)
      return Promise.reject(new Error('无效的图片请求'));
    const job = { sessionId, id, cancelled: false };
    this.imageJob = job;
    return this.enqueue(async () => {
      try {
        const active = this.active;
        const current = () =>
          !!active && this.active === active && !job.cancelled;
        if (!active || active.id !== sessionId || !current())
          throw new Error('远程控制会话已结束或图片粘贴已取消');
        if (
          !this.driver.canPasteImage?.(active.source) ||
          !this.driver.pasteImage
        )
          throw new Error('图片粘贴目前仅支持 macOS 或 Windows 上的 Codex');
        if (active.inputError)
          throw new InputUnavailableError(active.inputError);
        validateImage(image);
        await this.release(true);
        if (!current()) throw new Error('图片粘贴已取消');
        const source = await this.focus(active.source);
        if (!current()) throw new Error('图片粘贴已取消');
        if (!sameWindow(source, active.source) || !source.isOnScreen)
          throw new Error('目标窗口已变化，请重新连接');
        active.source = source;
        await this.driver.pasteImage(image, source, current);
      } finally {
        if (this.imageJob === job) this.imageJob = undefined;
      }
    });
  }

  input(sessionId: string, input: RemoteInput) {
    return this.enqueue(async () => {
      const active = this.active;
      if (!active || active.id !== sessionId)
        throw new Error('远程控制会话已结束');
      if (input.action === 'releaseAll') {
        await this.release();
        return;
      }
      if (active.inputError && input.action !== 'resume')
        throw new InputUnavailableError(active.inputError);
      try {
        const source = await this.focus(active.source);
        if (this.active !== active) throw new Error('目标窗口已失效');
        if (!sameWindow(source, active.source))
          throw new Error('目标窗口身份已变化');
        if (!source.isOnScreen) throw new Error('目标窗口当前不可见');
        active.source = source;
        if (input.action === 'resume') {
          active.inputError = undefined;
          return;
        }
        if (
          [
            'move',
            'down',
            'up',
            'click',
            'doubleClick',
            'rightClick',
            'scroll',
          ].includes(input.action)
        ) {
          await this.driver.position(normalizedPoint(source, input.x, input.y));
          if (this.active !== active) throw new Error('目标窗口已失效');
        }
        switch (input.action) {
          case 'move':
            break;
          case 'down':
            this.buttons.add('left');
            await this.driver.buttonDown('left');
            break;
          case 'up':
            await this.driver.buttonUp('left');
            this.buttons.delete('left');
            break;
          case 'click':
          case 'doubleClick':
          case 'rightClick':
            await this.driver.click(
              input.action === 'rightClick' ? 'right' : 'left',
              input.action === 'doubleClick'
            );
            break;
          case 'scroll':
            if (
              !['up', 'down', 'left', 'right'].includes(
                input.direction || ''
              ) ||
              !Number.isFinite(input.amount)
            )
              throw new Error('无效的滚动事件');
            await this.driver.scroll(
              input.direction!,
              Math.max(1, Math.min(1000, Math.round(Math.abs(input.amount!))))
            );
            break;
          case 'text':
            if (
              typeof input.text !== 'string' ||
              !input.text.length ||
              input.text.length > 4096
            )
              throw new Error('文字长度须为 1 至 4096');
            await this.driver.text(input.text, source);
            break;
          case 'keysDown':
          case 'keysUp': {
            if (
              !Array.isArray(input.keys) ||
              input.keys.length > 16 ||
              !input.keys.length ||
              !input.keys.every((key) => this.driver.validKey(key))
            )
              throw new Error('无效的键盘事件');
            if (input.action === 'keysDown') {
              input.keys.forEach((key) => this.keys.add(key));
              await this.driver.keysDown(input.keys);
            } else {
              await this.driver.keysUp(input.keys);
              input.keys.forEach((key) => this.keys.delete(key));
            }
            break;
          }
          default:
            throw new Error('不支持的输入事件');
        }
      } catch (error) {
        if (this.active === active) {
          if (error instanceof InputUnavailableError)
            active.inputError = error.message;
          else {
            this.active = undefined;
            this.generation += 1;
          }
        }
        await this.release();
        throw error;
      }
    });
  }
}
