import type { ICaptureSource, IRemoteWindow } from '@/pure-interface';

import { identifyAgent } from './agent-registry';

// Each authenticated peer can select only identities from its latest list.
export class WindowCatalog {
  private sources = new Map<string, ICaptureSource>();
  private contexts = new Map<string, string>();

  update(sources: ICaptureSource[]): IRemoteWindow[] {
    this.sources.clear();
    const contexts = new Map<string, string>();
    const windows = sources.map((source) => {
      const id = crypto.randomUUID();
      const identity = JSON.stringify([
        source.ownerPid,
        source.nativeId,
        source.id,
        source.bundleId,
      ]);
      const contextId = this.contexts.get(identity) || crypto.randomUUID();
      contexts.set(identity, contextId);
      this.sources.set(id, { ...source });
      return {
        id,
        contextId,
        agentId: identifyAgent(source.bundleId)?.id,
        name: source.name.slice(0, 1024),
        appName: (source.appName || source.bundleId).slice(0, 256),
        // One result per message stays below the DataChannel message limit.
        thumbnail: source.thumbnail.length <= 40000 ? source.thumbnail : '',
        appIcon: source.appIcon.length <= 8000 ? source.appIcon : '',
        isOnScreen: source.isOnScreen,
        ...(source.boundsSource ? { boundsSource: source.boundsSource } : {}),
      };
    });
    this.contexts = contexts;
    return windows;
  }

  get(id: string) {
    const source = this.sources.get(id);
    if (!source) throw new Error('窗口列表已更新，请刷新后重新选择');
    return source;
  }
}
