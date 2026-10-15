<template>
  <main class="controller-page">
    <header class="controller-header">
      <button
        type="button"
        title="断开并返回"
        aria-label="断开并返回"
        @click="disconnect"
      >
        <ArrowBackOutline />
      </button>
      <div class="heading">
        <h1>PalmDesk</h1>
        <span :title="selectedWindow?.name">{{
          (view === 'read' ? readingSession?.title : selectedWindow?.name) ||
          remoteDeskUserUuid ||
          '未连接电脑'
        }}</span>
      </div>
      <span
        class="status"
        :class="{ online: controlling, ready: connected && !controlling }"
        >{{
          error
            ? '已断开'
            : controlling
              ? inputError
                ? '控制已暂停'
                : '已连接'
              : selectedWindow || autoSelectFullScreen
                ? '正在加载'
                : connected
                  ? '选择 Agent'
                  : '正在连接'
        }}</span
      >
      <button
        v-if="selectedWindow"
        type="button"
        title="返回 Agent 入口"
        aria-label="返回 Agent 入口"
        @click="connect()"
      >
        <BrowsersOutline />
      </button>
      <details class="connection-options">
        <summary
          aria-label="连接设置"
          title="连接设置"
        >
          <OptionsOutline />
        </summary>
        <div class="options-panel">
          <RemoteVideoSettings
            :model-value="videoQuality"
            @update:model-value="updateQuality"
          />
          <span v-if="peer"
            >延迟 {{ Math.max(0, Math.round(peer.rtt)) }} ms</span
          >
        </div>
      </details>
    </header>
    <nav
      v-if="connected && !autoSelectFullScreen"
      class="view-tabs"
      aria-label="查看方式"
    >
      <button
        type="button"
        :aria-pressed="view === 'read'"
        @click="setView('read')"
      >
        阅读
      </button>
      <button
        type="button"
        :aria-pressed="view === 'window'"
        @click="setView('window')"
      >
        窗口
      </button>
      <span>{{ view === 'read' ? '回复与执行记录' : '监看与输入' }}</span>
    </nav>
    <SessionReader
      v-if="hasCredentials"
      v-show="view === 'read'"
      :key="readerEpoch"
      :client="readerClient"
      :revision="readerRevision"
      :active="visible && connected && view === 'read'"
      :window-name="
        readingSession &&
        sessionWindows[readingSession.id] === selectedWindow?.id
          ? selectedWindow?.name
          : undefined
      "
      @select="readingSession = $event"
      @available="readerAvailable"
      @open-window="goToWindow"
    />
    <div
      v-if="connected && view === 'window' && readingSession"
      class="reading-context"
    >
      <span
        >正在阅读：{{ readingSession.title }}。发送前请确认窗口中的任务。</span
      >
      <button
        v-if="
          selectedWindow &&
          sessionWindows[readingSession.id] !== selectedWindow.id
        "
        type="button"
        @click="associateWindow"
      >
        关联当前窗口
      </button>
      <span v-else-if="selectedWindow">已关联窗口</span>
    </div>
    <AgentPicker
      v-if="
        connected &&
        !selectedWindow &&
        !autoSelectFullScreen &&
        view === 'window'
      "
      :applications="agents"
      :sources="windows"
      :bindings="agentBindings"
      :device-id="remoteDeskUserUuid"
      :loading="windowsLoading"
      :disabled="windowStarting"
      :error="windowError"
      :discovery-error="discoveryError"
      :installed-agents="installedAgents"
      :installed-loading="installedLoading"
      :launch-supported="launchSupported"
      :launch-message="launchMessage"
      :opening-agent="openingAgent"
      :launch-error="launchError"
      :launched-agent="launchedAgent"
      @refresh="requestWindows"
      @select="selectWindow"
      @bind="bindAgentWindow"
      @launch="launchAgent"
    />
    <div
      v-if="controlling && inputError && view === 'window'"
      class="input-error"
      role="alert"
    >
      <span>{{ inputError }}</span>
      <button
        type="button"
        :disabled="retryingInput"
        @click="retryInput"
      >
        <RefreshOutline />{{ retryingInput ? '正在重试' : '重试控制' }}
      </button>
    </div>
    <RemoteViewport
      v-if="selectedWindow"
      v-show="view === 'window'"
      v-model:draft="draft"
      :video="peer?.videoEl"
      :connected="controlling"
      :input-blocked="
        !visible ||
        needsWindowResume ||
        view !== 'window' ||
        !!inputError ||
        retryingInput
      "
      :image-channel="peer?.imageChannel || undefined"
      :image-paste-session="selectedWindow.imagePasteSession"
      :commit-image-paste="commitImagePaste"
      :reconnect-image-channel="reconnectImageChannel"
      @behavior="sendBehavior"
    />
    <div
      v-if="!connected || (autoSelectFullScreen && !selectedWindow)"
      class="connection-message"
      role="status"
    >
      <span>{{ error || '正在连接电脑窗口…' }}</span>
      <button
        v-if="error && hasCredentials"
        type="button"
        @click="retryConnection"
      >
        重新连接
      </button>
      <button
        v-if="error"
        type="button"
        @click="disconnect"
      >
        返回
      </button>
    </div>
  </main>
</template>

<script setup lang="ts">
import {
  ArrowBackOutline,
  BrowsersOutline,
  OptionsOutline,
  RefreshOutline,
} from '@vicons/ionicons5';
import { getRandomString } from 'billd-utils';
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';

import AgentPicker from '@/components/AgentPicker/index.vue';
import RemoteVideoSettings from '@/components/RemoteVideoSettings/index.vue';
import RemoteViewport from '@/components/RemoteViewport/index.vue';
import SessionReader from '@/components/SessionReader/index.vue';
import { WINDOW_ID_ENUM } from '@/constant';
import { IPC_EVENT } from '@/event';
import { useRemoteVideoQuality } from '@/hooks/use-remoteVideoQuality';
import { useWebsocket } from '@/hooks/use-websocket';
import type { IRemoteAgent, IRemoteWindow } from '@/pure-interface';
import router, { routerName } from '@/router';
import { useAppStore } from '@/store/app';
import { useNetworkStore } from '@/store/network';
import type {
  WsBilldDeskBehaviorType,
  WsBilldDeskStartRemoteResult,
} from '@/types/websocket';
import {
  BilldDeskBehaviorEnum as Behavior,
  WsConnectStatusEnum,
  WsMsgTypeEnum,
} from '@/types/websocket';
import { ipcRenderer, ipcRendererSend } from '@/utils';
import { windowContext, type AgentBindings } from '@/utils/agent-directory';
import {
  AGENT_DEFINITIONS,
  getAgent,
  type AgentId,
} from '@/utils/agent-registry';
import { REMOTE_SESSION_ENDED_EVENT } from '@/utils/network/remote-session';
import { ControllerRecovery } from '@/utils/remote-presence';
import type { RemoteVideoQuality } from '@/utils/remote-video';
import { ReaderClient } from '@/utils/session-reader-channel';

import type { ReaderSession } from '../../../session-core/index.mjs';

const route = useRoute();
const networkStore = useNetworkStore();
const appStore = useAppStore();
const {
  initWs,
  deskUserUuid,
  deskUserPassword,
  remoteDeskUserUuid,
  remoteDeskUserPassword,
  connectStatus,
} = useWebsocket();
const roomId = ref('');
const receiverId = ref('');
const { videoQuality, setVideoQuality } = useRemoteVideoQuality();
const error = ref('');
const inputError = ref('');
const retryingInput = ref(false);
let resumeRequest = '';
let inputTimeout: ReturnType<typeof setTimeout>;
const hasCredentials = ref(false);
const visible = ref(!document.hidden);
const recovery = new ControllerRecovery();
const needsWindowResume = ref(false);
const draft = ref('');
const readerEpoch = ref(0);
const presenceRequests = new Set<string>();
const windows = ref<IRemoteWindow[]>([]);
const agents = ref<IRemoteAgent[]>([]);
const agentBindings = ref<AgentBindings>({});
const discoveryError = ref('');
const installedAgents = ref<IRemoteAgent[]>([]);
const installedLoading = ref(false);
let installedRequest = '';
let installedNeedsRetry = false;
let installedTimer: ReturnType<typeof setTimeout>;
const launchSupported = ref(false);
const launchMessage = ref('请更新电脑端 PalmDesk 以支持打开 Agent');
const openingAgent = ref<AgentId>();
const launchedAgent = ref<AgentId>();
const launchError = ref('');
let launchRequest = '';
let launchDeadline = 0;
let launchTimer: ReturnType<typeof setTimeout>;
let launchPollTimer: ReturnType<typeof setTimeout>;
const windowsLoading = ref(false);
const windowStarting = ref(false);
const windowError = ref('');
const selectedWindow = ref<{
  id: string;
  name: string;
  imagePasteSession?: string;
  resumeToken?: string;
}>();
const view = ref<'read' | 'window'>('read');
const readerClient = shallowRef<ReaderClient>();
const readerRevision = ref(0);
const readingSession = ref<ReaderSession>();
const sessionWindows = ref<Record<string, string>>({});
let choseView = false;
const autoSelectFullScreen = ref(false);
let associationRequest = '';
const videoReady = ref(false);
let listRequest = '';
let selectRequest = '';
let requestTimer: ReturnType<typeof setTimeout>;
let timeout: ReturnType<typeof setTimeout>;
let heartbeat: ReturnType<typeof setInterval>;
let hadPeer = false;
let leaving = false;
const peer = computed(() => networkStore.rtcMap.get(receiverId.value));
const mySocketId = computed(
  () => networkStore.wsMap.get(roomId.value)?.socketIo?.id || ''
);
const connected = computed(
  () =>
    peer.value?.peerConnection?.connectionState === 'connected' &&
    peer.value?.dataChannel?.readyState === 'open'
);
const controlling = computed(
  () =>
    connected.value &&
    !needsWindowResume.value &&
    !!selectedWindow.value &&
    videoReady.value
);

function setView(value: 'read' | 'window') {
  if (value === 'read' && openingAgent.value)
    finishAgentLaunch(
      '已暂停等待 Agent，请回到窗口刷新查看；打开请求不会自动重发'
    );
  releaseInput();
  choseView = true;
  view.value = value;
}
function readerAvailable(enabled: boolean) {
  if (!choseView) view.value = enabled ? 'read' : 'window';
}
function goToWindow() {
  setView('window');
}
function associateWindow() {
  if (readingSession.value && selectedWindow.value)
    sessionWindows.value[readingSession.value.id] = selectedWindow.value.id;
}
watch(
  [
    () => connected.value,
    () => peer.value?.readerChannel,
    () => peer.value?.readerChannel?.readyState,
    () => peer.value?.cbReaderChannel,
    () => peer.value?.cbReaderChannel?.readyState,
  ],
  () => {
    readerClient.value?.dispose();
    readerClient.value = undefined;
    const outgoing = peer.value?.readerChannel;
    const incoming = peer.value?.cbReaderChannel;
    if (
      connected.value &&
      outgoing?.readyState === 'open' &&
      incoming?.readyState === 'open'
    )
      readerClient.value = new ReaderClient(incoming, outgoing, () => {
        readerRevision.value += 1;
      });
  }
);

function cancelInstalledRequest(interrupted = true) {
  if (interrupted && installedRequest) {
    installedNeedsRetry = true;
    launchMessage.value = '读取已安装 Agent 已中断，请刷新重试';
  }
  clearTimeout(installedTimer);
  installedRequest = '';
  installedLoading.value = false;
}

function requestInstalledAgents() {
  if (
    installedRequest ||
    !visible.value ||
    !connected.value ||
    openingAgent.value
  )
    return;
  installedNeedsRetry = false;
  installedRequest = getRandomString(16);
  installedLoading.value = true;
  launchMessage.value = '';
  peer.value?.dataChannelSend({
    msgType: WsMsgTypeEnum.remoteInstalledAgentsRequest,
    requestId: installedRequest,
    data: {},
  });
  installedTimer = setTimeout(() => {
    cancelInstalledRequest(false);
    launchMessage.value =
      '读取已安装 Agent 超时，请刷新重试或更新电脑端 PalmDesk';
  }, 15000);
}

function requestWindows() {
  if (
    !visible.value ||
    !connected.value ||
    windowStarting.value ||
    launchRequest ||
    windowsLoading.value
  )
    return;
  clearTimeout(requestTimer);
  listRequest = getRandomString(16);
  windows.value = [];
  agents.value = [];
  discoveryError.value = '';
  windowsLoading.value = true;
  windowError.value = '';
  const fastFullScreen = autoSelectFullScreen.value;
  peer.value?.dataChannelSend({
    msgType: WsMsgTypeEnum.remoteWindowsRequest,
    requestId: listRequest,
    data: {
      agentDiscovery: !fastFullScreen,
      previews: !fastFullScreen && !openingAgent.value,
    },
  });
  if (!fastFullScreen && !openingAgent.value) requestInstalledAgents();
  requestTimer = setTimeout(() => {
    listRequest = '';
    windowsLoading.value = false;
    autoSelectFullScreen.value = false;
    windowError.value = '读取窗口列表超时，请刷新重试';
    if (openingAgent.value)
      finishAgentLaunch('读取窗口超时，请刷新查看 Agent 或重试');
  }, 15000);
}

function finishAgentLaunch(message = '') {
  clearTimeout(launchTimer);
  clearTimeout(launchPollTimer);
  launchRequest = '';
  openingAgent.value = undefined;
  launchError.value = message;
}

function launchAgent(id: AgentId) {
  if (
    !visible.value ||
    !connected.value ||
    windowsLoading.value ||
    windowStarting.value ||
    openingAgent.value ||
    !launchSupported.value ||
    !installedAgents.value.some((agent) => agent.id === id)
  )
    return;
  openingAgent.value = id;
  launchedAgent.value = undefined;
  launchError.value = '';
  windowError.value = '';
  launchRequest = getRandomString(16);
  peer.value?.dataChannelSend({
    msgType: WsMsgTypeEnum.remoteAgentLaunch,
    requestId: launchRequest,
    data: { id },
  });
  launchTimer = setTimeout(() => {
    finishAgentLaunch('打开 Agent 超时，应用可能已打开。请刷新查看后再重试');
    requestWindows();
  }, 30000);
}

function checkLaunchedWindows() {
  const id = openingAgent.value;
  if (!id || launchRequest) return;
  if (windowError.value) {
    finishAgentLaunch(windowError.value);
    return;
  }
  const matches = windows.value.filter((source) => source.agentId === id);
  if (matches.length) {
    finishAgentLaunch();
    launchedAgent.value = id;
    if (matches.length === 1) selectWindow(matches[0]);
  } else if (Date.now() >= launchDeadline) {
    finishAgentLaunch(
      'Agent 已打开，但未发现可用窗口。请重试打开，或在电脑上检查窗口和权限；Windows 请确认窗口位于当前桌面'
    );
  } else {
    launchPollTimer = setTimeout(requestWindows, 750);
  }
}
function bindAgentWindow(source: IRemoteWindow, agentId: AgentId | undefined) {
  const context = windowContext(source);
  if (agentId) agentBindings.value[context] = agentId;
  else delete agentBindings.value[context];
}
function selectWindow(source: IRemoteWindow) {
  if (
    !visible.value ||
    !connected.value ||
    windowsLoading.value ||
    windowStarting.value ||
    openingAgent.value
  )
    return;
  setView('window');
  associationRequest = readingSession.value?.id || '';
  clearTimeout(requestTimer);
  selectRequest = getRandomString(16);
  windowStarting.value = true;
  windowError.value = '';
  peer.value?.dataChannelSend({
    msgType: WsMsgTypeEnum.remoteWindowSelect,
    requestId: selectRequest,
    data: { id: source.id },
  });
  armWindowTimeout();
}

function armWindowTimeout() {
  clearTimeout(requestTimer);
  if (!visible.value) return;
  requestTimer = setTimeout(() => {
    if (!controlling.value) endConnection('打开窗口超时，请重新连接');
  }, 20000);
}

function resumeWindow() {
  if (
    !needsWindowResume.value ||
    !selectedWindow.value ||
    windowStarting.value ||
    !visible.value ||
    view.value !== 'window' ||
    !connected.value ||
    peer.value?.cbDataChannel?.readyState !== 'open'
  )
    return;
  const token = selectedWindow.value.resumeToken;
  if (!token) {
    selectedWindow.value = undefined;
    needsWindowResume.value = false;
    requestWindows();
    return;
  }
  selectRequest = getRandomString(16);
  windowStarting.value = true;
  peer.value!.dataChannelSend({
    msgType: WsMsgTypeEnum.remoteWindowSelect,
    requestId: selectRequest,
    data: { resumeToken: token },
  });
  armWindowTimeout();
}
function receiveWindowMessage(event: MessageEvent) {
  if (typeof event.data !== 'string' || event.data.length > 65536) return;
  let message: any;
  try {
    message = JSON.parse(event.data);
  } catch {
    return;
  }
  if (!message?.data || typeof message.data !== 'object') return;
  const { data } = message;
  if (
    message.msgType === WsMsgTypeEnum.remoteInstalledAgentsResult &&
    installedRequest &&
    message.requestId === installedRequest
  ) {
    cancelInstalledRequest(false);
    launchSupported.value = data.supported === true;
    installedAgents.value = AGENT_DEFINITIONS.filter(
      (agent) =>
        Array.isArray(data.agents) &&
        data.agents.some((item) => item?.id === agent.id)
    ).map(({ id, name }) => ({ id, name }));
    launchMessage.value = typeof data.message === 'string' ? data.message : '';
    return;
  }
  if (
    message.msgType === WsMsgTypeEnum.remoteAgentLaunchResult &&
    launchRequest &&
    message.requestId === launchRequest
  ) {
    clearTimeout(launchTimer);
    launchRequest = '';
    if (typeof data.error === 'string') {
      finishAgentLaunch(data.error);
      requestWindows();
    } else if (data.id === openingAgent.value) {
      launchDeadline = Date.now() + 15000;
      launchTimer = setTimeout(
        () => finishAgentLaunch('等待 Agent 窗口超时，请刷新查看或重试打开'),
        20000
      );
      requestWindows();
    } else finishAgentLaunch('无法确认打开结果，请刷新查看后再重试');
    return;
  }
  if (message.msgType === WsMsgTypeEnum.remoteSessionStopped) {
    endConnection('电脑已结束本次连接，请手动重新连接');
    return;
  }
  if (
    message.msgType === WsMsgTypeEnum.remoteControllerStateResult &&
    data.supported === true &&
    presenceRequests.delete(message.requestId)
  ) {
    recovery.acknowledge(Date.now());
    return;
  }
  if (
    message.msgType === WsMsgTypeEnum.remoteInputResult &&
    selectedWindow.value
  ) {
    if (typeof data.error === 'string' && data.error) {
      if (data.inputBlocked === true) inputError.value = data.error;
      else endConnection(data.error);
    }
    if (resumeRequest && message.requestId === resumeRequest) {
      clearTimeout(inputTimeout);
      resumeRequest = '';
      retryingInput.value = false;
      if (!data.error && data.inputBlocked === false) inputError.value = '';
    }
    return;
  }
  if (
    message.msgType === WsMsgTypeEnum.remoteWindowsResult &&
    listRequest &&
    message.requestId === listRequest
  ) {
    const source = data.source;
    const agent = getAgent(data.agent?.id);
    if (agent && !agents.value.some((item) => item.id === agent.id))
      agents.value.push({ id: agent.id, name: agent.name });
    if (typeof data.discoveryError === 'string')
      discoveryError.value = data.discoveryError;
    if (
      source &&
      ['id', 'name', 'appName', 'thumbnail', 'appIcon'].every(
        (key) => typeof source[key] === 'string'
      )
    )
      windows.value.push({
        ...source,
        agentId: getAgent(source.agentId)?.id,
        contextId:
          typeof source.contextId === 'string' ? source.contextId : undefined,
      });
    if (data.done) {
      clearTimeout(requestTimer);
      listRequest = '';
      windowsLoading.value = false;
      if (typeof data.error === 'string') windowError.value = data.error;
      const contexts = new Set(windows.value.map(windowContext));
      agentBindings.value = Object.fromEntries(
        Object.entries(agentBindings.value).filter(([context]) =>
          contexts.has(context)
        )
      );
      if (autoSelectFullScreen.value) {
        const screenWindow = windows.value.find(
          (item) => item.boundsSource === 'screen' || item.appName === '屏幕'
        );
        if (screenWindow) {
          windows.value = [];
          selectWindow(screenWindow);
          return;
        }
        autoSelectFullScreen.value = false;
      }
      checkLaunchedWindows();
    }
  } else if (
    message.msgType === WsMsgTypeEnum.remoteWindowSelected &&
    selectRequest &&
    message.requestId === selectRequest
  ) {
    clearTimeout(requestTimer);
    selectRequest = '';
    windowStarting.value = false;
    autoSelectFullScreen.value = false;
    if (typeof data.error === 'string') {
      if (needsWindowResume.value) {
        selectedWindow.value = undefined;
        needsWindowResume.value = false;
        sessionWindows.value = {};
        requestWindows();
      } else if (!windows.value.length) {
        requestWindows();
      }
      windowError.value = data.error;
    } else if (typeof data.id === 'string' && typeof data.name === 'string') {
      const imagePasteSession =
        typeof data.imagePasteSession === 'string' &&
        data.imagePasteSession.length <= 80
          ? data.imagePasteSession
          : undefined;
      selectedWindow.value = {
        id: data.id,
        name: data.name,
        imagePasteSession,
        resumeToken:
          typeof data.resumeToken === 'string' && data.resumeToken.length <= 80
            ? data.resumeToken
            : undefined,
      };
      needsWindowResume.value = false;
      // Edits made in the directory have no capture owner yet. Reapply them
      // once the host confirms selection, including after window recovery.
      sendQuality();
      if (imagePasteSession) peer.value?.openImageChannel();
      if (associationRequest)
        sessionWindows.value[associationRequest] = data.id;
      associationRequest = '';
      armWindowTimeout();
    }
  }
}

watch(
  () => peer.value?.cbDataChannel,
  (channel, previous) => {
    previous?.removeEventListener('message', receiveWindowMessage);
    channel?.addEventListener('message', receiveWindowMessage);
  }
);
watch(
  () => peer.value?.videoEl,
  (video, previous) => {
    previous?.removeEventListener('loadeddata', markVideoReady);
    videoReady.value = !!video && video.readyState >= 2;
    video?.addEventListener('loadeddata', markVideoReady);
  }
);
watch(
  () => peer.value?.peerConnection,
  (current, previous) => {
    if (previous && current !== previous && selectedWindow.value) {
      needsWindowResume.value = true;
      selectedWindow.value.imagePasteSession = undefined;
      windowStarting.value = false;
      selectRequest = '';
      sessionWindows.value = {};
    }
  }
);
function markVideoReady() {
  videoReady.value = true;
}
watch(controlling, (value) => {
  if (value) clearTimeout(requestTimer);
});
watch(
  [connected, () => peer.value?.cbDataChannel, view, visible],
  ([ready, channel, mode, isVisible]) => {
    if (
      mode !== 'window' ||
      !isVisible ||
      !ready ||
      !channel ||
      selectedWindow.value ||
      windowStarting.value
    )
      return;
    if (!listRequest && !windows.value.length) requestWindows();
    // A cached window list must not suppress recovery of an interrupted scan.
    if (installedNeedsRetry) requestInstalledAgents();
  }
);

function endConnection(message: string) {
  cancelInstalledRequest();
  if (openingAgent.value)
    finishAgentLaunch('连接已中断，请重新连接后刷新查看 Agent');
  recovery.stop();
  clearTimeout(timeout);
  clearTimeout(requestTimer);
  clearTimeout(inputTimeout);
  releaseInput();
  hadPeer = false;
  networkStore.removeAllWsAndRtc();
  appStore.remoteDesk.clear();
  selectedWindow.value = undefined;
  needsWindowResume.value = false;
  readingSession.value = undefined;
  readerEpoch.value += 1;
  error.value = message;
}

function connectionData() {
  return {
    roomId: roomId.value,
    sender: mySocketId.value,
    receiver: receiverId.value,
    deskUserUuid: deskUserUuid.value,
    deskUserPassword: deskUserPassword.value,
    remoteDeskUserUuid: remoteDeskUserUuid.value,
    remoteDeskUserPassword: remoteDeskUserPassword.value,
    ...videoQuality.value,
    audioContentHint: '',
  };
}
function onConnectionResult(result: WsBilldDeskStartRemoteResult['data']) {
  if (result.code !== 0) {
    endConnection(result.msg || '连接被拒绝');
    return;
  }
  if (!result.data) return;
  receiverId.value = result.data.receiver;
  appStore.remoteDesk.set(result.data.receiver, {
    ...result.data,
    sender: result.data.sender,
    isClose: false,
  });
}
function requestConnection() {
  const ws = networkStore.wsMap.get(roomId.value);
  ws?.socketIo?.off(
    WsMsgTypeEnum.billdDeskStartRemoteResult,
    onConnectionResult
  );
  ws?.socketIo?.on(
    WsMsgTypeEnum.billdDeskStartRemoteResult,
    onConnectionResult
  );
  ws?.send({
    requestId: getRandomString(8),
    msgType: WsMsgTypeEnum.billdDeskStartRemote,
    data: connectionData(),
  });
}
function connect(preserve = false) {
  if (!hasCredentials.value) return;
  finishAgentLaunch();
  cancelInstalledRequest();
  installedNeedsRetry = false;
  installedAgents.value = [];
  launchSupported.value = false;
  launchMessage.value = '请更新电脑端 PalmDesk 以支持打开 Agent';
  if (!preserve) recovery.reset(Date.now());
  recovery.started(Date.now());
  presenceRequests.clear();
  clearTimeout(timeout);
  clearTimeout(requestTimer);
  clearTimeout(inputTimeout);
  resumeRequest = '';
  inputError.value = '';
  retryingInput.value = false;
  releaseInput();
  networkStore.removeAllWsAndRtc();
  appStore.remoteDesk.clear();
  hadPeer = false;
  error.value = '';
  receiverId.value = '';
  needsWindowResume.value = preserve && !!selectedWindow.value;
  if (selectedWindow.value) selectedWindow.value.imagePasteSession = undefined;
  sessionWindows.value = {};
  if (!preserve) {
    selectedWindow.value = undefined;
    readingSession.value = undefined;
    readerEpoch.value += 1;
  }
  associationRequest = '';
  windows.value = [];
  windowsLoading.value = false;
  windowStarting.value = false;
  windowError.value = '';
  listRequest = '';
  selectRequest = '';
  videoReady.value = false;
  initWs({ roomId: roomId.value, isAnchor: false, isRemoteDesk: true });
  timeout = setTimeout(() => {
    if (!connected.value)
      error.value = '连接超时，请检查电脑窗口、服务地址和网络';
  }, 20000);
}
function sendBehavior(
  data: Partial<WsBilldDeskBehaviorType['data']>,
  requestId = getRandomString(8)
) {
  if (!visible.value && data.type !== Behavior.releaseAll) return;
  if (view.value !== 'window' && data.type !== Behavior.releaseAll) return;
  if (!controlling.value && data.type !== Behavior.releaseAll) return;
  if (
    (inputError.value || retryingInput.value) &&
    data.type !== Behavior.releaseAll &&
    data.type !== Behavior.resumeInput
  )
    return;
  peer.value?.dataChannelSend<WsBilldDeskBehaviorType['data']>({
    requestId,
    msgType: WsMsgTypeEnum.billdDeskBehavior,
    data: {
      roomId: roomId.value,
      sender: mySocketId.value,
      receiver: receiverId.value,
      x: 500,
      y: 500,
      amount: 0,
      key: [],
      ...data,
    } as WsBilldDeskBehaviorType['data'],
  });
}
function commitImagePaste(sessionId: string, id: number) {
  if (
    !controlling.value ||
    view.value !== 'window' ||
    inputError.value ||
    retryingInput.value ||
    sessionId !== selectedWindow.value?.imagePasteSession
  )
    throw new Error('窗口控制会话已结束');
  peer.value!.dataChannelSend({
    msgType: WsMsgTypeEnum.remoteImagePaste,
    requestId: getRandomString(16),
    data: { sessionId, id },
  });
}
function reconnectImageChannel() {
  if (!controlling.value || !selectedWindow.value?.imagePasteSession)
    throw new Error('请先连接 Codex 窗口');
  peer.value!.openImageChannel();
}
function retryInput() {
  if (!controlling.value || retryingInput.value) return;
  retryingInput.value = true;
  resumeRequest = getRandomString(16);
  sendBehavior({ type: Behavior.resumeInput }, resumeRequest);
  inputTimeout = setTimeout(() => {
    resumeRequest = '';
    retryingInput.value = false;
    inputError.value = '重试控制超时，请再次重试或重新连接';
  }, 10000);
}
function releaseInput() {
  sendBehavior({ type: Behavior.releaseAll });
}
function updateQuality(value: RemoteVideoQuality) {
  setVideoQuality(value);
  sendQuality();
}
function sendQuality() {
  (
    [
      [WsMsgTypeEnum.changeResolutionRatio, videoQuality.value.resolutionRatio],
      [WsMsgTypeEnum.changeMaxFramerate, videoQuality.value.maxFramerate],
      [WsMsgTypeEnum.changeMaxBitrate, videoQuality.value.maxBitrate],
      [
        WsMsgTypeEnum.changeVideoContentHint,
        videoQuality.value.videoContentHint,
      ],
    ] as const
  ).forEach(([msgType, val]) => {
    peer.value?.dataChannelSend({
      requestId: getRandomString(8),
      msgType,
      data: { val },
    });
  });
}
function disconnect() {
  leaving = true;
  recovery.stop();
  clearTimeout(requestTimer);
  clearTimeout(inputTimeout);
  releaseInput();
  networkStore.removeAllWsAndRtc();
  appStore.remoteDesk.clear();
  sessionStorage.removeItem('codex-remote-session');
  if (ipcRenderer)
    ipcRendererSend({
      windowId: WINDOW_ID_ENUM.webrtc,
      channel: IPC_EVENT.closeWindow,
      requestId: getRandomString(8),
      data: {},
    });
  else void router.replace({ name: routerName.remote });
}

function retryConnection() {
  recovery.reset(Date.now());
  connect(true);
}

function sendPresence() {
  if (leaving || peer.value?.dataChannel?.readyState !== 'open') return;
  const requestId = getRandomString(16);
  presenceRequests.add(requestId);
  if (presenceRequests.size > 8)
    presenceRequests.delete(presenceRequests.values().next().value!);
  peer.value.dataChannelSend({
    msgType: WsMsgTypeEnum.remoteControllerState,
    requestId,
    data: { visible: visible.value, video: view.value === 'window' },
  });
}

function checkRecovery() {
  if (leaving || !hasCredentials.value) return;
  if (recovery.retry(Date.now(), visible.value, connected.value)) connect(true);
  if (visible.value) sendPresence();
}

function visibilityChanged() {
  const returning = !visible.value && !document.hidden;
  visible.value = !document.hidden;
  if (!visible.value) {
    cancelInstalledRequest();
    if (openingAgent.value)
      finishAgentLaunch(
        '已暂停等待 Agent，请刷新查看窗口；打开请求不会自动重发'
      );
    releaseInput();
    listRequest = '';
    windowsLoading.value = false;
    clearTimeout(requestTimer);
    sendPresence();
    return;
  }
  if (returning) recovery.foreground(Date.now());
  checkRecovery();
  if (
    connected.value &&
    view.value === 'window' &&
    !selectedWindow.value &&
    !windowStarting.value
  )
    requestWindows();
  resumeWindow();
  if (
    selectRequest ||
    (selectedWindow.value && !needsWindowResume.value && !videoReady.value)
  )
    armWindowTimeout();
  void peer.value?.videoEl.play().catch(() => {});
}

function remoteSessionEnded(event: Event) {
  const data = (event as CustomEvent<{ peerId?: string; reason?: string }>)
    .detail;
  if (data?.peerId === receiverId.value && data.reason === 'explicit')
    endConnection('电脑已结束本次连接，请手动重新连接');
}

function pageHidden() {
  cancelInstalledRequest();
  if (openingAgent.value)
    finishAgentLaunch('已暂停等待 Agent，请刷新查看窗口；打开请求不会自动重发');
  visible.value = false;
  listRequest = '';
  windowsLoading.value = false;
  releaseInput();
  clearTimeout(requestTimer);
  sendPresence();
}

watch(
  [
    connected,
    view,
    () => peer.value?.cbDataChannel?.readyState,
    needsWindowResume,
  ],
  () => {
    sendPresence();
    resumeWindow();
  }
);
watch(connectStatus, (status) => {
  if (status === WsConnectStatusEnum.connect && !leaving) requestConnection();
});
watch(connected, (value) => {
  if (!value) cancelInstalledRequest();
  if (!value && openingAgent.value)
    finishAgentLaunch('连接已中断，请重新连接后刷新查看 Agent');
  if (value) {
    clearTimeout(timeout);
    error.value = '';
    hadPeer = true;
  }
});
watch(
  () => networkStore.rtcMap.size,
  (size) => {
    if (!size && hadPeer && !leaving)
      error.value ||= '连接已结束，目标窗口可能已关闭或不可用';
  }
);
onMounted(() => {
  document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener(REMOTE_SESSION_ENDED_EVENT, remoteSessionEnded);
  window.addEventListener('pagehide', pageHidden);
  window.addEventListener('pageshow', visibilityChanged);
  window.addEventListener('online', visibilityChanged);
  let saved: Record<string, any> = {};
  try {
    saved = JSON.parse(sessionStorage.getItem('codex-remote-session') || '{}');
  } catch {
    /* A stale tab starts at the connection form. */
  }
  const params = { ...saved, ...route.query };
  deskUserUuid.value = String(params.deskUserUuid || '');
  deskUserPassword.value = String(params.deskUserPassword || '');
  remoteDeskUserUuid.value = String(params.remoteDeskUserUuid || '');
  remoteDeskUserPassword.value = String(params.remoteDeskUserPassword || '');
  roomId.value = remoteDeskUserUuid.value;
  hasCredentials.value = Boolean(
    deskUserUuid.value &&
      deskUserPassword.value &&
      remoteDeskUserUuid.value &&
      remoteDeskUserPassword.value
  );
  if (!hasCredentials.value) {
    error.value = '连接信息已失效，请返回重新连接';
    return;
  }
  const fullScreen = params.fullScreen === true || params.fullScreen === '1';
  if (fullScreen) {
    autoSelectFullScreen.value = true;
    choseView = true;
    view.value = 'window';
  }
  sessionStorage.setItem(
    'codex-remote-session',
    JSON.stringify({
      deskUserUuid: deskUserUuid.value,
      deskUserPassword: deskUserPassword.value,
      remoteDeskUserUuid: remoteDeskUserUuid.value,
      remoteDeskUserPassword: remoteDeskUserPassword.value,
      ...(fullScreen ? { fullScreen: true } : {}),
    })
  );
  if (Object.keys(route.query).length)
    void router.replace({ name: routerName.webrtc });
  connect();
  heartbeat = setInterval(() => {
    checkRecovery();
    if (!visible.value) return;
    networkStore.wsMap.get(roomId.value)?.send({
      requestId: getRandomString(8),
      msgType: WsMsgTypeEnum.billdDeskUpdateUser,
      data: connectionData(),
    });
  }, 2000);
});
onUnmounted(() => {
  cancelInstalledRequest();
  finishAgentLaunch();
  document.removeEventListener('visibilitychange', visibilityChanged);
  window.removeEventListener(REMOTE_SESSION_ENDED_EVENT, remoteSessionEnded);
  window.removeEventListener('pagehide', pageHidden);
  window.removeEventListener('pageshow', visibilityChanged);
  window.removeEventListener('online', visibilityChanged);
  readerClient.value?.dispose();
  leaving = true;
  clearTimeout(timeout);
  clearTimeout(requestTimer);
  clearInterval(heartbeat);
  clearTimeout(inputTimeout);
  releaseInput();
  networkStore.removeAllWsAndRtc();
  appStore.remoteDesk.clear();
});
</script>

<style scoped lang="scss">
.view-tabs {
  display: flex;
  flex-shrink: 0;
  gap: 5px;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--pd-border);
  background: var(--pd-surface);
  button {
    border: 0;
    padding: 9px 22px;
    min-height: 40px;
    border-radius: var(--pd-radius-sm);
    background: transparent;
    color: var(--pd-muted);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    color: var(--pd-accent);
    background: var(--pd-accent-soft);
    font-weight: 600;
  }
  > span {
    margin-left: auto;
    font-size: 11px;
    color: var(--pd-muted);
  }
}
.reading-context {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  align-items: center;
  padding: 9px 14px;
  background: var(--pd-accent-soft);
  color: var(--pd-accent);
  font-size: 12px;
  line-height: 1.6;
  > span:first-child {
    flex: 1;
    overflow-wrap: anywhere;
  }
  button {
    flex-shrink: 0;
    color: inherit;
    font: inherit;
    padding: 8px;
    border: 1px solid rgb(22 138 58 / 20%);
    border-radius: var(--pd-radius-sm);
    background: var(--pd-surface);
    cursor: pointer;
  }
}
.input-error {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  color: var(--pd-danger);
  background: var(--pd-danger-soft);
  border-bottom: 1px solid rgb(255 125 137 / 24%);
  font-size: 13px;
  flex-shrink: 0;

  span {
    min-width: 0;
    flex: 1;
    overflow-wrap: anywhere;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    min-height: 36px;
    padding: 6px 10px;
    border: 1px solid currentColor;
    border-radius: var(--pd-radius-sm);
    background: var(--pd-surface);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
  }
  svg {
    width: 18px;
    height: 18px;
  }
}
.controller-page {
  position: relative;
  display: flex;
  height: 100dvh;
  min-height: 280px;
  flex-direction: column;
  color: var(--pd-text);
  background: var(--pd-bg);
}
.controller-header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
  padding: max(12px, env(safe-area-inset-top)) 16px 12px;
  border-bottom: 1px solid var(--pd-border);
  background: var(--pd-surface);
}
.controller-header > button {
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
  padding: 8px;
  border: 0;
  border-radius: var(--pd-radius-sm);
  background: var(--pd-surface-soft);
  color: var(--pd-text);
  cursor: pointer;
}
.controller-header svg {
  width: 22px;
  height: 22px;
}
.heading {
  min-width: 0;
}
.heading h1 {
  margin: 0;
  font-size: 18px;
  letter-spacing: -0.5px;
  line-height: 1.3;
}
.heading span {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--pd-muted);
}
.status {
  margin-left: auto;
  padding: 5px 9px;
  border-radius: var(--pd-radius-sm);
  background: var(--pd-surface-soft);
  font-size: 11px;
  color: var(--pd-danger);
  white-space: nowrap;
}
.status.online {
  color: var(--pd-accent);
}
.status.ready {
  color: var(--pd-muted);
}
.connection-options {
  position: relative;
}
.connection-options summary {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  cursor: pointer;
  list-style: none;
}
.connection-options summary::-webkit-details-marker {
  display: none;
}
.options-panel {
  position: absolute;
  right: 0;
  top: 46px;
  z-index: 5;
  width: 320px;
  max-height: calc(100dvh - 100px);
  overflow-y: auto;
  max-width: calc(100vw - 32px);
  padding: 16px;
  box-sizing: border-box;
  border: 1px solid var(--pd-border-strong);
  border-radius: var(--pd-radius-sm);
  background: var(--pd-surface);
  box-shadow: var(--pd-shadow-raised);
}
.options-panel > span {
  display: block;
  margin-top: 12px;
  font-size: 12px;
  color: var(--pd-muted);
}
.connection-message {
  position: absolute;
  top: 43%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 16px;
  width: max-content;
  max-width: calc(100% - 40px);
  box-sizing: border-box;
  border: 1px solid var(--pd-border-strong);
  border-radius: var(--pd-radius);
  box-shadow: var(--pd-shadow);
  background: var(--pd-surface);
  font-size: 14px;
}
.connection-message > span {
  flex-basis: 100%;
  text-align: center;
  line-height: 1.6;
}
.connection-message button {
  padding: 8px 12px;
  border: 1px solid var(--pd-accent);
  border-radius: var(--pd-radius-sm);
  color: var(--pd-accent);
  background: var(--pd-surface-soft);
  cursor: pointer;
}
</style>
