<template>
  <main
    class="remote-wrap"
    :class="{ 'browser-controller': !ipcRenderer }"
  >
    <div class="container pd-page">
      <header class="page-heading pd-page-heading">
        <div>
          <span class="pd-eyebrow">远程工作</span>
          <h1>随时<span class="heading-accent">继续工作。</span></h1>
          <p>连接电脑，阅读会话，操作窗口。</p>
        </div>
        <span
          class="connection-state"
          :class="{
            online: connectStatus === WsConnectStatusEnum.connect,
            failed: initializationFailed,
          }"
          role="status"
        >
          <span aria-hidden="true"></span
          >{{
            initializationFailed
              ? '服务未连接'
              : connectStatus === WsConnectStatusEnum.connect
                ? '服务已连接'
                : '正在连接服务'
          }}</span
        >
      </header>
      <div
        v-if="ipcRenderer"
        class="local-device pd-card"
      >
        <div class="section-heading">
          <span class="section-icon"><LaptopOutline aria-hidden="true" /></span>
          <div>
            <h2 class="label">此设备</h2>
            <p>输入下方信息即可连接。</p>
          </div>
        </div>
        <div class="info">
          <div class="info-left">
            <div class="txt">设备代码</div>
            <div class="code-info">
              <div class="code">{{ cacheStore.deskUserUuid }}</div>
              <button
                class="ico copy"
                type="button"
                title="复制设备代码"
                aria-label="复制设备代码"
                @click="handleCopy(cacheStore.deskUserUuid)"
              >
                <CopyOutline />
              </button>
              <button
                class="ico refresh"
                type="button"
                title="重置设备代码"
                aria-label="重置设备代码"
                @click="handleResetDeskuuid"
              >
                <RefreshOutline />
              </button>
            </div>
          </div>
          <div class="info-right">
            <div class="txt">临时密码</div>
            <div class="code-info">
              <div class="code">
                {{ hidePwd ? '********' : cacheStore.deskUserPassword }}
              </div>
              <button
                class="ico copy"
                type="button"
                title="复制临时密码"
                aria-label="复制临时密码"
                @click="handleCopy(cacheStore.deskUserPassword)"
              >
                <CopyOutline />
              </button>
              <button
                class="ico eye"
                type="button"
                :title="hidePwd ? '显示临时密码' : '隐藏临时密码'"
                :aria-label="hidePwd ? '显示临时密码' : '隐藏临时密码'"
                :aria-pressed="!hidePwd"
                @click="hidePwd = !hidePwd"
              >
                <EyeOffOutline v-if="hidePwd" /><EyeOutline v-else />
              </button>
            </div>
          </div>
        </div>
      </div>
      <ConnectionQr
        v-if="ipcRenderer"
        :device="cacheStore.deskUserUuid"
        :password="cacheStore.deskUserPassword"
        :ready="deviceReady && connectStatus === WsConnectStatusEnum.connect"
        @settings="showUrlModal = true"
      />
      <div class="mobile-section-title">连接</div>
      <div class="remote-device pd-card">
        <div class="connection-heading">
          <div class="section-heading">
            <span class="section-icon"><LinkOutline aria-hidden="true" /></span>
            <div>
              <h2 class="label">连接电脑</h2>
              <p>继续工作。</p>
            </div>
          </div>
          <button
            v-if="!ipcRenderer"
            class="scan-button"
            type="button"
            title="扫码连接"
            aria-label="扫码连接"
            :disabled="loading || !!pendingInvite"
            @click="showScanModal = true"
          >
            <ScanOutline /><span>扫码连接</span>
          </button>
        </div>
        <label
          class="input-label"
          for="remote-device-code"
          >远程设备代码</label
        >
        <div class="info">
          <div
            v-on-click-outside="handleClickOutside"
            class="ipt-wrap"
            @keydown.esc="showLinkDeviceList = false"
          >
            <div
              ref="arrowDownRef"
              class="ipt-top"
            >
              <input
                id="remote-device-code"
                v-model="cacheStore.remoteDeskUserUuid"
                type="text"
                class="ipt"
                placeholder="输入 8 位设备代码"
                maxlength="8"
                aria-label="远程设备代码"
                inputmode="text"
                autocapitalize="none"
                :spellcheck="false"
                autocomplete="off"
                :disabled="loading || !!pendingInvite"
                @keydown.enter="startRemote()"
              />
              <button
                class="arrow-down"
                type="button"
                aria-label="最近连接的设备"
                :aria-expanded="showLinkDeviceList"
                aria-controls="recent-connections"
                :disabled="loading || !!pendingInvite"
                :class="{ active: showLinkDeviceList }"
                @click="showLinkDeviceList = !showLinkDeviceList"
              >
                <ChevronDownOutline />
              </button>
            </div>
            <div class="ipt-bottom">
              <div
                v-if="showLinkDeviceList"
                id="recent-connections"
                ref="linkDeviceListRef"
                class="link-device-list"
              >
                <div
                  v-for="(item, index) in cacheStore.linkDeviceList"
                  :key="index"
                  class="link-device-item"
                >
                  <button
                    class="left"
                    type="button"
                    @click="changeRemoteDeskUserUuid(item)"
                  >
                    <LaptopOutline />{{ item.remoteDeskUserUuid }}
                  </button>
                  <div class="right">
                    <button
                      class="del"
                      type="button"
                      :aria-label="`移除 ${item.remoteDeskUserUuid}`"
                      @click="handleDelLinkDeviceList(item)"
                    >
                      <CloseOutline />
                    </button>
                  </div>
                </div>
                <div
                  v-if="!cacheStore.linkDeviceList.length"
                  class="null"
                >
                  暂无记录
                </div>
              </div>
            </div>
          </div>
          <button
            class="btn pd-button"
            type="button"
            :class="{ gray: !cacheStore.remoteDeskUserUuid.length, loading }"
            :disabled="
              loading ||
              !deviceReady ||
              !!pendingInvite ||
              !cacheStore.remoteDeskUserUuid.length
            "
            @click="startRemote()"
          >
            <template v-if="!loading"
              >连接<ArrowForwardOutline aria-hidden="true"
            /></template>
            <template v-else><RefreshOutline class="loading" />连接中</template>
          </button>
        </div>
        <p class="connection-hint">
          <LockClosedOutline aria-hidden="true" />需要临时密码
        </p>
        <p
          v-if="pendingInvite"
          class="invite-status"
          role="status"
        >
          正在连接设备 {{ pendingInvite.device }}
        </p>
        <p
          v-if="connectionError"
          class="connection-error"
          role="alert"
        >
          {{ connectionError }}
        </p>
        <button
          v-if="connectionError && receivedInvite"
          class="retry-service"
          type="button"
          title="复制连接链接"
          aria-label="复制连接链接"
          @click="handleCopy(receivedInvite.url)"
        >
          <CopyOutline />
        </button>
        <button
          v-if="initializationFailed"
          class="retry-service"
          type="button"
          @click="windowReload"
        >
          <RefreshOutline />重连服务
        </button>
      </div>

      <section
        v-if="!ipcRenderer"
        class="workflow-guide"
        aria-label="连接后的工作方式"
      >
        <h2 class="guide-heading pd-eyebrow">桌面 → 掌心</h2>
        <div class="guide-items">
          <div>
            <span class="guide-icon"
              ><HardwareChipOutline aria-hidden="true"
            /></span>
            <h3>发现 Agent</h3>
            <p>找到已打开的应用</p>
          </div>
          <div>
            <span class="guide-icon"><ReaderOutline aria-hidden="true" /></span>
            <h3>阅读会话</h3>
            <p>查看回复与执行记录</p>
          </div>
          <div>
            <span class="guide-icon"
              ><BrowsersOutline aria-hidden="true"
            /></span>
            <h3>操作窗口</h3>
            <p>输入、点击与滚动</p>
          </div>
        </div>
      </section>

      <SessionReaderSettings
        v-if="ipcRenderer"
        @change="configureReader"
      />

      <div
        v-if="ipcRenderer"
        class="ai-target pd-card"
      >
        <div class="target-heading">
          <div>
            <h2 class="label">窗口</h2>
            <p class="target-hint">选择要查看的窗口。</p>
          </div>
          <button
            class="refresh-target"
            type="button"
            :disabled="captureLoading || appStore.remoteDesk.size > 0"
            @click="refreshCaptureSources"
          >
            <RefreshOutline aria-hidden="true" />
            {{ captureLoading ? '刷新中' : '刷新窗口' }}
          </button>
        </div>

        <div
          v-if="captureSources.length"
          class="capture-source-list"
        >
          <button
            v-for="source in captureSources"
            :key="source.id"
            class="capture-source"
            :class="{ selected: source.id === selectedCaptureSourceId }"
            type="button"
            :aria-pressed="source.id === selectedCaptureSourceId"
            :title="source.name"
            :disabled="appStore.remoteDesk.size > 0"
            @click="selectCaptureSource(source)"
          >
            <img
              v-if="source.thumbnail"
              class="capture-thumbnail"
              :src="source.thumbnail"
              :alt="source.name"
            />
            <span
              v-else
              class="capture-thumbnail capture-placeholder"
              ><BrowsersOutline aria-hidden="true"
            /></span>
            <span class="capture-source-name">{{ source.name }}</span>
            <span class="capture-source-meta">
              {{ source.appName || source.bundleId }}
              {{ source.isOnScreen ? '' : ' · 未在当前桌面显示' }}
            </span>
          </button>
        </div>
        <div
          v-else
          class="capture-empty"
        >
          没有可用的应用窗口
        </div>
        <div
          v-if="captureError"
          class="capture-error"
        >
          {{ captureError }}
        </div>
        <div
          v-else-if="selectedCaptureSource"
          class="capture-selected"
        >
          已选择：{{ selectedCaptureSource.name }}
          <span v-if="captureWarning">（{{ captureWarning }}）</span>
        </div>
      </div>

      <div
        v-if="ipcRenderer && permissions.platform === 'darwin'"
        class="permissions"
      >
        <div>
          <span>屏幕录制</span
          ><span>{{
            permissions.screen === 'granted' ? '已授权' : '未授权'
          }}</span
          ><button
            v-if="permissions.screen !== 'granted'"
            type="button"
            @click="openPermission('screen')"
          >
            打开设置
          </button>
        </div>
        <div>
          <span>辅助功能</span
          ><span>{{ permissions.accessibility ? '已授权' : '未授权' }}</span
          ><button
            v-if="!permissions.accessibility"
            type="button"
            @click="openPermission('accessibility')"
          >
            打开设置
          </button>
        </div>
      </div>

      <template v-if="!appStore.remoteDesk.size">
        <div
          v-if="ipcRenderer"
          class="tip"
        >
          等待手机连接并选择窗口
        </div>
        <details class="quality-settings">
          <summary>
            <OptionsOutline aria-hidden="true" /><span>连接画质</span
            ><span class="quality-caption">按需调整</span
            ><ChevronDownOutline
              class="quality-chevron"
              aria-hidden="true"
            />
          </summary>
          <div class="link-config">
            <RemoteVideoSettings
              :model-value="videoQuality"
              @update:model-value="setVideoQuality"
            />
            <div class="link-item">
              <n-space>
                <div class="link-label">音频内容：</div>
                <n-radio-group v-model:value="currentAudioContentHint">
                  <n-radio
                    v-for="item in audioContentHint"
                    :key="item.value"
                    :value="item.value"
                  >
                    {{ item.label }}
                  </n-radio>
                </n-radio-group>
              </n-space>
            </div>
          </div>
        </details>
      </template>

      <div
        v-else
        class="list"
      >
        <div
          v-for="(item, key) in appStore.remoteDesk"
          :key="key"
          class="item"
        >
          <span>正在被{{ item[1].deskUserUuid }}控制</span>
          <span
            class="del"
            @click="handleDel(item[1].sender)"
          >
            断开
          </span>
        </div>
      </div>
    </div>

    <div
      v-if="appStore.showDebug"
      class="debug-info"
    >
      <div>
        <span>窗口Id：</span>
        <span
          class="link"
          @click="handleCopy(WINDOW_ID_ENUM.remote)"
        >
          {{ WINDOW_ID_ENUM.remote }}
        </span>
        <span>，</span>
        <span>roomId：</span>
        <span
          class="link"
          @click="handleCopy(roomId)"
        >
          {{ roomId }}
        </span>
      </div>
      <div>
        <span>socketId：</span>
        <span
          class="link"
          @click="handleCopy(mySocketId)"
        >
          {{ mySocketId }}
        </span>
      </div>

      <div>
        <span>调试地址：</span>
        <input
          v-model="debugUrl"
          type="text"
        />
        <button @click="changeDebugUrl">确定</button>
      </div>
    </div>

    <UrlModal
      v-if="showUrlModal"
      @close="showUrlModal = false"
    />
    <ScanModal
      v-if="showScanModal"
      @close="showScanModal = false"
      @connect="handleScannedInvite"
    />
    <PwdModalCpt
      v-if="showPwdModalCpt"
      :uuid="cacheStore.remoteDeskUserUuid"
      :pwd="pwd"
      :err-msg="errMsg || connectionError"
      :busy="verifyingPassword"
      @close="handleClose"
      @confirm="handleConfirm"
    ></PwdModalCpt>
    <button
      v-if="!ipcRenderer"
      class="mobile-fab"
      type="button"
      title="添加连接"
      aria-label="添加连接"
      :disabled="loading || !!pendingInvite"
      @click="showScanModal = true"
    >
      <AddOutline />
    </button>
  </main>
</template>

<script lang="ts" setup>
import {
  AddOutline,
  ArrowForwardOutline,
  BrowsersOutline,
  ChevronDownOutline,
  CloseOutline,
  CopyOutline,
  EyeOffOutline,
  EyeOutline,
  HardwareChipOutline,
  LaptopOutline,
  LinkOutline,
  LockClosedOutline,
  OptionsOutline,
  ReaderOutline,
  RefreshOutline,
  ScanOutline,
} from '@vicons/ionicons5';
import { vOnClickOutside } from '@vueuse/components';
import { copyToClipBoard, getRandomString, windowReload } from 'billd-utils';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import {
  fetchDeskUserCreate,
  fetchDeskUserLinkVerify,
  fetchDeskUserLogin,
  fetchFindReceiverByUuid,
} from '@/api/deskUser';
import RemoteVideoSettings from '@/components/RemoteVideoSettings/index.vue';
import SessionReaderSettings from '@/components/SessionReaderSettings/index.vue';
import { WINDOW_ID_ENUM } from '@/constant';
import { IPC_EVENT } from '@/event';
import { useIpcRendererSend } from '@/hooks/use-ipcRendererSend';
import { useRemoteVideoQuality } from '@/hooks/use-remoteVideoQuality';
import { useRTCParams } from '@/hooks/use-rtcParams';
import { useTip } from '@/hooks/use-tip';
import { useWebsocket } from '@/hooks/use-websocket';
import { useWebRtcRemoteDesk } from '@/hooks/webrtc/remoteDesk';
import { IIpcRendererData } from '@/interface';
import type { ICaptureSource } from '@/pure-interface';
import router, { routerName } from '@/router';
import { useAppStore } from '@/store/app';
import { usePiniaCacheStore } from '@/store/cache';
import { useNetworkStore } from '@/store/network';
import {
  BilldDeskBehaviorEnum,
  WsBilldDeskBehaviorType,
  WsBilldDeskStartRemote,
  WsBilldDeskStartRemoteResult,
  WsChangeAudioContentHintType,
  WsChangeMaxBitrateType,
  WsChangeMaxFramerateType,
  WsChangeResolutionRatioType,
  WsChangeVideoContentHintType,
  WsConnectStatusEnum,
  WsMsgTypeEnum,
} from '@/types/websocket';
import {
  createNullVideo,
  ipcRenderer,
  ipcRendererInvoke,
  ipcRendererOn,
  ipcRendererSend,
  setAudioTrackContentHints,
  setVideoTrackContentHints,
} from '@/utils';
import { runAgentLaunch } from '@/utils/agent-launch-request';
import { CaptureLifecycle } from '@/utils/capture-lifecycle';
import {
  type ConnectionInvite,
  createConnectionInvite,
  parseConnectionInvite,
} from '@/utils/connection-invite';
import {
  decideCredentialAction,
  normalizeInstanceId,
} from '@/utils/host-identity';
import { ImageTransferHost } from '@/utils/image-transfer-channel';
import { getClientUrl } from '@/utils/localStorage/app';
import { WebRTCClass } from '@/utils/network/webRTC';
import { VideoActivityLease } from '@/utils/remote-presence';
import {
  REMOTE_VIDEO_DEFAULTS,
  applyRemoteVideoConstraints,
  desktopCaptureConstraints,
} from '@/utils/remote-video';
import { ReaderHost } from '@/utils/session-reader-channel';
import { WindowCatalog } from '@/utils/window-catalog';
import { WindowResumeStore } from '@/utils/window-resume';
import ConnectionQr from '@/views/remote/connectionQr.vue';
import PwdModalCpt from '@/views/remote/pwdModal.vue';
import ScanModal from '@/views/remote/scanModal.vue';
import UrlModal from '@/views/setting/urlModal.vue';

const route = useRoute();
const appStore = useAppStore();
const networkStore = useNetworkStore();
const cacheStore = usePiniaCacheStore();
// Visibility belongs to this page, never to the persisted device settings.
const hidePwd = ref(true);

watch(
  () => [cacheStore.deskUserUuid, cacheStore.deskUserPassword],
  () => {
    hidePwd.value = true;
  },
  { flush: 'sync' }
);

const { updateWebRtcRemoteDeskConfig, webRtcRemoteDesk } =
  useWebRtcRemoteDesk();
const { initWs, connectStatus, deskUserUuid, deskUserPassword } =
  useWebsocket();
const { audioContentHint } = useRTCParams();
const { videoQuality, setVideoQuality } = useRemoteVideoQuality({
  followSavedPreference: true,
});
const { handleRtcBilldDeskBehavior } = useIpcRendererSend();

const currentMaxBitrate = ref<number>(REMOTE_VIDEO_DEFAULTS.maxBitrate);
const currentMaxFramerate = ref<number>(REMOTE_VIDEO_DEFAULTS.maxFramerate);
const currentResolutionRatio = ref<number>(
  REMOTE_VIDEO_DEFAULTS.resolutionRatio
);
const currentVideoContentHint = ref<string>(
  REMOTE_VIDEO_DEFAULTS.videoContentHint
);
const currentAudioContentHint = ref(audioContentHint.value[0].value);
const roomId = ref('');
const receiverId = ref('');
const anchorStream = ref<MediaStream>();
/** 是否控制别人 */
const isControlOther = ref(false);
const loading = ref(false);
const deviceReady = ref(false);
const initializationFailed = ref(false);
const connectionError = ref('');
const pendingInvite = ref<ConnectionInvite>();
const receivedInvite = ref<ConnectionInvite>();
const showScanModal = ref(false);
const showUrlModal = ref(false);
const verifyingPassword = ref(false);
let disposed = false;
const showPwdModalCpt = ref(false);
const showLinkDeviceList = ref(false);
const arrowDownRef = ref();
const linkDeviceListRef = ref();
const pwd = ref('');
const errMsg = ref('');
const captureSessionId = ref('');
const captureLifecycle = new CaptureLifecycle();
const windowCatalogs = new Map<string, WindowCatalog>();
const windowResumes = new WindowResumeStore();
const activityLeases = new WeakMap<RTCDataChannel, VideoActivityLease>();
const stoppedPeers = new WeakSet<RTCDataChannel>();
let captureResumeToken = '';
const listingPeers = new Set<string>();
const readerHosts = new Map<RTCDataChannel, ReaderHost>();
const imageHosts = new Map<RTCDataChannel, ImageTransferHost>();
let imagePasteSession = '';
let readerEnabled = false;

function bindImages(peer: WebRTCClass) {
  const channel = peer.imageChannel;
  if (!channel || imageHosts.has(channel)) return;
  const allowed = (sessionId: string) =>
    !!ipcRenderer &&
    !!sessionId &&
    sessionId === imagePasteSession &&
    sessionId === captureSessionId.value &&
    peer.receiver === captureOwner &&
    !!anchorStream.value &&
    !stoppedPeers.has(peer.cbDataChannel!) &&
    activityLeases.get(peer.cbDataChannel!)?.active !== false &&
    appStore.remoteDesk.has(peer.receiver) &&
    !appStore.remoteDesk.get(peer.receiver)?.isClose &&
    networkStore.rtcMap.get(peer.receiver)?.imageChannel === channel;
  const host = new ImageTransferHost(
    channel,
    allowed,
    async (sessionId, id, image) => {
      if (!allowed(sessionId)) throw new Error('窗口控制会话已结束');
      const result = await invokeCapture(IPC_EVENT.pasteImage, {
        sessionId,
        id,
        image,
      });
      if (result?.code !== 0) throw new Error(result?.msg || '图片粘贴失败');
    },
    (sessionId, id) => {
      void invokeCapture(IPC_EVENT.cancelImagePaste, { sessionId, id }).catch(
        () => {}
      );
    }
  );
  imageHosts.set(channel, host);
  channel.addEventListener(
    'close',
    () => {
      host.dispose();
      imageHosts.delete(channel);
    },
    { once: true }
  );
}

function configureReader(enabled: boolean) {
  readerEnabled = enabled;
  readerHosts.forEach((host) => host.reset());
}

function receiveControllerState(
  peer: WebRTCClass,
  data: any,
  requestId: string
) {
  const channel = peer.cbDataChannel!;
  let lease = activityLeases.get(channel);
  if (!lease) {
    lease = new VideoActivityLease((active) => {
      void peer.setVideoActive(active);
      if (!active && captureOwner === peer.receiver && captureSessionId.value) {
        imageHosts.forEach((host) => host.reset());
        void handleRtcBilldDeskBehavior(
          WINDOW_ID_ENUM.remote,
          {
            type: BilldDeskBehaviorEnum.releaseAll,
          } as WsBilldDeskBehaviorType['data'],
          captureSessionId.value
        )?.catch(() => {});
      }
    });
    activityLeases.set(channel, lease);
    channel.addEventListener(
      'close',
      () => {
        lease!.dispose();
        activityLeases.delete(channel);
      },
      { once: true }
    );
  }
  if (lease.receive(data))
    peer.dataChannelSend({
      msgType: WsMsgTypeEnum.remoteControllerStateResult,
      requestId,
      data: { supported: true },
    });
}

function bindReader(peer: WebRTCClass) {
  const incoming = peer.cbReaderChannel;
  const outgoing = peer.readerChannel;
  if (!incoming || !outgoing || readerHosts.has(incoming)) return;
  const current = () =>
    !!ipcRenderer &&
    !stoppedPeers.has(peer.cbDataChannel!) &&
    appStore.remoteDesk.has(peer.receiver) &&
    !appStore.remoteDesk.get(peer.receiver)?.isClose &&
    networkStore.rtcMap.get(peer.receiver)?.cbReaderChannel === incoming;
  const host = new ReaderHost(
    incoming,
    outgoing,
    async (request) => {
      const result = await invokeCapture(
        IPC_EVENT.sessionReaderRequest,
        request
      );
      if (result?.code !== 0) throw new Error(result?.msg || '无法读取会话');
      return result.data;
    },
    (method) => current() && (method === 'status' || readerEnabled)
  );
  readerHosts.set(incoming, host);
  incoming.addEventListener(
    'close',
    () => {
      host.dispose();
      readerHosts.delete(incoming);
    },
    { once: true }
  );
}
let windowSelection: symbol | undefined;
let captureOwner = '';
let captureGeneration = 0;
const permissions = ref({
  platform: '',
  screen: 'unknown',
  accessibility: false,
  targetApps: [] as string[],
});
const captureSources = ref<ICaptureSource[]>([]);
const selectedCaptureSourceId = ref('');
const captureLoading = ref(false);
const captureError = ref('');
const captureWarning = ref('');
const captureRefreshTimer = ref<ReturnType<typeof setInterval>>();
const loopBilldDeskUpdateUserTimer = ref();
const suspend = ref('');
const resume = ref('');
const debugUrl = ref('');
const position = ref({ x: 0, y: 0 });
const mySocketId = computed(() => {
  return networkStore.wsMap.get(roomId.value)?.socketIo?.id || '';
});
const selectedCaptureSource = computed(() => {
  return captureSources.value.find(
    (source) => source.id === selectedCaptureSourceId.value
  );
});

onUnmounted(() => {
  imageHosts.forEach((host) => host.dispose());
  imageHosts.clear();
  readerHosts.forEach((host) => host.dispose());
  readerHosts.clear();
  disposed = true;
  pendingInvite.value = undefined;
  clearInterval(loopBilldDeskUpdateUserTimer.value);
  clearInterval(captureRefreshTimer.value);
  stopCaptureStream();
});

onMounted(() => {
  void handleInit();
});

watch(
  () => route.fullPath,
  () => {
    if (!Object.prototype.hasOwnProperty.call(route.query, 'connect')) return;
    let invite: ConnectionInvite | undefined;
    try {
      invite = parseConnectionInvite(window.location.href);
    } catch (cause) {
      connectionError.value = (cause as Error).message;
    }
    // Consume even malformed invitations without keeping credentials in history.
    void router.replace({ name: routerName.remote, query: {} });
    if (invite && !ipcRenderer && !loading.value) {
      queueInvite(invite);
    }
  },
  { immediate: true }
);

watch([deviceReady, connectStatus, pendingInvite], () => {
  if (
    !disposed &&
    deviceReady.value &&
    connectStatus.value === WsConnectStatusEnum.connect &&
    pendingInvite.value &&
    !loading.value
  ) {
    const invite = pendingInvite.value;
    pendingInvite.value = undefined;
    cacheStore.remoteDeskUserUuid = invite.device;
    void startRemote(invite.password);
  }
});

function queueInvite(invite: ConnectionInvite) {
  connectionError.value = '';
  showLinkDeviceList.value = false;
  cacheStore.remoteDeskUserUuid = invite.device;
  receivedInvite.value = invite;
  pendingInvite.value = invite;
}

function handleScannedInvite(invite: ConnectionInvite) {
  showScanModal.value = false;
  const target = new URL(invite.url);
  if (
    target.origin !== location.origin ||
    target.pathname !== location.pathname
  ) {
    window.location.assign(invite.url);
    return;
  }
  queueInvite(invite);
}

const handleClickOutside: any = [
  () => {
    if (showLinkDeviceList.value) {
      showLinkDeviceList.value = false;
    }
  },
  { ignore: [arrowDownRef] },
];

watch(
  () => networkStore.rtcMap,
  (newval) => {
    newval.forEach((item) => {
      bindReader(item);
      bindImages(item);
      if (!item.cbDataChannel) return;
      // const setting = anchorStream.value?.getVideoTracks()[0].getSettings();
      item.cbDataChannel.onmessage = async (event) => {
        if (
          stoppedPeers.has(item.cbDataChannel!) ||
          !appStore.remoteDesk.has(item.receiver) ||
          networkStore.rtcMap.get(item.receiver)?.cbDataChannel !==
            item.cbDataChannel
        )
          return;
        if (typeof event.data !== 'string' || event.data.length > 32768) return;
        const jsondata: {
          msgType: WsMsgTypeEnum;
          requestId: string;
          data: any;
        } = (() => {
          try {
            return JSON.parse(event.data);
          } catch {
            return null;
          }
        })();
        if (!jsondata || !jsondata.data || typeof jsondata.data !== 'object')
          return;
        const { msgType } = jsondata;
        if (msgType === WsMsgTypeEnum.remoteControllerState) {
          receiveControllerState(item, jsondata.data, jsondata.requestId);
          return;
        }
        if (
          msgType === WsMsgTypeEnum.remoteWindowsRequest ||
          msgType === WsMsgTypeEnum.remoteAgentLaunch ||
          msgType === WsMsgTypeEnum.remoteInstalledAgentsRequest ||
          msgType === WsMsgTypeEnum.remoteWindowSelect
        ) {
          await handleWindowRequest(item, jsondata);
          return;
        }
        if (item.receiver !== captureOwner) return;
        if (msgType === WsMsgTypeEnum.remoteImagePaste) {
          if (item.imageChannel)
            imageHosts
              .get(item.imageChannel)
              ?.commit(jsondata.data.sessionId, jsondata.data.id);
          return;
        }
        if (msgType === WsMsgTypeEnum.changeMaxBitrate) {
          const { data }: { data: WsChangeMaxBitrateType['data'] } = jsondata;
          currentMaxBitrate.value = data.val;
          await item.setMaxBitrate(data.val);
        } else if (msgType === WsMsgTypeEnum.changeMaxFramerate) {
          const { data }: { data: WsChangeMaxFramerateType['data'] } = jsondata;
          if (anchorStream.value) {
            currentMaxFramerate.value = data.val;
            await updateCaptureQuality(item);
          }
        } else if (msgType === WsMsgTypeEnum.changeResolutionRatio) {
          const { data }: { data: WsChangeResolutionRatioType['data'] } =
            jsondata;
          if (anchorStream.value) {
            currentResolutionRatio.value = data.val;
            await updateCaptureQuality(item);
          }
        } else if (msgType === WsMsgTypeEnum.changeVideoContentHint) {
          const { data }: { data: WsChangeVideoContentHintType['data'] } =
            jsondata;
          if (anchorStream.value) {
            currentVideoContentHint.value = data.val;
            // @ts-ignore
            setVideoTrackContentHints(anchorStream.value, data.val);
            await item.updateVideoSenderParameters();
          }
        } else if (msgType === WsMsgTypeEnum.changeAudioContentHint) {
          const { data }: { data: WsChangeAudioContentHintType['data'] } =
            jsondata;
          if (anchorStream.value) {
            currentAudioContentHint.value = data.val;
            // @ts-ignore
            setAudioTrackContentHints(anchorStream.value, data.val);
          }
        } else if (msgType === WsMsgTypeEnum.billdDeskBehavior) {
          const { data }: { data: WsBilldDeskBehaviorType['data'] } = jsondata;
          if (
            activityLeases.get(item.cbDataChannel!)?.active === false &&
            data.type !== BilldDeskBehaviorEnum.releaseAll
          )
            return;
          if (anchorStream.value && captureSessionId.value) {
            const sessionId = captureSessionId.value;
            const result = await handleRtcBilldDeskBehavior(
              WINDOW_ID_ENUM.remote,
              data,
              sessionId
            );
            if (captureSessionId.value !== sessionId) return;
            if (result?.code !== 0 && result?.msg) {
              if (result.data?.inputBlocked) {
                captureError.value = result.msg;
                item.dataChannelSend({
                  msgType: WsMsgTypeEnum.remoteInputResult,
                  requestId: jsondata.requestId,
                  data: { error: result.msg, inputBlocked: true },
                });
              } else endCaptureWithError(result.msg);
            } else if (data.type === BilldDeskBehaviorEnum.resumeInput) {
              captureError.value = '';
              item.dataChannelSend({
                msgType: WsMsgTypeEnum.remoteInputResult,
                requestId: jsondata.requestId,
                data: { inputBlocked: false },
              });
            }
          }
        }
      };
    });
  },
  {
    immediate: true,
    deep: true,
  }
);

watch(
  () => appStore.remoteDesk.size,
  (newval) => {
    if (!newval) {
      clearInterval(captureRefreshTimer.value);
      handleCloseAll();
    }
  },
  {
    immediate: true,
  }
);

watch(
  () => appStore.remoteDesk,
  (newval) => {
    newval.forEach((item) => {
      if (item.isClose) {
        // window.$notification.warning({
        //   content: `${item.sender}远程连接断开`,
        //   duration: 2000,
        // });
        appStore.remoteDesk.delete(item.sender);
        windowCatalogs.delete(item.sender);
        if (item.sender === captureOwner) handleCloseAll();
        return;
      }
      currentMaxBitrate.value = item.maxBitrate;
      currentMaxFramerate.value = item.maxFramerate;
      currentResolutionRatio.value = item.resolutionRatio;
      currentVideoContentHint.value = item.videoContentHint;
      currentAudioContentHint.value = item.audioContentHint;
    });
  },
  {
    deep: true,
  }
);

function handleLoopBilldDeskUpdateUserTimer() {
  clearInterval(loopBilldDeskUpdateUserTimer.value);
  loopBilldDeskUpdateUserTimer.value = setInterval(() => {
    if (captureSessionId.value) windowResumes.touch(captureResumeToken);
    networkStore.wsMap.get(roomId.value)?.send<WsBilldDeskStartRemote['data']>({
      requestId: getRandomString(8),
      msgType: WsMsgTypeEnum.billdDeskUpdateUser,
      data: {
        roomId: roomId.value,
        sender: mySocketId.value,
        receiver: receiverId.value,
        maxBitrate: currentMaxBitrate.value,
        maxFramerate: currentMaxFramerate.value,
        resolutionRatio: currentResolutionRatio.value,
        videoContentHint: currentVideoContentHint.value,
        audioContentHint: currentAudioContentHint.value,
        deskUserUuid: cacheStore.deskUserUuid,
        deskUserPassword: cacheStore.deskUserPassword,
        remoteDeskUserUuid: cacheStore.remoteDeskUserUuid,
        remoteDeskUserPassword: cacheStore.remoteDeskUserPassword,
      },
    });
  }, 1000 * 2);
}

async function handleInit() {
  handleInitIpcRendererOn();
  await handleInitIpcRendererSend();
  await refreshCaptureSources();
  await initDeskUser();
  if (disposed) return;
  if (!roomId.value) {
    initializationFailed.value = true;
    connectionError.value = '无法连接服务，请检查服务地址后重试';
    return;
  }
  deviceReady.value = true;
  deskUserUuid.value = cacheStore.deskUserUuid;
  deskUserPassword.value = cacheStore.deskUserPassword;
  void publishConnectionLink();
  handleLoopBilldDeskUpdateUserTimer();
  initWs({
    roomId: roomId.value,
    isAnchor: false,
    isRemoteDesk: true,
  });
}

async function handleInitIpcRendererSend() {
  ipcRendererSend({
    windowId: WINDOW_ID_ENUM.remote,
    channel: IPC_EVENT.workAreaSize,
    requestId: getRandomString(8),
    data: {},
  });

  const res = await ipcRendererInvoke({
    windowId: WINDOW_ID_ENUM.remote,
    channel: IPC_EVENT.getPrimaryDisplaySize,
    requestId: getRandomString(8),
    data: {},
  });
  if (res?.code === 0) {
    appStore.primaryDisplaySize.width = res.data.width;
    appStore.primaryDisplaySize.height = res.data.height;
  }

  const res1 = await ipcRendererInvoke({
    windowId: WINDOW_ID_ENUM.remote,
    channel: IPC_EVENT.scaleFactor,
    requestId: getRandomString(8),
    data: {},
  });
  if (res1?.code === 0) {
    if (res1?.data?.platform !== 'darwin') {
      appStore.scaleFactor = res1.data.scaleFactor;
    }
  }
}

function responsePowerMonitorSuspend(_event, data: IIpcRendererData) {
  console.log('response_powerMonitorSuspend', data);
  suspend.value = `${new Date().toLocaleString()}-powerMonitorSuspend`;
}
function responsePowerMonitorResume(_event, data: IIpcRendererData) {
  console.log('response_powerMonitorResume', data);
  resume.value = `${new Date().toLocaleString()}-powerMonitorResume`;
  handleCloseAll();
}
function responseGetWindowPosition(_event, data: IIpcRendererData) {
  position.value = data.data.position;
}
function responseWorkAreaSize(_event, data: IIpcRendererData) {
  appStore.workAreaSize = {
    width: data.data.width,
    height: data.data.height,
  };
}

function invokeCapture(channel: string, data: Record<string, unknown> = {}) {
  return ipcRendererInvoke({
    windowId: WINDOW_ID_ENUM.remote,
    channel,
    requestId: getRandomString(8),
    data,
  });
}

function getCaptureBoundsWarning(source?: ICaptureSource) {
  return source && source.boundsSource !== 'window'
    ? '无法读取精确边界，控制已停用'
    : '';
}

async function openPermission(kind: 'screen' | 'accessibility') {
  await invokeCapture(IPC_EVENT.openCapturePermission, { kind });
  await refreshCaptureSources();
}

function selectCaptureSource(source: ICaptureSource) {
  if (appStore.remoteDesk.size > 0) return;
  selectedCaptureSourceId.value = source.id;
  captureError.value = '';
  captureWarning.value = getCaptureBoundsWarning(source);
}

function startCaptureBoundsRefresh() {
  clearInterval(captureRefreshTimer.value);
  captureRefreshTimer.value = setInterval(() => {
    void refreshCaptureSources();
  }, 2000);
}

async function refreshCaptureSources() {
  if (!ipcRenderer || captureLoading.value) return;
  const generation = captureGeneration;
  captureLoading.value = true;
  try {
    const permissionResult = await invokeCapture(IPC_EVENT.capturePermissions);
    if (permissionResult?.code === 0) permissions.value = permissionResult.data;
    const res = await invokeCapture(IPC_EVENT.getCaptureSources);
    if (generation !== captureGeneration) return;
    if (res?.code !== 0) throw new Error(res?.msg || '读取窗口失败');
    captureSources.value = Array.isArray(res.data.sources)
      ? res.data.sources
      : [];
    if (
      captureSessionId.value &&
      res.data.sessionId !== captureSessionId.value
    ) {
      endCaptureWithError('目标窗口已关闭或不可见，远程控制已结束');
    }
    const retained = captureSources.value.some(
      (source) => source.id === selectedCaptureSourceId.value
    );
    if (!retained) selectedCaptureSourceId.value = '';
    captureWarning.value = getCaptureBoundsWarning(selectedCaptureSource.value);
  } catch (error) {
    if (generation !== captureGeneration) return;
    captureSources.value = [];
    endCaptureWithError(error instanceof Error ? error.message : String(error));
  } finally {
    captureLoading.value = false;
  }
}

function handleInitIpcRendererOn() {
  ipcRendererOn(
    IPC_EVENT.response_powerMonitorSuspend,
    responsePowerMonitorSuspend
  );

  ipcRendererOn(
    IPC_EVENT.response_powerMonitorResume,
    responsePowerMonitorResume
  );

  ipcRendererOn(
    IPC_EVENT.response_getWindowPosition,
    responseGetWindowPosition
  );

  ipcRendererOn(IPC_EVENT.response_workAreaSize, responseWorkAreaSize);
}

const HOST_IDENTITY_WAITING = '正在确认云主机身份，暂不使用缓存凭据上线…';

async function resolveHostIdentity() {
  if (!ipcRenderer) return { instanceId: '', action: 'reuse' as const };
  // Network may lag at boot: wait about a minute first, then keep retrying.
  let waitMs = 60_000;
  for (;;) {
    const res = await ipcRendererInvoke({
      windowId: WINDOW_ID_ENUM.remote,
      channel: IPC_EVENT.getHostInstanceId,
      requestId: getRandomString(8),
      data: { waitMs },
    });
    const instanceId = res?.data?.supported
      ? normalizeInstanceId(res.data.instanceId)
      : '';
    const action = decideCredentialAction({
      currentInstanceId: instanceId,
      recordedInstanceId: cacheStore.deskUserInstanceId,
      hasCredentials: !!(
        cacheStore.deskUserUuid && cacheStore.deskUserPassword
      ),
    });
    if (action !== 'wait') {
      if (connectionError.value === HOST_IDENTITY_WAITING)
        connectionError.value = '';
      return { instanceId, action };
    }
    if (disposed) return undefined;
    connectionError.value = HOST_IDENTITY_WAITING;
    waitMs = 10_000;
  }
}

async function initDeskUser() {
  try {
    const identity = await resolveHostIdentity();
    if (!identity) return;
    if (identity.action === 'recreate') {
      // Credentials copied from an image template belong to another machine.
      cacheStore.deskUserUuid = '';
      cacheStore.deskUserPassword = '';
    }
    if (!cacheStore.deskUserUuid || !cacheStore.deskUserPassword) {
      const res = await fetchDeskUserCreate();
      if (res.code === 200) {
        cacheStore.deskUserUuid = res.data.uuid!;
        cacheStore.deskUserPassword = res.data.password!;
        roomId.value = cacheStore.deskUserUuid;
      }
    } else {
      const res = await fetchDeskUserLogin({
        uuid: cacheStore.deskUserUuid,
        password: cacheStore.deskUserPassword,
      });
      if (res.code === 200) {
        roomId.value = cacheStore.deskUserUuid;
      } else {
        const createRes = await fetchDeskUserCreate();
        if (createRes.code === 200) {
          cacheStore.deskUserUuid = createRes.data.uuid!;
          cacheStore.deskUserPassword = createRes.data.password!;
          roomId.value = cacheStore.deskUserUuid;
        }
      }
    }
    if (roomId.value && identity.instanceId)
      cacheStore.deskUserInstanceId = identity.instanceId;
  } catch (error) {
    console.log(error);
  }
}

/** Writes the invitation for `PalmDesk.exe --print-link` (Windows hosts). */
async function publishConnectionLink() {
  if (!ipcRenderer || !cacheStore.deskUserInstanceId) return;
  let url: string;
  try {
    url = createConnectionInvite(
      getClientUrl(),
      cacheStore.deskUserUuid,
      cacheStore.deskUserPassword
    );
  } catch (error) {
    console.log('无法生成连接链接', error);
    return;
  }
  const res = await ipcRendererInvoke({
    windowId: WINDOW_ID_ENUM.remote,
    channel: IPC_EVENT.publishConnectionLink,
    requestId: getRandomString(8),
    data: {
      device: cacheStore.deskUserUuid,
      password: cacheStore.deskUserPassword,
      url,
    },
  });
  if (res?.code !== 0) console.log('写入连接信息失败', res?.msg);
}

watch(
  () => connectStatus.value,
  (newval) => {
    console.log('connectStatus', newval);
    if (newval === WsConnectStatusEnum.connect) {
      handleWsMsg();
    }
  }
);

function handleWsMsg() {
  const ws = networkStore.wsMap.get(roomId.value);
  // 收到billdDeskStartRemoteResult
  ws?.socketIo?.on(
    WsMsgTypeEnum.billdDeskStartRemoteResult,
    (data: WsBilldDeskStartRemoteResult['data']) => {
      console.log('收到billdDeskStartRemoteResult', data.code);
      if (data.code !== 0) {
        useTip({
          content: data.msg,
          hiddenCancel: true,
          hiddenClose: true,
        });
      } else {
        if (data.data) {
          receiverId.value = data.data.receiver;
          if (data.data.receiver === mySocketId.value) {
            appStore.remoteDesk.set(data.data.sender, {
              sender: data.data.sender,
              isClose: false,
              maxBitrate: data.data.maxBitrate,
              maxFramerate: data.data.maxFramerate,
              resolutionRatio: data.data.resolutionRatio,
              videoContentHint: data.data.videoContentHint,
              audioContentHint: data.data.audioContentHint,
              deskUserUuid: data.data.deskUserUuid,
              remoteDeskUserUuid: data.data.remoteDeskUserUuid,
            });
            handleRTC(data.data.sender);
          }
        }
      }
    }
  );
}

function stopCaptureStream() {
  windowResumes.touch(captureResumeToken);
  captureResumeToken = '';
  imagePasteSession = '';
  imageHosts.forEach((host) => host.reset());
  captureGeneration += 1;
  captureLifecycle.stop();
  anchorStream.value = undefined;
  const sessionId = captureSessionId.value;
  captureSessionId.value = '';
  captureOwner = '';
  windowSelection = undefined;
  clearInterval(captureRefreshTimer.value);
  if (ipcRenderer) void invokeCapture(IPC_EVENT.stopCapture, { sessionId });
}

async function beginSelectedCapture(source: ICaptureSource, receiver: string) {
  captureGeneration += 1;
  const generation = captureGeneration;
  captureOwner = receiver;
  captureError.value = '';
  try {
    const result = await invokeCapture(IPC_EVENT.beginCapture, {
      sourceId: selectedCaptureSourceId.value,
      expectedSource: { ownerPid: source.ownerPid, bundleId: source.bundleId },
    });
    if (result?.code !== 0) throw new Error(result?.msg || '无法启动窗口捕获');
    const {
      sessionId,
      source: capturedSource,
      stream: captureStream,
    } = result.data;
    if (
      generation !== captureGeneration ||
      !appStore.remoteDesk.has(receiver)
    ) {
      await invokeCapture(IPC_EVENT.stopCapture, { sessionId });
      return;
    }
    captureSessionId.value = sessionId;
    imagePasteSession = result.data.imagePaste === true ? sessionId : '';
    captureWarning.value = getCaptureBoundsWarning(capturedSource);
    const stream = await captureLifecycle.start(() =>
      // Use only the window ID approved by the main process.
      navigator.mediaDevices.getUserMedia(
        desktopCaptureConstraints(captureStream.id)
      )
    );
    if (
      !stream ||
      generation !== captureGeneration ||
      !appStore.remoteDesk.has(receiver)
    )
      return;
    stream.getVideoTracks().forEach((track) =>
      track.addEventListener(
        'ended',
        () => {
          if (captureSessionId.value !== sessionId) return;
          endCaptureWithError('窗口视频已结束');
        },
        { once: true }
      )
    );
    anchorStream.value = stream;
    captureOwner = receiver;
    startCaptureBoundsRefresh();
    return stream;
  } catch (error) {
    if (generation !== captureGeneration) return;
    captureError.value =
      error instanceof Error ? error.message : '无法捕获窗口';
    stopCaptureStream();
    throw error;
  }
}

async function updateCaptureQuality(peer: WebRTCClass) {
  if (!anchorStream.value) return;
  try {
    await applyRemoteVideoConstraints(
      anchorStream.value,
      currentResolutionRatio.value,
      currentMaxFramerate.value
    );
    await peer.setMaxFramerate(currentMaxFramerate.value);
  } catch (error) {
    console.error('调整窗口画质失败', error);
  }
}

async function handleRTC(receiver) {
  if (networkStore.rtcMap.has(receiver)) return;
  try {
    updateWebRtcRemoteDeskConfig({
      roomId: roomId.value,
      anchorStream: undefined,
    });
    await webRtcRemoteDesk.newWebRtc({
      // 因为这里是收到offer，而offer是房主发的，所以此时的data.data.sender是房主；data.data.receiver是接收者；
      // 但是这里的nativeWebRtc的sender，得是自己，不能是data.data.sender，不要混淆
      sender: mySocketId.value,
      receiver,
      videoEl: createNullVideo(),
      deskUserUuid: cacheStore.deskUserUuid,
      remoteDeskUserUuid: cacheStore.remoteDeskUserUuid,
      maxBitrate: currentMaxBitrate.value,
      maxFramerate: currentMaxFramerate.value,
    });
    await webRtcRemoteDesk.sendOffer({
      sender: mySocketId.value,
      receiver,
    });
  } catch (error) {
    console.log(error);
  }
}

async function handleWindowRequest(
  peer: WebRTCClass,
  request: { msgType: WsMsgTypeEnum; requestId: string; data: any }
) {
  if (typeof request.requestId !== 'string' || request.requestId.length > 64)
    return;
  const channel = peer.cbDataChannel;
  const current = () =>
    !disposed &&
    !stoppedPeers.has(channel!) &&
    appStore.remoteDesk.has(peer.receiver) &&
    !appStore.remoteDesk.get(peer.receiver)?.isClose &&
    channel?.readyState === 'open' &&
    networkStore.rtcMap.get(peer.receiver)?.cbDataChannel === channel;
  const reply = (msgType: WsMsgTypeEnum, data: unknown) => {
    if (current())
      peer.dataChannelSend({ msgType, requestId: request.requestId, data });
  };
  if (!current()) return;
  if (request.msgType === WsMsgTypeEnum.remoteInstalledAgentsRequest) {
    try {
      const result = await invokeCapture(IPC_EVENT.getInstalledAgents);
      if (result?.code !== 0)
        throw new Error('读取已安装 Agent 失败，请刷新重试');
      reply(WsMsgTypeEnum.remoteInstalledAgentsResult, result.data);
    } catch {
      reply(WsMsgTypeEnum.remoteInstalledAgentsResult, {
        supported: false,
        agents: [],
        message: '读取已安装 Agent 失败，请刷新重试',
      });
    }
    return;
  }
  if (request.msgType === WsMsgTypeEnum.remoteAgentLaunch) {
    if (windowSelection || captureSessionId.value) {
      reply(WsMsgTypeEnum.remoteAgentLaunchResult, {
        error: '已有应用正在打开或控制，请稍后重试',
      });
      return;
    }
    const selection = Symbol();
    const operationId = crypto.randomUUID();
    windowSelection = selection;
    const cancel = () => {
      void invokeCapture(IPC_EVENT.cancelAgentLaunch, { operationId }).catch(
        () => {}
      );
    };
    channel!.addEventListener('close', cancel, { once: true });
    try {
      await runAgentLaunch(
        request.data.id,
        operationId,
        current,
        async (id, operationId) => {
          const result = await invokeCapture(IPC_EVENT.launchAgent, {
            id,
            operationId,
          });
          if (result?.code !== 0)
            throw new Error(result?.msg || '打开 Agent 失败，请重试');
        },
        cancel
      );
      reply(WsMsgTypeEnum.remoteAgentLaunchResult, { id: request.data.id });
    } catch (error) {
      reply(WsMsgTypeEnum.remoteAgentLaunchResult, {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      channel?.removeEventListener('close', cancel);
      if (windowSelection === selection) windowSelection = undefined;
    }
    return;
  }
  if (request.msgType === WsMsgTypeEnum.remoteWindowsRequest) {
    if (listingPeers.has(peer.receiver)) return;
    listingPeers.add(peer.receiver);
    try {
      if (request.data?.agentDiscovery === true) {
        try {
          const discovery = await invokeCapture(IPC_EVENT.getAgentApplications);
          if (!current()) return;
          if (discovery?.code !== 0)
            throw new Error(discovery?.msg || '读取 Agent 失败');
          discovery.data.agents.forEach((agent) =>
            reply(WsMsgTypeEnum.remoteWindowsResult, { agent })
          );
        } catch (error) {
          reply(WsMsgTypeEnum.remoteWindowsResult, {
            discoveryError:
              error instanceof Error ? error.message : String(error),
          });
        }
      }
      const result = await invokeCapture(IPC_EVENT.getCaptureSources, {
        previews: request.data?.previews !== false,
      });
      if (!current()) return;
      if (result?.code !== 0) throw new Error(result?.msg || '读取窗口失败');
      captureSources.value = result.data.sources;
      const catalog = windowCatalogs.get(peer.receiver) || new WindowCatalog();
      windowCatalogs.set(peer.receiver, catalog);
      catalog.update(result.data.sources).forEach((source) => {
        reply(WsMsgTypeEnum.remoteWindowsResult, { source });
      });
      reply(WsMsgTypeEnum.remoteWindowsResult, { done: true });
    } catch (error) {
      reply(WsMsgTypeEnum.remoteWindowsResult, {
        done: true,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      listingPeers.delete(peer.receiver);
    }
    return;
  }
  if (windowSelection || captureSessionId.value) {
    reply(WsMsgTypeEnum.remoteWindowSelected, {
      error: '已有窗口正在连接或控制，请先断开再选择',
    });
    return;
  }
  const selection = Symbol();
  windowSelection = selection;
  try {
    const device = appStore.remoteDesk.get(peer.receiver)?.deskUserUuid;
    if (!device) throw new Error('请重新连接电脑');
    let source: ICaptureSource;
    let id = request.data.id;
    if (typeof request.data.resumeToken === 'string') {
      const result = await invokeCapture(IPC_EVENT.getCaptureSources);
      if (!current()) return;
      if (result?.code !== 0) throw new Error(result?.msg || '读取窗口失败');
      source = windowResumes.resolve(
        request.data.resumeToken,
        device,
        result.data.sources
      );
      id = crypto.randomUUID();
    } else {
      const catalog = windowCatalogs.get(peer.receiver);
      if (!catalog || typeof id !== 'string')
        throw new Error('请先刷新窗口列表');
      source = catalog.get(id);
    }
    selectedCaptureSourceId.value = source.id;
    const stream = await beginSelectedCapture(source, peer.receiver);
    if (!stream || !current()) return;
    await applyRemoteVideoConstraints(
      stream,
      currentResolutionRatio.value,
      currentMaxFramerate.value
    );
    if (!current() || anchorStream.value !== stream) return;
    setVideoTrackContentHints(stream, currentVideoContentHint.value as any);
    await peer.setMaxFramerate(currentMaxFramerate.value);
    await peer.setMaxBitrate(currentMaxBitrate.value);
    if (!current() || anchorStream.value !== stream) return;
    updateWebRtcRemoteDeskConfig({
      roomId: roomId.value,
      anchorStream: stream,
    });
    await webRtcRemoteDesk.sendOffer({
      sender: mySocketId.value,
      receiver: peer.receiver,
    });
    if (!current() || anchorStream.value !== stream) return;
    captureResumeToken = windowResumes.remember(device, source);
    reply(WsMsgTypeEnum.remoteWindowSelected, {
      id,
      name: source.name,
      resumeToken: captureResumeToken,
      imagePasteSession: imagePasteSession || undefined,
    });
  } catch (error) {
    if (captureOwner === peer.receiver) stopCaptureStream();
    reply(WsMsgTypeEnum.remoteWindowSelected, {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (windowSelection === selection) windowSelection = undefined;
  }
}

function changeDebugUrl() {
  window.location.href = debugUrl.value;
}

async function handleResetDeskuuid() {
  deviceReady.value = false;
  cacheStore.deskUserUuid = '';
  cacheStore.deskUserPassword = '';
  await initDeskUser();
  windowReload();
}

function handleCopy(str) {
  copyToClipBoard(str);
  window.$message.success('复制成功！');
}

function handleClose() {
  if (verifyingPassword.value) return;
  showPwdModalCpt.value = false;
  loading.value = false;
}

async function handleConfirm(pwd: string) {
  if (verifyingPassword.value || disposed) return;
  verifyingPassword.value = true;
  loading.value = true;
  errMsg.value = '';
  connectionError.value = '';
  try {
    const res = await fetchDeskUserLinkVerify({
      uuid: cacheStore.remoteDeskUserUuid,
      password: pwd,
    });
    if (disposed) return;
    if (res.code == 200) {
      if (res.data.code === 1) {
        isControlOther.value = true;
        showPwdModalCpt.value = false;
        cacheStore.linkDeviceList = cacheStore.linkDeviceList.filter(
          (v) => v.remoteDeskUserUuid !== cacheStore.remoteDeskUserUuid
        );
        cacheStore.linkDeviceList.push({
          remoteDeskUserUuid: cacheStore.remoteDeskUserUuid,
          remoteDeskUserPassword: pwd,
        });
        if (ipcRenderer) {
          ipcRendererSend({
            windowId: 0,
            channel: IPC_EVENT.createWindow,
            requestId: getRandomString(8),
            data: {
              route: routerName.webrtc,
              query: {
                roomId: cacheStore.remoteDeskUserUuid,
                deskUserUuid: cacheStore.deskUserUuid,
                deskUserPassword: cacheStore.deskUserPassword,
                remoteDeskUserUuid: cacheStore.remoteDeskUserUuid,
                remoteDeskUserPassword: pwd,
                receiverId: receiverId.value,
                audioContentHint: currentAudioContentHint.value,
              },
              windowId: WINDOW_ID_ENUM.webrtc,
              minWidth: 300,
              minHeight: 300,
              useWorkAreaSize: true,
              frame: true,
            },
          });
        } else {
          networkStore.removeAllWsAndRtc();
          sessionStorage.setItem(
            'codex-remote-session',
            JSON.stringify({
              roomId: cacheStore.remoteDeskUserUuid,
              deskUserUuid: cacheStore.deskUserUuid,
              deskUserPassword: cacheStore.deskUserPassword,
              remoteDeskUserUuid: cacheStore.remoteDeskUserUuid,
              remoteDeskUserPassword: pwd,
              receiverId: receiverId.value,
              audioContentHint: currentAudioContentHint.value,
            })
          );
          await router.push({ name: routerName.webrtc });
        }

        const flag = cacheStore.linkDeviceList.find(
          (v) => v.remoteDeskUserUuid === cacheStore.remoteDeskUserUuid
        );
        if (!flag) {
          cacheStore.linkDeviceList.push({
            remoteDeskUserUuid: cacheStore.remoteDeskUserUuid,
            remoteDeskUserPassword: pwd,
          });
        }
      } else {
        showPwdModalCpt.value = true;
        errMsg.value = '密码错误，请重新输入';
      }
    } else {
      connectionError.value = res.message || '连接失败，请重试';
    }
  } catch {
    if (!disposed) connectionError.value = '连接失败，请检查网络后重试';
  } finally {
    verifyingPassword.value = false;
    loading.value = showPwdModalCpt.value;
  }
}

function changeRemoteDeskUserUuid(item) {
  if (loading.value || pendingInvite.value) return;
  const res = cacheStore.linkDeviceList.find(
    (v) => v.remoteDeskUserUuid === item.remoteDeskUserUuid
  );
  if (res) {
    cacheStore.remoteDeskUserUuid = res.remoteDeskUserUuid;
    cacheStore.remoteDeskUserPassword = res.remoteDeskUserPassword;
  }
  showLinkDeviceList.value = false;
}

function handleDelLinkDeviceList(item) {
  cacheStore.linkDeviceList = cacheStore.linkDeviceList.filter(
    (v) => v.remoteDeskUserUuid !== item.remoteDeskUserUuid
  );
}

async function startRemote(invitePassword?: string) {
  if (loading.value || !deviceReady.value || disposed) return;
  connectionError.value = '';
  if (!ipcRenderer && typeof window.RTCPeerConnection !== 'function') {
    connectionError.value =
      '当前浏览器不支持远程连接，请用系统浏览器打开连接链接';
    return;
  }
  cacheStore.remoteDeskUserUuid = cacheStore.remoteDeskUserUuid.trim();
  const connectionPassword =
    invitePassword ??
    (receivedInvite.value?.device === cacheStore.remoteDeskUserUuid
      ? receivedInvite.value.password
      : undefined);
  if (cacheStore.remoteDeskUserUuid === '') {
    window.$message.warning('请输入远程设备代码！');
    return;
  }
  if (cacheStore.remoteDeskUserUuid === cacheStore.deskUserUuid) {
    window.$message.warning('不能连接自己！');
    return;
  }
  try {
    loading.value = true;
    const res = await fetchFindReceiverByUuid(cacheStore.remoteDeskUserUuid);
    if (disposed) return;
    if (res.code === 200) {
      if (res.data.receiver) {
        receiverId.value = res.data.receiver;
        const old = cacheStore.linkDeviceList.find(
          (v) => v.remoteDeskUserUuid === cacheStore.remoteDeskUserUuid
        );
        if (connectionPassword !== undefined) {
          pwd.value = connectionPassword;
          await handleConfirm(connectionPassword);
        } else if (old) {
          pwd.value = old.remoteDeskUserPassword;
          await handleConfirm(pwd.value);
        } else {
          pwd.value = '';
          showPwdModalCpt.value = true;
        }
      } else {
        connectionError.value = '该设备不在线，请确认电脑已连接服务';
      }
    } else {
      connectionError.value = res.message || '连接失败，请重试';
    }
  } catch {
    if (!disposed) connectionError.value = '连接失败，请检查网络后重试';
  } finally {
    loading.value = showPwdModalCpt.value;
  }
}

function endCaptureWithError(message: string) {
  const peer = networkStore.rtcMap.get(captureOwner);
  captureError.value = message;
  stopCaptureStream();
  if (!peer) {
    handleCloseAll();
    return;
  }
  peer.dataChannelSend({
    msgType: WsMsgTypeEnum.remoteInputResult,
    requestId: getRandomString(8),
    data: { error: message, inputBlocked: false },
  });
  // Stop input/video immediately; allow the peer to receive the reason and close.
  setTimeout(() => {
    if (
      networkStore.rtcMap.get(peer.receiver)?.cbDataChannel ===
      peer.cbDataChannel
    )
      networkStore.removeRtc(peer.receiver);
  }, 1000);
}

function handleCloseAll() {
  stopCaptureStream();
  windowCatalogs.clear();
  [...appStore.remoteDesk.values()].forEach((item) =>
    networkStore.removeRtc(item.sender)
  );
  appStore.remoteDesk.clear();
}

function handleDel(sender) {
  const peer = networkStore.rtcMap.get(sender);
  if (!peer) return;
  if (peer.cbDataChannel) stoppedPeers.add(peer.cbDataChannel);
  const sessionId = peer.remoteConnection?.session.access.id;
  if (sessionId) {
    networkStore.wsMap.get(roomId.value)?.send({
      requestId: getRandomString(8),
      msgType: WsMsgTypeEnum.billdDeskEndRemote,
      data: {
        sender: mySocketId.value,
        receiver: sender,
        live_room_id: roomId.value,
        sessionId,
        isRemoteDesk: true,
      },
    });
  }
  peer.dataChannelSend({
    msgType: WsMsgTypeEnum.remoteSessionStopped,
    requestId: getRandomString(8),
    data: {},
  });
  if (captureOwner === sender) stopCaptureStream();
  // Allow the terminal notice to arrive before closing SCTP. Do not close a
  // replacement connection if the controller has already reconnected manually.
  setTimeout(() => {
    if (networkStore.rtcMap.get(sender)?.peerConnection === peer.peerConnection)
      networkStore.removeRtc(sender);
  }, 200);
}
</script>

<style lang="scss" scoped>
.remote-wrap {
  min-height: 100%;
  .container {
    position: relative;
    z-index: 1;
  }
}
.page-heading {
  position: relative;
  padding-bottom: 40px;
  border-bottom: 1px solid var(--pd-border);
  h1 {
    max-width: 700px;
  }
  p {
    max-width: 540px;
  }
}
.connection-state {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-top: 20px;
  padding: 5px 10px;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius-sm);
  background: var(--pd-surface-soft);
  color: var(--pd-muted);
  font-family: var(--pd-mono);
  letter-spacing: 0.2px;
  font-size: 11px;
  > span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #a07d43;
  }
  &.online {
    color: var(--pd-accent);
    > span {
      background: var(--pd-accent);
      box-shadow: 0 0 0 3px rgb(22 138 58 / 14%);
    }
  }
  &.failed {
    color: var(--pd-danger);
    > span {
      background: var(--pd-danger);
    }
  }
}
.section-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  p {
    margin: 3px 0 0;
    color: var(--pd-muted);
    font-size: 12px;
  }
}
.section-icon {
  display: grid;
  place-items: center;
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  border: 1px solid var(--pd-border-strong);
  border-radius: var(--pd-radius-sm);
  background: var(--pd-surface-soft);
  color: var(--pd-accent);
  svg {
    width: 22px;
    height: 22px;
  }
}
.label {
  margin: 0;
  font-weight: 600;
  font-size: 17px;
  line-height: 1.5;
}
.local-device {
  margin-bottom: 18px;
  border-color: var(--pd-border);
  .info {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 24px;
    margin-top: 24px;
  }
  .info-right {
    padding-left: 24px;
    border-left: 1px solid var(--pd-border);
  }
  .txt {
    color: var(--pd-muted);
    font-size: 12px;
    margin-bottom: 8px;
  }
  .code-info {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
  }
  .code {
    width: 100%;
    margin-bottom: 4px;
    color: var(--pd-accent);
    font: 500 clamp(20px, 2.7vw, 28px) / 1.4 var(--pd-mono);
    letter-spacing: 1px;
    user-select: text;
    overflow-wrap: anywhere;
  }
  .ico {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 7px;
    border: 1px solid var(--pd-border);
    border-radius: var(--pd-radius-sm);
    background: var(--pd-surface);
    color: var(--pd-muted);
    cursor: pointer;
    svg {
      width: 16px;
      height: 16px;
    }
    &:hover {
      background: var(--pd-surface-soft);
      color: var(--pd-accent);
    }
  }
}
// Keep the full-size connection QR in view when the desktop app opens.
.remote-wrap:not(.browser-controller) {
  .container {
    padding-top: 24px;
  }
  .page-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
    padding-bottom: 20px;
    h1 {
      margin: 6px 0 8px;
      font-size: 32px;
      letter-spacing: -1.2px;
    }
    p {
      font-size: 13px;
    }
  }
  .connection-state {
    position: static;
    flex-shrink: 0;
    margin-top: 0;
  }
  .local-device {
    padding: 16px;
    margin-bottom: 16px;
    .info {
      gap: 16px;
      margin-top: 12px;
    }
    .info-right {
      padding-left: 16px;
    }
    .txt {
      margin-bottom: 4px;
    }
    .code {
      flex: 1;
      width: auto;
      margin-bottom: 0;
      font-size: 22px;
    }
    .ico {
      flex-shrink: 0;
    }
  }
}
@media (max-height: 650px) {
  .remote-wrap:not(.browser-controller) {
    .container {
      padding-top: 16px;
    }
    .page-heading {
      margin-bottom: 12px;
      padding-bottom: 12px;
      h1 {
        margin: 4px 0 6px;
        font-size: 28px;
      }
    }
    .local-device {
      padding: 12px;
      margin-bottom: 12px;
      .section-heading p {
        display: none;
      }
      .section-icon {
        flex-basis: 32px;
        width: 32px;
        height: 32px;
      }
      .info {
        margin-top: 8px;
      }
    }
  }
}
.remote-device {
  position: relative;
  z-index: 10;
  margin-top: 18px;
  padding: 28px;
  border-radius: var(--pd-radius-lg);
  border-color: var(--pd-border-strong);
  box-shadow: var(--pd-shadow);
}
.connection-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 28px;
}
.scan-button,
.retry-service,
.refresh-target,
.permissions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  gap: 8px;
  min-height: 40px;
  padding: 8px 12px;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius-sm);
  background: var(--pd-surface);
  color: var(--pd-accent);
  font-size: 12px;
  cursor: pointer;
  svg {
    width: 18px;
    height: 18px;
  }
  &:hover:not(:disabled) {
    background: var(--pd-accent-soft);
    border-color: var(--pd-border-strong);
  }
  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}
.input-label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 550;
  color: var(--pd-muted);
}
.remote-device .info {
  display: flex;
  gap: 12px;
}
.ipt-wrap {
  flex: 1;
  min-width: 0;
}
.ipt-top {
  position: relative;
}
.ipt {
  box-sizing: border-box;
  width: 100%;
  height: 54px;
  padding: 0 52px 0 16px;
  border: 1px solid var(--pd-border-strong);
  border-radius: var(--pd-radius-sm);
  outline: none;
  background: var(--pd-bg);
  color: var(--pd-text);
  font: 500 19px var(--pd-mono);
  letter-spacing: 2px;
  &::placeholder {
    font: 14px var(--pd-font);
    color: var(--pd-muted);
    letter-spacing: 0;
  }
  &:focus {
    border-color: var(--pd-accent);
    box-shadow: 0 0 0 3px rgb(22 138 58 / 14%);
    background: var(--pd-surface-soft);
  }
  &:disabled {
    opacity: 0.6;
  }
}
.arrow-down {
  position: absolute;
  top: 7px;
  right: 7px;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 10px;
  border: 0;
  border-radius: var(--pd-radius-sm);
  background: transparent;
  color: var(--pd-muted);
  cursor: pointer;
  svg {
    width: 18px;
    height: 18px;
    transition: transform 160ms ease;
  }
  &.active svg {
    transform: rotate(180deg);
  }
  &:hover:not(:disabled) {
    background: var(--pd-accent-soft);
  }
}
.ipt-bottom {
  position: relative;
}
.link-device-list {
  position: absolute;
  top: 8px;
  left: 0;
  z-index: 20;
  box-sizing: border-box;
  width: 100%;
  max-height: 220px;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius);
  background: var(--pd-surface);
  box-shadow: var(--pd-shadow-raised);
}
.link-device-item {
  display: flex;
  align-items: center;
  border-radius: var(--pd-radius-sm);
  &:hover {
    background: var(--pd-surface-soft);
  }
  button {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 10px;
    border: 0;
    background: transparent;
    color: var(--pd-text);
    cursor: pointer;
    svg {
      width: 18px;
      height: 18px;
    }
  }
  .left {
    flex: 1;
    font-family: var(--pd-mono);
  }
  .del {
    color: var(--pd-muted);
    &:hover {
      color: var(--pd-danger);
    }
  }
}
.null {
  padding: 14px;
  color: var(--pd-muted);
  text-align: center;
  font-size: 13px;
}
.btn {
  min-width: 112px;
  height: 54px;
  border-radius: var(--pd-radius-sm);
  background: var(--pd-accent);
  color: var(--pd-on-accent);
  box-shadow: 0 10px 24px rgb(22 138 58 / 18%);
  &:hover:not(:disabled) {
    background: var(--pd-accent-hover);
    color: var(--pd-on-accent);
    box-shadow: 0 12px 30px rgb(22 138 58 / 24%);
  }
  &:disabled {
    border-color: var(--pd-border);
    background: var(--pd-surface-soft);
    color: var(--pd-muted);
    box-shadow: none;
    opacity: 1;
    > svg {
      background: var(--pd-border-strong);
    }
  }
  > svg {
    width: 20px;
    height: 20px;
    padding: 3px;
    border-radius: 50%;
    background: rgb(7 17 8 / 12%);
  }
  .loading {
    animation: rotate 1s linear infinite;
  }
}
.connection-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 14px 0 0;
  color: var(--pd-muted);
  font-size: 11px;
  svg {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
  }
}
.invite-status,
.connection-error {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.invite-status {
  color: var(--pd-muted);
}
.connection-error {
  color: var(--pd-danger);
}
.workflow-guide {
  margin: 32px 0 24px;
}
.guide-heading {
  margin: 0 0 12px;
}
.guide-items {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  > div {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    align-content: start;
    align-items: center;
    gap: 8px;
    box-sizing: border-box;
    padding: 16px;
    border: 1px solid var(--pd-border);
    border-radius: var(--pd-radius);
    background: var(--pd-surface);
  }
  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }
  p {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--pd-muted);
    font-size: 12px;
    line-height: 1.6;
  }
}
.guide-icon {
  display: inline-flex;
  color: var(--pd-accent);
  svg {
    width: 20px;
    height: 20px;
  }
}
.ai-target {
  margin-top: 18px;
}
.target-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.target-hint {
  margin: 4px 0 0;
  color: var(--pd-muted);
  font-size: 12px;
}
.capture-source-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
  max-height: 220px;
  margin-top: 20px;
  overflow-y: auto;
}
.capture-source {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  grid-template-rows: auto auto;
  align-items: center;
  gap: 0 10px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius-sm);
  background: var(--pd-surface-soft);
  text-align: left;
  cursor: pointer;
  &:hover:not(:disabled),
  &.selected {
    border-color: var(--pd-accent);
    background: var(--pd-accent-soft);
  }
  &:disabled {
    cursor: not-allowed;
  }
}
.capture-thumbnail {
  grid-row: 1 / 3;
  width: 72px;
  height: 46px;
  object-fit: cover;
  border-radius: var(--pd-radius-sm);
  background: var(--pd-surface-soft);
}
.capture-placeholder {
  display: grid;
  place-items: center;
  color: var(--pd-muted);
  svg {
    width: 22px;
    height: 22px;
  }
}
.capture-source-name,
.capture-source-meta {
  overflow: hidden;
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.capture-source-name {
  color: var(--pd-text);
  font-size: 13px;
}
.capture-source-meta {
  margin-top: 3px;
  color: var(--pd-muted);
  font-size: 11px;
}
.capture-empty {
  margin-top: 18px;
  padding: 24px;
  border: 1px dashed var(--pd-border-strong);
  border-radius: var(--pd-radius);
  text-align: center;
}
.capture-empty,
.capture-selected {
  color: var(--pd-muted);
  font-size: 12px;
}
.capture-selected,
.capture-error {
  margin-top: 12px;
  font-size: 12px;
}
.capture-error {
  color: var(--pd-danger);
}
.permissions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  margin: 20px 0;
  padding: 16px 0;
  border-block: 1px solid var(--pd-border);
  > div {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
  }
  > div > span:nth-child(2) {
    color: var(--pd-muted);
  }
}
.tip {
  margin-top: 16px;
  color: var(--pd-muted);
  font-size: 12px;
}
.quality-settings {
  margin-top: 24px;
  padding: 0 18px;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius);
  background: var(--pd-surface-soft);
  summary {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 52px;
    color: var(--pd-muted);
    font-size: 12px;
    cursor: pointer;
    list-style: none;
    &::-webkit-details-marker {
      display: none;
    }
    svg {
      width: 17px;
      height: 17px;
    }
  }
  .quality-caption {
    margin-left: auto;
    font-size: 11px;
  }
  .quality-chevron {
    width: 14px;
    height: 14px;
  }
  &[open] .quality-chevron {
    transform: rotate(180deg);
  }
}
.link-config {
  padding: 8px 0 18px;
  .link-item {
    margin: 10px 0;
  }
  .link-label {
    min-width: 64px;
    color: var(--pd-muted);
    font-size: 13px;
  }
}
.invite-info {
  visibility: hidden;
  width: 0;
  height: 0;
}
.debug-info {
  position: fixed;
  right: 0;
  bottom: 0;
  font-size: 12px;
  .link {
    color: var(--pd-danger);
    cursor: pointer;
  }
}
.mobile-fab {
  display: none;
}
.mobile-section-title {
  display: none;
}
.list {
  margin-top: 20px;
  .item {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-bottom: 8px;
    padding: 12px;
    border-radius: var(--pd-radius);
    background: var(--pd-accent-soft);
    font-size: 13px;
  }
  .del {
    margin-left: auto;
    padding: 6px 12px;
    border-radius: var(--pd-radius-sm);
    background: var(--pd-danger-soft);
    color: var(--pd-danger);
    cursor: pointer;
  }
}
@keyframes rotate {
  to {
    transform: rotate(360deg);
  }
}
@media (min-width: 1080px) {
  .connection-state {
    position: absolute;
    top: 0;
    right: 0;
    margin-top: 0;
  }
}
@media (max-width: 700px) {
  .mobile-section-title {
    display: block;
    margin: 26px 0 10px;
    color: var(--pd-muted);
    font-family: var(--pd-mono);
    font-size: 12px;
    letter-spacing: 1px;
  }
  .mobile-fab {
    position: fixed;
    right: 20px;
    bottom: max(20px, env(safe-area-inset-bottom));
    z-index: 30;
    display: grid;
    place-items: center;
    width: 62px;
    height: 62px;
    padding: 0;
    border: 1px solid var(--pd-accent);
    border-radius: var(--pd-radius);
    background: var(--pd-accent);
    color: var(--pd-on-accent);
    box-shadow: 0 12px 34px rgb(22 138 58 / 22%);
    cursor: pointer;
    svg {
      width: 28px;
      height: 28px;
    }
    &:disabled {
      opacity: 0.45;
      cursor: default;
    }
  }
  .page-heading {
    padding-bottom: 16px;
    border-bottom: 0;
    h1 {
      margin-top: 16px;
      font-size: 28px;
    }
    p {
      font-size: 13px;
    }
  }
  .remote-device {
    margin-top: 0;
    padding: 20px;
    border-radius: var(--pd-radius-lg);
  }
  .connection-heading {
    gap: 8px;
    margin-bottom: 24px;
  }
  .section-heading {
    gap: 10px;
  }
  .section-icon {
    flex-basis: 38px;
    width: 38px;
    height: 38px;
    border-radius: var(--pd-radius-sm);
    svg {
      width: 20px;
      height: 20px;
    }
  }
  .label {
    font-size: 16px;
  }
  .scan-button {
    width: 40px;
    padding: 9px;
    span {
      display: none;
    }
  }
  .remote-device .info {
    gap: 8px;
  }
  .btn {
    min-width: 76px;
    padding-inline: 12px;
    font-size: 13px;
  }
  .ipt {
    padding-left: 12px;
    font-size: 17px;
    letter-spacing: 1px;
    &::placeholder {
      font-size: 12px;
    }
  }
  .workflow-guide {
    margin-top: 24px;
  }
  .guide-items {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    scrollbar-width: none;
    &::-webkit-scrollbar {
      display: none;
    }
    > div {
      flex: 0 0 160px;
      padding: 14px;
    }
  }
  .target-heading {
    flex-wrap: wrap;
  }
  .quality-caption {
    display: none;
  }
  .quality-chevron {
    margin-left: auto;
  }
}
@media (max-width: 440px) {
  .local-device .info {
    grid-template-columns: 1fr;
    gap: 18px;
  }
  .local-device .info-right {
    border-left: 0;
    border-top: 1px solid var(--pd-border);
    padding: 18px 0 0;
  }
}
@media (max-width: 380px) {
  .remote-device .info {
    flex-wrap: wrap;
  }
  .ipt-wrap {
    flex-basis: 100%;
  }
  .btn {
    width: 100%;
    height: 46px;
  }
}
</style>
