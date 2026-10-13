<template>
  <section class="reader-settings pd-card">
    <label>
      <span class="reader-icon"><ReaderOutline aria-hidden="true" /></span>
      <span><strong>会话阅读</strong><small>在手机上跟进工作</small></span>
      <input
        type="checkbox"
        class="pd-switch"
        role="switch"
        aria-label="会话阅读"
        :checked="enabled"
        :disabled="busy || !supported"
        @change="configure"
      />
    </label>
    <p>
      {{
        supported
          ? '读取 Codex、Claude Code 和 Claude Desktop Code 的本地会话。'
          : '会话阅读支持 macOS 和 Windows。'
      }}
    </p>
    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { ReaderOutline } from '@vicons/ionicons5';
import { onMounted, ref } from 'vue';

import { IPC_EVENT } from '@/event';
import { ipcRenderer } from '@/utils';

const emit = defineEmits<{ change: [enabled: boolean] }>();
const enabled = ref(true);
const supported = ref(true);
const busy = ref(true);
const error = ref('');

async function load(channel: string, data = {}) {
  busy.value = true;
  error.value = '';
  try {
    const result = await ipcRenderer?.invoke(channel, {
      requestId: 'reader-settings',
      data,
    });
    if (result?.code !== 0) throw new Error(result?.msg || '无法读取设置');
    enabled.value = result.data.enabled;
    supported.value = result.data.supported;
    emit('change', enabled.value);
  } catch (cause) {
    enabled.value = false;
    emit('change', false);
    error.value = cause instanceof Error ? cause.message : '保存失败';
  } finally {
    busy.value = false;
  }
}

function configure(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  emit('change', false);
  void load(IPC_EVENT.sessionReaderConfigure, { enabled: checked });
}

onMounted(() => {
  void load(IPC_EVENT.sessionReaderSettings);
});
</script>

<style scoped>
.reader-settings {
  margin: 18px 0;
}
label {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}
input {
  margin-left: auto;
}
.reader-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border-radius: var(--pd-radius-sm);
  color: var(--pd-accent);
  background: var(--pd-surface-soft);
}
.reader-icon svg {
  width: 22px;
  height: 22px;
}
strong {
  font-size: 15px;
  font-weight: 600;
}
small {
  display: block;
  margin-top: 3px;
  color: var(--pd-muted);
  font-size: 11px;
}
p {
  margin: 18px 0 0;
  padding-top: 16px;
  border-top: 1px solid var(--pd-border);
  color: var(--pd-muted);
  font-size: 12px;
  line-height: 1.8;
}
[role='alert'] {
  color: var(--pd-danger);
}
</style>
