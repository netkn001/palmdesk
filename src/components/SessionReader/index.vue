<template>
  <section
    class="reader-panel"
    aria-label="会话阅读"
  >
    <div
      v-if="!client && !selected"
      class="empty-reader"
      role="status"
    >
      <strong>连接中</strong>
      <p>请先切到窗口，或确认设备版本一致。</p>
    </div>
    <div
      v-else-if="settings && !settings.enabled"
      class="empty-reader"
    >
      <strong>{{
        settings.supported ? '开启会话阅读' : '此电脑暂不支持会话阅读'
      }}</strong>
      <p>
        {{
          settings.supported
            ? '在电脑首页开启「会话阅读」即可查看本地会话。'
            : '会话阅读支持 macOS 和 Windows。'
        }}
      </p>
      <button
        type="button"
        :disabled="busy"
        @click="initialize()"
      >
        重新检查
      </button>
    </div>
    <template v-else-if="!selected">
      <div class="reader-heading">
        <div>
          <span class="eyebrow">会话</span>
          <h2>最近会话</h2>
        </div>
        <button
          type="button"
          :disabled="busy || !settings?.enabled"
          @click="loadList"
        >
          刷新
        </button>
      </div>
      <form
        class="reader-search"
        @submit.prevent="loadList"
      >
        <div class="search-input-wrap">
          <input
            v-model="query"
            aria-label="搜索会话"
            placeholder="搜索项目、标题或内容…"
            maxlength="200"
          />
          <button
            v-if="query"
            type="button"
            class="search-clear-btn"
            aria-label="清空搜索"
            @click="clearQuery"
          >
            ×
          </button>
        </div>
        <button
          type="submit"
          class="search-submit-btn"
          :disabled="busy || !settings?.enabled"
        >
          搜索
        </button>
      </form>

      <div
        class="filter-chip-bar"
        role="toolbar"
        aria-label="快捷分类筛选"
      >
        <button
          type="button"
          class="filter-chip"
          :class="{ active: selectedFilter === 'all' }"
          @click="selectedFilter = 'all'"
        >
          全部
          <span class="chip-count">{{ sessions.length }}</span>
        </button>

        <button
          v-if="runningSessionsCount > 0"
          type="button"
          class="filter-chip running-chip"
          :class="{ active: selectedFilter === 'running' }"
          @click="selectedFilter = 'running'"
        >
          <span class="status-dot pulse"></span>
          运行中
          <span class="chip-count">{{ runningSessionsCount }}</span>
        </button>

        <!-- 动态 Agent 来源标签 -->
        <button
          v-for="agent in availableAgents"
          :key="agent.key"
          type="button"
          class="filter-chip agent-chip"
          :class="[
            `agent-${agent.key}`,
            { active: selectedFilter === `agent:${agent.key}` },
          ]"
          @click="selectedFilter = `agent:${agent.key}`"
        >
          <span class="chip-icon">{{ agent.icon }}</span>
          {{ agent.label }}
          <span class="chip-count">{{ agent.count }}</span>
        </button>

        <!-- 视觉分隔线 -->
        <span
          v-if="availableAgents.length > 0 && availableProjects.length > 0"
          class="chip-divider"
          aria-hidden="true"
        ></span>

        <!-- 动态项目工程标签 -->
        <button
          v-for="proj in availableProjects"
          :key="proj.name"
          type="button"
          class="filter-chip project-chip"
          :class="{ active: selectedFilter === `project:${proj.name}` }"
          @click="selectedFilter = `project:${proj.name}`"
        >
          <span class="chip-icon">📁</span>
          {{ proj.name }}
          <span class="chip-count">{{ proj.count }}</span>
        </button>
      </div>

      <div class="reader-scroll session-list">
        <template v-if="groupedSessions.length > 0">
          <section
            v-for="group in groupedSessions"
            :key="group.id"
            class="session-group"
          >
            <header class="sticky-group-header">
              <span class="group-title">{{ group.title }}</span>
              <span class="group-count">{{ group.sessions.length }}</span>
            </header>
            <div class="group-cards">
              <button
                v-for="session in group.sessions"
                :key="session.id"
                class="session-card"
                :class="{ 'is-running': isSessionActive(session) }"
                type="button"
                :disabled="busy"
                @click="openSession(session)"
              >
                <div class="session-card-header">
                  <span
                    class="project-badge"
                    :title="session.projectPath"
                  >
                    {{ projectName(session.projectPath) }}
                  </span>
                  <time class="session-card-time">{{
                    formatSessionTime(session.lastUpdatedAt)
                  }}</time>
                  <div class="session-card-status">
                    <span
                      v-if="isSessionActive(session)"
                      class="status-pill running"
                    >
                      <span class="status-dot pulse"></span>
                      {{ activeStateLabel(session) }}
                    </span>
                    <span
                      v-else-if="session.turnState === 'waiting_user'"
                      class="status-pill waiting"
                    >
                      <span class="status-dot warning"></span>
                      待确认
                    </span>
                    <span
                      v-else
                      class="status-pill idle"
                    >
                      {{ turnLabel(session.turnState) }}
                    </span>
                  </div>
                </div>

                <div class="session-card-body">
                  <strong class="session-card-title">{{ session.title }}</strong>
                </div>

                <div class="session-card-footer">
                  <span class="session-preview">
                    {{ session.recentMessage || '打开查看会话记录' }}
                  </span>
                  <span
                    class="session-source-badge"
                    :class="`agent-${getSessionAgentKey(session)}`"
                  >
                    {{ sessionLabel(session) }}
                  </span>
                </div>
              </button>
            </div>
          </section>
        </template>

        <div
          v-else-if="!busy && !error"
          class="empty-list"
        >
          <p>{{ emptyNotice }}</p>
          <button
            v-if="selectedFilter !== 'all' || query"
            type="button"
            class="reset-filter-btn"
            @click="resetFilter"
          >
            重置筛选与搜索
          </button>
        </div>

        <p
          v-if="total > sessions.length"
          class="list-note"
        >
          显示 {{ sessions.length }} / {{ total }} 条；搜索可查找更早会话。
        </p>
      </div>
    </template>
    <template v-else>
      <div class="reader-heading detail-heading">
        <button
          type="button"
          aria-label="返回会话列表"
          @click="back"
        >
          ← 会话
        </button>
        <button
          type="button"
          :disabled="busy"
          @click="loadLatest"
        >
          刷新
        </button>
        <button
          type="button"
          class="primary"
          @click="emit('open-window')"
        >
          继续 ↗
        </button>
      </div>
      <div class="session-context">
        <h2>{{ selected.title }}</h2>
        <p :title="selected.projectPath">
          {{ selected.projectPath || '未提供项目目录' }}
        </p>
        <div>
          <span>{{ sessionLabel(selected) }}</span>
          <span>{{ turnLabel(selected.turnState) }}</span
          ><span>{{
            selected.quality === 'complete' ? '完整记录' : '记录可能不完整'
          }}</span>
        </div>
        <p
          v-if="windowName"
          class="window-link"
        >
          关联窗口：{{ windowName }} · 发送前确认任务
        </p>
      </div>
      <button
        v-if="hasUpdate"
        type="button"
        class="update-banner"
        :disabled="busy"
        @click="loadLatest"
      >
        有新内容 · 查看最新回复 ↓
      </button>
      <div
        ref="scrollArea"
        class="reader-scroll timeline"
        @scroll="handleScroll"
        @click="handleTimelineClick"
      >
        <button
          v-if="hasMore"
          type="button"
          class="load-older"
          :disabled="busy"
          @click="loadOlder"
        >
          加载更早的记录
        </button>
        <template
          v-for="block in blocks"
          :key="block.id"
        >
          <!-- 1. 消息卡片 (用户 / 助手) -->
          <article
            v-if="block.type === 'message' && block.message"
            class="message-card"
            :class="{ 'user-message': block.message.role === 'user' }"
            :data-message-id="block.id"
          >
            <header>
              <span class="role-badge">{{ roleLabel(block.message.role) }}</span>
              <button
                type="button"
                class="copy-btn"
                @click="copy(block.message)"
              >
                {{ copied === block.id ? '已复制' : '复制' }}
              </button>
            </header>
            <div
              class="message-body"
              v-html="renderMarkdown(block.message.text)"
            ></div>
            <p
              v-if="block.message.truncated"
              class="truncation"
            >
              内容过长，仅显示前 16,384 字符；完整内容请在原窗口查看。
            </p>
          </article>

          <!-- 2. 模型思考过程卡片 (可折叠抽屉) -->
          <details
            v-else-if="block.type === 'thinking' && block.item"
            class="thinking-card"
            :data-item-id="block.id"
          >
            <summary class="thinking-summary">
              <span class="thinking-icon">🧠</span>
              <span class="thinking-title">思考过程</span>
              <span class="thinking-badge">已完成推理</span>
            </summary>
            <div
              class="thinking-content"
              v-html="renderMarkdown(block.item.text)"
            ></div>
          </details>

          <!-- 3. Bash 命令行终端卡片 -->
          <div
            v-else-if="block.type === 'command' && block.item"
            class="command-card"
            :data-item-id="block.id"
          >
            <div class="command-header">
              <div class="terminal-dots">
                <span class="dot red"></span>
                <span class="dot yellow"></span>
                <span class="dot green"></span>
              </div>
              <span class="command-tag">{{ block.item.title || '命令' }}</span>
              <button
                type="button"
                class="command-copy-btn"
                @click="copyText(block.item.text, block.id)"
              >
                {{ copied === block.id ? '已复制' : '复制命令' }}
              </button>
            </div>
            <div class="command-prompt">
              <span class="prompt-symbol">$</span>
              <pre class="command-line">{{ block.item.text }}</pre>
            </div>
            <details
              v-if="block.item.detail"
              class="command-output-disclosure"
            >
              <summary>查看输出 ({{ lineCount(block.item.detail) }} 行)</summary>
              <pre class="command-output">{{ block.item.detail }}</pre>
            </details>
            <p
              v-if="block.item.truncated"
              class="truncation"
            >
              长内容已截断，完整内容请在原窗口查看。
            </p>
          </div>

          <!-- 4. 文件差异 Diff 卡片 -->
          <div
            v-else-if="block.type === 'file_change' && block.item"
            class="diff-card"
            :data-item-id="block.id"
          >
            <div class="diff-header">
              <span class="diff-icon">📝</span>
              <span class="diff-path" :title="block.item.title">{{ block.item.title }}</span>
              <span v-if="block.item.text" class="diff-summary">{{ block.item.text }}</span>
            </div>
            <details
              v-if="block.item.detail"
              class="diff-disclosure"
              open
            >
              <summary>差异对比</summary>
              <pre class="diff-content">{{ block.item.detail }}</pre>
            </details>
          </div>

          <!-- 5. 工具调用卡片 -->
          <details
            v-else-if="block.type === 'tool_call' && block.item"
            class="tool-call-card"
            :data-item-id="block.id"
          >
            <summary class="tool-call-summary">
              <span class="tool-icon">🛠️</span>
              <strong class="tool-title">{{ block.item.title }}</strong>
            </summary>
            <div class="tool-details">
              <div v-if="block.item.text" class="tool-section">
                <span class="section-label">参数:</span>
                <pre class="tool-code">{{ block.item.text }}</pre>
              </div>
              <div v-if="block.item.detail" class="tool-section">
                <span class="section-label">结果:</span>
                <pre class="tool-code">{{ block.item.detail }}</pre>
              </div>
            </div>
            <p
              v-if="block.item.truncated"
              class="truncation"
            >
              长内容已截断，完整内容请在原窗口查看。
            </p>
          </details>

          <!-- 6. 其他辅助动作组 -->
          <details
            v-else-if="block.actions && block.actions.length"
            class="activity-group"
          >
            <summary>
              工具活动 <span>{{ block.actions.length }} 项</span>
            </summary>
            <section
              v-for="item in block.actions"
              :key="item.id"
              class="activity-item"
            >
              <strong>{{ item.title || '活动' }}</strong>
              <pre v-if="item.text">{{ item.text }}</pre>
              <details
                v-if="item.detail"
                class="tool-output"
              >
                <summary>查看输出</summary>
                <pre>{{ item.detail }}</pre>
              </details>
            </section>
          </details>
        </template>

        <!-- 实时执行状态栏 (Live Activity Bar) -->
        <div
          v-if="isAgentRunning"
          class="live-activity-bar"
          :class="agentStateClass"
        >
          <span class="pulse-indicator"></span>
          <span class="activity-label">{{ agentStateLabel }}</span>
          <span
            v-if="selected?.statusDetail"
            class="activity-detail"
          >{{ selected.statusDetail }}</span>
        </div>

        <p
          v-if="!busy && !items.length && !error"
          class="empty-list"
        >
          暂未读取到消息，可稍后刷新或前往窗口查看。
        </p>

        <!-- 悬浮智能贴底定位按钮 -->
        <button
          v-if="userScrolledUp"
          type="button"
          class="scroll-bottom-floating-btn"
          aria-label="回到底部"
          @click="scrollToBottom"
        >
          ↓ 最新内容
        </button>
      </div>
    </template>
    <p
      v-if="busy && !polling"
      class="reader-notice"
      role="status"
    >
      正在读取…
    </p>
    <p
      v-if="error"
      class="reader-notice error"
      role="alert"
    >
      {{ error }}
      <button
        v-if="!settings"
        type="button"
        :disabled="busy"
        @click="initialize()"
      >
        重试
      </button>
    </p>
    <p
      v-if="copyError"
      class="reader-notice error"
      role="alert"
    >
      {{ copyError }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';

import type { ReaderClient } from '@/utils/session-reader-channel';
import { renderMarkdown } from '@/utils/markdown-renderer';

import type {
  ReaderItem,
  ReaderList,
  ReaderPage,
  ReaderSession,
  ReaderSettings,
} from '../../../session-core/index.mjs';

const props = defineProps<{
  client?: ReaderClient;
  revision?: number;
  active: boolean;
  windowName?: string;
}>();
const emit = defineEmits<{
  'open-window': [];
  select: [session: ReaderSession | undefined];
  available: [enabled: boolean];
}>();

const settings = ref<ReaderSettings>();
const sessions = ref<ReaderSession[]>([]);
const total = ref(0);
const query = ref('');
const selectedFilter = ref<string>('all');
const selected = ref<ReaderSession>();
const items = ref<ReaderItem[]>([]);
const nextCursor = ref<string>();
const hasMore = ref(false);
const hasUpdate = ref(false);
const busy = ref(false);
const polling = ref(false);
const error = ref('');
const copied = ref('');
const copyError = ref('');
const scrollArea = ref<HTMLElement>();
const userScrolledUp = ref(false);

let generation = 0;
let latestSignature = '';
let unwatchActiveSession: (() => void) | undefined;

interface TimelineBlock {
  id: string;
  type:
    | 'message'
    | 'thinking'
    | 'command'
    | 'file_change'
    | 'tool_call'
    | 'actions';
  message?: ReaderItem;
  item?: ReaderItem;
  actions: ReaderItem[];
}

const blocks = computed<TimelineBlock[]>(() => {
  const result: TimelineBlock[] = [];
  items.value.forEach((item) => {
    if (item.type === 'message') {
      result.push({
        id: item.id,
        type: 'message',
        message: item,
        actions: [],
      });
    } else if (item.type === 'thinking') {
      result.push({ id: item.id, type: 'thinking', item, actions: [] });
    } else if (item.type === 'command') {
      result.push({ id: item.id, type: 'command', item, actions: [] });
    } else if (item.type === 'file_change') {
      result.push({ id: item.id, type: 'file_change', item, actions: [] });
    } else if (item.type === 'tool_call') {
      result.push({ id: item.id, type: 'tool_call', item, actions: [] });
    } else {
      const previous = result[result.length - 1];
      if (previous && previous.type === 'actions') {
        previous.actions.push(item);
      } else {
        result.push({ id: item.id, type: 'actions', actions: [item] });
      }
    }
  });
  return result;
});

const turnLabel = (state: string) =>
  ({
    running: '正在执行',
    thinking: '正在思考',
    executing_tool: '执行工具中',
    waiting_user: '等待确认',
    idle: '已就绪',
    unknown: '状态未知',
  })[state] || '已就绪';

function isSessionActive(session?: ReaderSession) {
  if (!session) return false;
  return (
    session.turnState === 'running' ||
    session.turnState === 'thinking' ||
    session.turnState === 'executing_tool'
  );
}

function activeStateLabel(session?: ReaderSession) {
  if (!session) return '正在执行';
  if (session.turnState === 'thinking') return '思考中';
  if (session.turnState === 'executing_tool') return '工具调用';
  return '正在执行';
}

const sessionLabel = (session?: ReaderSession) =>
  ({
    codex: 'Codex',
    'claude-code': 'Claude Code',
    'claude-desktop': 'Claude Desktop · Code',
    workbuddy: 'WorkBuddy',
  })[session?.source || session?.providerId || ''] || '助手';

const roleLabel = (role?: string) =>
  ({
    user: '你',
    assistant: sessionLabel(selected.value),
    system: '系统',
    tool: '工具',
  })[role || ''] || '消息';

const projectName = (value: string) =>
  value.split(/[\\/]/).filter(Boolean).pop() || '未提供项目';

function formatSessionTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const time = date.getTime();

  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  const hhmm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  if (time >= startOfToday) {
    return hhmm;
  }
  if (time >= startOfYesterday) {
    return `昨天 ${hhmm}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

type TimeBucket = 'today' | 'yesterday' | 'week' | 'earlier';

function getTimeBucket(dateStr: string): TimeBucket {
  const date = new Date(dateStr);
  if (!Number.isFinite(date.getTime())) return 'earlier';
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfWeek = startOfToday - 6 * 86400000;
  const time = date.getTime();

  if (time >= startOfToday) return 'today';
  if (time >= startOfYesterday) return 'yesterday';
  if (time >= startOfWeek) return 'week';
  return 'earlier';
}

interface AgentCategory {
  key: string;
  label: string;
  icon: string;
  count: number;
}

function getSessionAgentKey(session?: ReaderSession): string {
  return session?.source || session?.providerId || 'unknown';
}

const availableAgents = computed<AgentCategory[]>(() => {
  const counts = new Map<string, number>();
  for (const s of sessions.value) {
    const key = getSessionAgentKey(s);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const result: AgentCategory[] = [];
  const defs: Record<string, { label: string; icon: string }> = {
    'claude-code': { label: 'Claude Code', icon: '🤖' },
    codex: { label: 'Codex', icon: '⚡' },
    'claude-desktop': { label: 'Claude Desktop', icon: '💻' },
    workbuddy: { label: 'WorkBuddy', icon: '💼' },
  };

  for (const [key, meta] of Object.entries(defs)) {
    const count = counts.get(key) || 0;
    if (count > 0) {
      result.push({ key, label: meta.label, icon: meta.icon, count });
    }
  }
  return result;
});

const availableProjects = computed(() => {
  const counts = new Map<string, number>();
  for (const s of sessions.value) {
    const name = projectName(s.projectPath);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
});

const runningSessionsCount = computed(() => {
  return sessions.value.filter(isSessionActive).length;
});

const filteredSessions = computed<ReaderSession[]>(() => {
  const filter = selectedFilter.value;
  const search = query.value.trim().toLowerCase();

  return sessions.value.filter((session) => {
    if (filter === 'running') {
      if (!isSessionActive(session)) return false;
    } else if (filter.startsWith('agent:')) {
      const agentKey = filter.slice(6);
      if (getSessionAgentKey(session) !== agentKey) return false;
    } else if (filter.startsWith('project:')) {
      const projectNameValue = filter.slice(8);
      if (projectName(session.projectPath) !== projectNameValue) return false;
    } else if (filter !== 'all') {
      if (projectName(session.projectPath) !== filter) return false;
    }

    if (search) {
      const match = [
        session.title,
        projectName(session.projectPath),
        sessionLabel(session),
        session.recentMessage,
      ].some((str) => (str || '').toLowerCase().includes(search));
      if (!match) return false;
    }

    return true;
  });
});

interface SessionGroup {
  id: TimeBucket;
  title: string;
  sessions: ReaderSession[];
}

const groupedSessions = computed<SessionGroup[]>(() => {
  const today: ReaderSession[] = [];
  const yesterday: ReaderSession[] = [];
  const week: ReaderSession[] = [];
  const earlier: ReaderSession[] = [];

  for (const session of filteredSessions.value) {
    const bucket = getTimeBucket(session.lastUpdatedAt);
    if (bucket === 'today') today.push(session);
    else if (bucket === 'yesterday') yesterday.push(session);
    else if (bucket === 'week') week.push(session);
    else earlier.push(session);
  }

  const groups: SessionGroup[] = [];
  if (today.length > 0)
    groups.push({ id: 'today', title: '今天', sessions: today });
  if (yesterday.length > 0)
    groups.push({ id: 'yesterday', title: '昨天', sessions: yesterday });
  if (week.length > 0)
    groups.push({ id: 'week', title: '近 7 天', sessions: week });
  if (earlier.length > 0)
    groups.push({ id: 'earlier', title: '更早', sessions: earlier });

  return groups;
});

const emptyNotice = computed(() => {
  if (selectedFilter.value !== 'all' || query.value) {
    return '未找到符合当前筛选条件的会话。';
  }
  return '暂无可读会话。';
});

function clearQuery() {
  query.value = '';
  loadList();
}

function resetFilter() {
  selectedFilter.value = 'all';
  query.value = '';
  loadList();
}

function lineCount(text: string) {
  return String(text ?? '').split('\n').length;
}

const signature = (page: ReaderPage) => JSON.stringify(page);

const isAgentRunning = computed(() => {
  const state = selected.value?.turnState;
  return (
    state === 'running' ||
    state === 'thinking' ||
    state === 'executing_tool' ||
    state === 'waiting_user'
  );
});

const agentStateClass = computed(() => selected.value?.turnState || 'running');

const agentStateLabel = computed(() => {
  const state = selected.value?.turnState;
  if (state === 'thinking') return '🧠 思考中…';
  if (state === 'executing_tool') return '⚡ 正在执行工具…';
  if (state === 'waiting_user') return '⏳ 等待确认…';
  return '⚡ Agent 正在执行…';
});

function handleScroll() {
  if (!scrollArea.value) return;
  const { scrollTop, scrollHeight, clientHeight } = scrollArea.value;
  const distanceToBottom = scrollHeight - scrollTop - clientHeight;
  userScrolledUp.value = distanceToBottom > 80;
}

function scrollToBottom() {
  if (!scrollArea.value) return;
  userScrolledUp.value = false;
  scrollArea.value.scrollTo({
    top: scrollArea.value.scrollHeight,
    behavior: 'smooth',
  });
}

async function handleTimelineClick(event: MouseEvent) {
  const target = (event.target as HTMLElement)?.closest<HTMLElement>(
    '.code-copy-btn'
  );
  if (!target) return;
  const raw = target.getAttribute('data-clipboard-text');
  if (!raw) return;
  try {
    const text = decodeURIComponent(raw);
    await navigator.clipboard.writeText(text);
    const originalText = target.textContent;
    target.textContent = '已复制';
    target.classList.add('copied');
    setTimeout(() => {
      target.textContent = originalText;
      target.classList.remove('copied');
    }, 2000);
  } catch {
    copyError.value = '无法访问剪贴板，请长按选择文字复制。';
  }
}

async function copyText(text: string, id: string) {
  copyError.value = '';
  try {
    await navigator.clipboard.writeText(text);
    copied.value = id;
    setTimeout(() => {
      if (copied.value === id) copied.value = '';
    }, 2000);
  } catch {
    copyError.value = '无法访问剪贴板，请长按选择文字复制。';
  }
}

async function run<T>(
  request: Parameters<ReaderClient['request']>[0],
  accept: (value: T) => void | Promise<void>
) {
  const client = props.client;
  if (!client || busy.value) return;
  const current = generation;
  busy.value = true;
  error.value = '';
  try {
    const result = await client.request<T>(request);
    if (current === generation) {
      await accept(result);
      return result;
    }
  } catch (cause) {
    if (current === generation)
      error.value = cause instanceof Error ? cause.message : '读取失败，请重试';
  } finally {
    if (current === generation) busy.value = false;
  }
}

function cleanupWatcher() {
  if (unwatchActiveSession) {
    unwatchActiveSession();
    unwatchActiveSession = undefined;
  }
}

function subscribeWatcher(sessionId: string) {
  cleanupWatcher();
  const client = props.client;
  if (!client) return;

  const unlisten = client.onPush((pushPage: ReaderPage) => {
    if (!selected.value || selected.value.id !== sessionId) return;
    if (!pushPage || !pushPage.session) return;

    selected.value = pushPage.session;

    const pageItemMap = new Map(pushPage.items.map((i) => [i.id, i]));
    const existingIds = new Set(items.value.map((i) => i.id));

    // Update existing items in-place (e.g. tool output arrived)
    items.value = items.value.map((item) => pageItemMap.get(item.id) || item);

    // Append newly arrived items
    const newItems = pushPage.items.filter((i) => !existingIds.has(i.id));
    if (newItems.length > 0) {
      items.value = [...items.value, ...newItems];
    }

    latestSignature = signature(pushPage);
    hasUpdate.value = false;
    emit('select', pushPage.session);

    // Smart stick-to-bottom
    nextTick(() => {
      if (!userScrolledUp.value && scrollArea.value) {
        scrollArea.value.scrollTo({
          top: scrollArea.value.scrollHeight,
          behavior: 'smooth',
        });
      }
    });
  });

  void client.request({ method: 'watch', id: sessionId }).catch(() => {});

  unwatchActiveSession = () => {
    unlisten();
    void client.request({ method: 'unwatch', id: sessionId }).catch(() => {});
  };
}

function clearReading() {
  cleanupWatcher();
  settings.value = undefined;
  sessions.value = [];
  selected.value = undefined;
  items.value = [];
  hasUpdate.value = false;
  selectedFilter.value = 'all';
  emit('select', undefined);
}

async function initialize(reset = true) {
  generation += 1;
  cleanupWatcher();
  busy.value = false;
  polling.value = false;
  if (reset) clearReading();
  error.value = '';
  copyError.value = '';
  const state = await run<ReaderSettings>({ method: 'status' }, (value) => {
    if (!value.enabled) clearReading();
    settings.value = value;
    emit('available', value.enabled);
  });
  if (state?.enabled) {
    if (selected.value) await poll();
    else await loadList();
  }
}

async function loadList() {
  await run<ReaderList>({ method: 'list', query: query.value }, (value) => {
    sessions.value = value.sessions;
    total.value = value.total;
  });
}

async function openSession(session: ReaderSession) {
  if (busy.value) return;
  selected.value = session;
  items.value = [];
  hasMore.value = false;
  hasUpdate.value = false;
  copyError.value = '';
  userScrolledUp.value = false;
  emit('select', session);
  await loadLatest();
  subscribeWatcher(session.id);
}

async function loadLatest() {
  if (!selected.value) return;
  await run<ReaderPage>(
    { method: 'read', id: selected.value.id },
    async (page) => {
      selected.value = page.session;
      items.value = page.items;
      hasMore.value = page.hasMore;
      nextCursor.value = page.nextCursor;
      latestSignature = signature(page);
      hasUpdate.value = false;
      emit('select', page.session);
      await nextTick();
      if (scrollArea.value) {
        scrollArea.value.scrollTop = scrollArea.value.scrollHeight;
      }
    }
  );
}

async function loadOlder() {
  if (!selected.value || !nextCursor.value) return;
  const height = scrollArea.value?.scrollHeight || 0;
  const top = scrollArea.value?.scrollTop || 0;
  await run<ReaderPage>(
    { method: 'read', id: selected.value.id, cursor: nextCursor.value },
    async (page) => {
      const existing = new Set(items.value.map((item) => item.id));
      items.value = [
        ...page.items.filter((item) => !existing.has(item.id)),
        ...items.value,
      ];
      hasMore.value = page.hasMore;
      nextCursor.value = page.nextCursor;
      await nextTick();
      if (scrollArea.value)
        scrollArea.value.scrollTop =
          top + scrollArea.value.scrollHeight - height;
    }
  );
}

function back() {
  generation += 1;
  cleanupWatcher();
  busy.value = false;
  selected.value = undefined;
  items.value = [];
  hasUpdate.value = false;
  error.value = '';
  emit('select', undefined);
}

async function copy(item: ReaderItem) {
  copyError.value = '';
  try {
    await navigator.clipboard.writeText(item.text);
    copied.value = item.id;
    setTimeout(() => {
      if (copied.value === item.id) copied.value = '';
    }, 2000);
  } catch {
    copyError.value = '无法访问剪贴板，请长按选择文字复制。';
  }
}

async function poll() {
  if (
    !props.active ||
    !props.client ||
    document.hidden ||
    busy.value ||
    error.value
  )
    return;

  if (!selected.value) {
    if (!polling.value) {
      polling.value = true;
      try {
        await loadList();
      } finally {
        polling.value = false;
      }
    }
    return;
  }

  if (hasUpdate.value) return;

  polling.value = true;
  await run<ReaderPage>({ method: 'read', id: selected.value.id }, (page) => {
    const isNew = signature(page) !== latestSignature;
    if (isNew) {
      if (!userScrolledUp.value) {
        selected.value = page.session;
        const pageItemMap = new Map(page.items.map((i) => [i.id, i]));
        const existingIds = new Set(items.value.map((i) => i.id));
        items.value = items.value.map((item) => pageItemMap.get(item.id) || item);
        const newItems = page.items.filter((i) => !existingIds.has(i.id));
        if (newItems.length > 0) {
          items.value = [...items.value, ...newItems];
        }
        latestSignature = signature(page);
        hasUpdate.value = false;
        emit('select', page.session);
        nextTick(() => {
          if (!userScrolledUp.value && scrollArea.value) {
            scrollArea.value.scrollTo({
              top: scrollArea.value.scrollHeight,
              behavior: 'smooth',
            });
          }
        });
      } else {
        hasUpdate.value = true;
      }
    }
  });
  polling.value = false;
}

watch(
  () => props.client,
  () => {
    void initialize(false);
  },
  { immediate: true }
);

watch(
  () => props.revision,
  () => {
    void initialize();
  }
);

// Fallback background liveness check every 5 seconds
const pollTimer = setInterval(() => {
  void poll();
}, 5000);

onUnmounted(() => {
  generation += 1;
  cleanupWatcher();
  clearInterval(pollTimer);
});
</script>

<style scoped>
.reader-panel {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  flex-direction: column;
  background: var(--pd-bg);
  color: var(--pd-text);
}
button,
input {
  font: inherit;
}
button {
  cursor: pointer;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius-sm);
  padding: 9px 13px;
  min-height: 40px;
  color: var(--pd-text);
  background: var(--pd-surface);
}
button:disabled {
  cursor: default;
  opacity: 0.5;
}
button:focus-visible,
input:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--pd-accent);
  outline-offset: 2px;
}
.reader-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 28px 24px 18px;
}
.eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--pd-accent);
}
h2 {
  margin: 4px 0 0;
  font-size: 21px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.reader-search {
  display: flex;
  gap: 8px;
  padding: 0 24px 10px;
  width: 100%;
  max-width: 860px;
  box-sizing: border-box;
  margin: 0 auto;
}
.search-input-wrap {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
}
.search-input-wrap input {
  width: 100%;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius-sm);
  padding: 10px 32px 10px 12px;
  background: var(--pd-surface);
  color: var(--pd-text);
  font-size: 13px;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.2s;
}
.search-input-wrap input:focus {
  border-color: var(--pd-accent);
}
.search-clear-btn {
  position: absolute;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(125, 125, 125, 0.2);
  color: var(--pd-muted);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.search-clear-btn:hover {
  background: rgba(125, 125, 125, 0.4);
  color: var(--pd-text);
}
.search-submit-btn {
  flex-shrink: 0;
  padding: 0 16px;
  font-size: 13px;
  border-radius: var(--pd-radius-sm);
}

/* 横向滑动 Filter Chip 胶囊筛选栏 */
.filter-chip-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 24px 12px;
  width: 100%;
  max-width: 860px;
  box-sizing: border-box;
  margin: 0 auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.filter-chip-bar::-webkit-scrollbar {
  display: none;
}
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 16px;
  font-size: 12px;
  background: var(--pd-surface);
  border: 1px solid var(--pd-border);
  color: var(--pd-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
  user-select: none;
}
.filter-chip:hover {
  border-color: var(--pd-border-strong);
  color: var(--pd-text);
}
.filter-chip.active {
  background: rgba(22, 138, 58, 0.15);
  border-color: var(--pd-accent);
  color: var(--pd-accent);
  font-weight: 600;
}
.filter-chip .chip-count {
  font-size: 10px;
  opacity: 0.8;
  padding: 1px 5px;
  border-radius: 8px;
  background: rgba(125, 125, 125, 0.16);
}
.filter-chip.running-chip {
  border-color: rgba(16, 185, 129, 0.3);
}
.chip-divider {
  width: 1px;
  height: 18px;
  background: var(--pd-border);
  margin: 0 4px;
  flex-shrink: 0;
  opacity: 0.8;
}
.chip-icon {
  font-size: 11px;
  display: inline-flex;
  align-items: center;
}
.filter-chip.agent-chip.agent-claude-code.active,
.filter-chip.agent-chip.agent-claude-desktop.active {
  background: rgba(168, 85, 247, 0.16);
  border-color: #a855f7;
  color: #d8b4fe;
}
.filter-chip.agent-chip.agent-codex.active {
  background: rgba(16, 185, 129, 0.16);
  border-color: #10b981;
  color: #6ee7b7;
}
.filter-chip.agent-chip.agent-workbuddy.active {
  background: rgba(59, 130, 246, 0.16);
  border-color: #3b82f6;
  color: #93c5fd;
}

/* 列表滚动容器 */
.reader-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
.session-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 860px;
  box-sizing: border-box;
  margin: 0 auto;
  padding: 0 24px 32px;
}

/* 时间分组与粘性吸顶 */
.session-group {
  display: flex;
  flex-direction: column;
}
.sticky-group-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  margin-bottom: 8px;
  background: rgba(26, 32, 28, 0.88);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-radius: var(--pd-radius-sm);
  border-bottom: 1px solid var(--pd-border);
}
.group-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--pd-muted);
  letter-spacing: 0.5px;
}
.group-count {
  font-size: 11px;
  color: var(--pd-muted);
  background: var(--pd-surface);
  padding: 1px 7px;
  border-radius: 10px;
  border: 1px solid var(--pd-border);
}
.group-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 结构化会话卡片 */
.session-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  text-align: left;
  border-radius: var(--pd-radius);
  background: var(--pd-surface);
  border: 1px solid var(--pd-border);
  box-shadow: var(--pd-shadow);
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s, transform 0.15s;
}
.session-card:hover {
  border-color: var(--pd-border-strong);
  background: var(--pd-surface-soft);
  transform: translateY(-1px);
}
.session-card.is-running {
  border-color: rgba(16, 185, 129, 0.45);
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.1);
}

/* 卡片顶栏 */
.session-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.project-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--pd-accent);
  background: rgba(22, 138, 58, 0.12);
  padding: 2px 7px;
  border-radius: 4px;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-card-time {
  color: var(--pd-muted);
  font-size: 11px;
  flex-shrink: 0;
}
.session-card-status {
  margin-left: auto;
  display: flex;
  align-items: center;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 10px;
  font-weight: 500;
}
.status-pill.running {
  color: #10b981;
  background: rgba(16, 185, 129, 0.14);
}
.status-pill.waiting {
  color: #eab308;
  background: rgba(234, 179, 8, 0.14);
}
.status-pill.idle {
  color: var(--pd-muted);
}

/* 卡片中栏 */
.session-card-body {
  margin: 1px 0;
}
.session-card-title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--pd-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

/* 卡片底栏 */
.session-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}
.session-preview {
  color: var(--pd-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.session-source-badge {
  font-size: 10px;
  color: var(--pd-muted);
  background: rgba(255, 255, 255, 0.05);
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--pd-border);
  flex-shrink: 0;
  font-weight: 500;
  transition: all 0.2s;
}
.session-source-badge.agent-claude-code,
.session-source-badge.agent-claude-desktop {
  background: rgba(168, 85, 247, 0.1);
  color: #c084fc;
  border-color: rgba(168, 85, 247, 0.25);
}
.session-source-badge.agent-codex {
  background: rgba(16, 185, 129, 0.1);
  color: #34d399;
  border-color: rgba(16, 185, 129, 0.25);
}
.session-source-badge.agent-workbuddy {
  background: rgba(59, 130, 246, 0.1);
  color: #60a5fa;
  border-color: rgba(59, 130, 246, 0.25);
}

/* 重置筛选按钮 */
.reset-filter-btn {
  margin-top: 10px;
  padding: 6px 14px;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--pd-border);
  border-radius: 6px;
  color: var(--pd-accent);
  cursor: pointer;
  transition: all 0.15s;
}
.reset-filter-btn:hover {
  background: var(--pd-surface-soft);
  border-color: var(--pd-accent);
}
.detail-heading {
  justify-content: flex-start;
  padding: 10px 16px;
  border-bottom: 1px solid var(--pd-border);
  background: var(--pd-surface);
}
.detail-heading .primary {
  margin-left: auto;
  background: var(--pd-accent);
  color: var(--pd-on-accent);
  border-color: var(--pd-accent);
}
.session-context {
  padding: 12px 20px;
  background: var(--pd-surface);
  border-bottom: 1px solid var(--pd-border);
}
.session-context h2 {
  font-size: 17px;
}
.session-context p {
  margin: 5px 0;
  font-size: 11px;
  color: var(--pd-muted);
  overflow-wrap: anywhere;
}
.session-context > div {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: var(--pd-muted);
  font-size: 11px;
}
.session-context .window-link {
  color: var(--pd-accent);
}
.timeline {
  position: relative;
  padding: 16px max(16px, calc((100% - 860px) / 2)) 32px;
}
.message-card {
  margin-bottom: 14px;
  background: var(--pd-surface);
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius);
  box-shadow: var(--pd-shadow);
  padding: 20px;
}
.user-message {
  background: var(--pd-accent-soft);
  border-color: rgb(22 138 58 / 20%);
}
.message-card header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--pd-muted);
  font-size: 11px;
}
.message-card header button {
  font-size: 11px;
  min-height: 30px;
  padding: 4px 9px;
  background: transparent;
}
.message-body {
  line-height: 1.85;
  font-size: 15px;
  overflow-wrap: anywhere;
  user-select: text;
}
.message-body :deep(p) {
  margin: 12px 0;
}
.message-body :deep(h3),
.message-body :deep(h4),
.message-body :deep(h5) {
  line-height: 1.5;
  margin: 18px 0 8px;
}
.message-body :deep(a) {
  color: var(--pd-accent);
  text-decoration: underline;
}
.message-body :deep(pre),
pre {
  max-width: 100%;
  overflow-x: auto;
  border-radius: var(--pd-radius-sm);
  padding: 12px;
  background: #0a100c;
  color: #b9e8be;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre;
}
.message-body :deep(code) {
  font-family: ui-monospace, monospace;
  font-size: 0.88em;
}
.message-body :deep(blockquote) {
  margin-left: 0;
  padding-left: 14px;
  border-left: 3px solid var(--pd-accent);
  color: var(--pd-muted);
}
.message-body :deep(ul),
.message-body :deep(ol) {
  padding-left: 24px;
}
.activity-group {
  margin-bottom: 14px;
  padding: 12px 16px;
  border: 1px dashed var(--pd-border-strong);
  border-radius: var(--pd-radius);
  background: var(--pd-surface-soft);
  font-size: 13px;
}
summary {
  cursor: pointer;
  line-height: 1.7;
}
summary span {
  float: right;
  color: var(--pd-muted);
  font-size: 11px;
}
.activity-item {
  padding-top: 14px;
  min-width: 0;
}
.activity-item > strong {
  display: block;
  overflow-wrap: anywhere;
}
.tool-output {
  margin: 8px 0;
}
.load-older {
  display: block;
  margin: 0 auto 16px;
  font-size: 12px;
}
.update-banner {
  border: 0;
  border-radius: 0;
  background: var(--pd-accent-soft);
  color: var(--pd-accent);
  font-size: 13px;
}
.empty-reader {
  margin: auto;
  padding: 32px;
  max-width: 450px;
  text-align: center;
  line-height: 1.8;
}
.empty-reader p,
.empty-list,
.list-note {
  color: var(--pd-muted);
  font-size: 13px;
  line-height: 1.8;
}
.empty-list,
.list-note {
  text-align: center;
  padding: 20px 0;
}
.reader-notice {
  flex-shrink: 0;
  margin: 0;
  padding: 8px 16px;
  color: var(--pd-muted);
  background: var(--pd-surface);
  font-size: 12px;
}
.error {
  color: var(--pd-danger);
  background: var(--pd-danger-soft);
}
.truncation {
  font-size: 12px;
  color: var(--pd-warning);
  line-height: 1.7;
}

/* 现代化代码块与高亮样式 */
.message-body :deep(.code-block-container) {
  margin: 12px 0;
  border-radius: var(--pd-radius-sm);
  border: 1px solid var(--pd-border);
  overflow: hidden;
  background: #0d1117;
}
.message-body :deep(.code-block-header) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.message-body :deep(.code-lang-tag) {
  font-size: 11px;
  font-family: monospace;
  color: var(--pd-muted);
  text-transform: lowercase;
}
.message-body :deep(.code-copy-btn) {
  font-size: 11px;
  padding: 2px 8px;
  min-height: 24px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  color: var(--pd-muted);
  cursor: pointer;
  transition: all 0.2s;
}
.message-body :deep(.code-copy-btn:hover) {
  color: var(--pd-text);
  border-color: rgba(255, 255, 255, 0.3);
}
.message-body :deep(.code-copy-btn.copied) {
  color: #10b981;
  border-color: #10b981;
}
.message-body :deep(pre.hljs) {
  margin: 0;
  padding: 12px;
  background: transparent;
  font-size: 13px;
  line-height: 1.5;
  overflow-x: auto;
}

/* 思考过程 (Thinking) 卡片 */
.thinking-card {
  margin-bottom: 14px;
  background: rgba(168, 85, 247, 0.04);
  border: 1px solid rgba(168, 85, 247, 0.2);
  border-radius: var(--pd-radius);
  overflow: hidden;
}
.thinking-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  color: var(--pd-text);
}
.thinking-icon {
  font-size: 14px;
}
.thinking-title {
  font-weight: 600;
  flex: 1;
}
.thinking-badge {
  font-size: 10px;
  color: #c084fc;
  background: rgba(168, 85, 247, 0.15);
  padding: 2px 8px;
  border-radius: 10px;
}
.thinking-content {
  padding: 12px 16px;
  border-top: 1px solid rgba(168, 85, 247, 0.1);
  color: var(--pd-muted);
  font-size: 13px;
  line-height: 1.6;
}

/* Bash 命令终端风格卡片 */
.command-card {
  margin-bottom: 14px;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: var(--pd-radius);
  overflow: hidden;
  box-shadow: var(--pd-shadow);
}
.command-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid #21262d;
}
.terminal-dots {
  display: flex;
  gap: 6px;
}
.terminal-dots .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.terminal-dots .red { background: #ff5f56; }
.terminal-dots .yellow { background: #ffbd2e; }
.terminal-dots .green { background: #27c93f; }
.command-tag {
  font-size: 11px;
  font-family: monospace;
  color: #8b949e;
}
.command-copy-btn {
  font-size: 11px;
  min-height: 24px;
  padding: 2px 8px;
  background: transparent;
  border: 1px solid #30363d;
  color: #8b949e;
  border-radius: 4px;
}
.command-prompt {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 14px;
}
.prompt-symbol {
  color: #58a6ff;
  font-family: monospace;
  font-weight: bold;
  user-select: none;
}
.command-line {
  margin: 0;
  padding: 0;
  background: transparent;
  color: #f0f6fc;
  font-family: monospace;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-all;
}
.command-output-disclosure {
  border-top: 1px solid #21262d;
  background: rgba(0, 0, 0, 0.2);
}
.command-output-disclosure summary {
  padding: 8px 14px;
  font-size: 11px;
  color: #8b949e;
  cursor: pointer;
}
.command-output {
  margin: 0;
  padding: 10px 14px;
  background: transparent;
  color: #8b949e;
  font-family: monospace;
  font-size: 12px;
  max-height: 320px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 文件差异 Diff 卡片 */
.diff-card {
  margin-bottom: 14px;
  background: var(--pd-surface);
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius);
  overflow: hidden;
}
.diff-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--pd-border);
  font-size: 12px;
}
.diff-path {
  font-family: monospace;
  font-weight: 600;
  color: var(--pd-accent);
}
.diff-summary {
  margin-left: auto;
  font-size: 11px;
  color: var(--pd-muted);
}
.diff-disclosure summary {
  padding: 8px 14px;
  font-size: 11px;
  cursor: pointer;
}
.diff-content {
  margin: 0;
  padding: 10px 14px;
  background: #0a100c;
  color: #7ee787;
  font-size: 12px;
  font-family: monospace;
  max-height: 300px;
  overflow-y: auto;
}

/* 工具调用卡片 */
.tool-call-card {
  margin-bottom: 14px;
  background: var(--pd-surface);
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius);
  overflow: hidden;
}
.tool-call-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 13px;
}
.tool-details {
  padding: 10px 14px;
  border-top: 1px solid var(--pd-border);
}
.tool-section {
  margin-bottom: 8px;
}
.section-label {
  font-size: 11px;
  color: var(--pd-muted);
  font-weight: 600;
}
.tool-code {
  margin: 4px 0 0;
  padding: 8px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 4px;
  font-size: 12px;
  max-height: 200px;
  overflow-y: auto;
}

/* 动态状态栏 (Live Activity Bar) */
.live-activity-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 18px;
  margin: 16px auto;
  max-width: 380px;
  background: rgba(22, 138, 58, 0.12);
  border: 1px solid rgba(22, 138, 58, 0.3);
  border-radius: 20px;
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
.pulse-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
  animation: pulseGlow 1.5s infinite ease-in-out;
}
@keyframes pulseGlow {
  0%, 100% {
    transform: scale(0.9);
    opacity: 0.6;
    box-shadow: 0 0 4px #10b981;
  }
  50% {
    transform: scale(1.2);
    opacity: 1;
    box-shadow: 0 0 12px #10b981;
  }
}
.activity-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--pd-text);
}
.activity-detail {
  font-size: 11px;
  color: var(--pd-muted);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 悬浮贴底按钮 */
.scroll-bottom-floating-btn {
  position: sticky;
  bottom: 20px;
  margin-left: auto;
  display: block;
  z-index: 20;
  background: var(--pd-surface);
  color: var(--pd-accent);
  border: 1px solid var(--pd-accent);
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  cursor: pointer;
  transition: transform 0.2s, opacity 0.2s;
}
.scroll-bottom-floating-btn:hover {
  transform: translateY(-2px);
}
@media (min-width: 900px) {
  .reader-heading:not(.detail-heading),
  .reader-search,
  .filter-chip-bar {
    box-sizing: border-box;
    width: 100%;
    max-width: 860px;
    margin-inline: auto;
  }
}
@media (max-width: 420px) {
  .reader-heading {
    padding-inline: 14px;
  }
  .reader-search {
    padding-inline: 14px;
  }
  .filter-chip-bar {
    padding-inline: 14px;
  }
  .session-list {
    padding-inline: 14px;
  }
  .project-badge {
    max-width: 100px;
  }
  .detail-heading {
    gap: 6px;
  }
  .detail-heading button {
    padding-inline: 10px;
    font-size: 12px;
  }
  .session-context {
    padding-inline: 16px;
  }
}
</style>
