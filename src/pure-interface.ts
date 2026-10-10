import type { AgentId } from './utils/agent-registry';

export interface IIpcRendererData {
  windowId: number;
  channel: any;
  requestId: string;
  data: any;
  code?: number;
  msg?: string;
}

export interface ICaptureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CaptureBoundsSource = 'window' | 'screen' | 'display' | 'unknown';

export interface ICaptureSource {
  id: string;
  /** Electron source ID, present only while the window is available for capture. */
  captureId?: string;
  isOnScreen: boolean;
  nativeId: number;
  ownerPid: number;
  bundleId: string;
  appName?: string;
  name: string;
  displayId?: string;
  thumbnail: string;
  appIcon: string;
  isAiTarget: boolean;
  /** @deprecated Use isAiTarget. Kept as a compatibility alias for older clients. */
  isCodex?: boolean;
  bounds: ICaptureBounds | null;
  boundsSource: CaptureBoundsSource;
  /** 将窗口边界转换为 nut.js 屏幕坐标时使用的缩放比例。 */
  inputScale: number;
}

export interface IRemoteWindow {
  id: string;
  contextId?: string;
  agentId?: AgentId;
  name: string;
  appName: string;
  thumbnail: string;
  appIcon: string;
  isOnScreen: boolean;
}

export interface IRemoteAgent {
  id: AgentId;
  name: string;
}

export interface RemoteInput {
  action:
    | 'move'
    | 'down'
    | 'up'
    | 'click'
    | 'doubleClick'
    | 'rightClick'
    | 'scroll'
    | 'text'
    | 'keysDown'
    | 'keysUp'
    | 'releaseAll'
    | 'resume';
  x?: number;
  y?: number;
  amount?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  text?: string;
  keys?: number[];
}
