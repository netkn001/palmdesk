export const AGENT_DEFINITIONS = [
  {
    id: 'codex',
    name: 'Codex',
    bundles: ['com.openai.codex'],
    executables: ['codex.exe'],
  },
  {
    id: 'claude',
    name: 'Claude',
    bundles: ['com.anthropic.claudefordesktop'],
    executables: ['claude.exe'],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    bundles: ['com.openai.chat'],
    executables: ['chatgpt.exe'],
  },
  {
    id: 'kimi',
    name: 'Kimi',
    bundles: ['com.moonshot.kimichat'],
    executables: [
      'kimi.exe',
      'kimi desktop.exe',
      'kimi work.exe',
      'kimi-work.exe',
    ],
  },
  {
    id: 'zcode',
    name: 'ZCode',
    bundles: ['dev.zcode.app'],
    executables: ['zcode.exe'],
  },
  {
    id: 'workbuddy',
    name: 'WorkBuddy',
    bundles: [
      'com.tencent.workbuddy',
      'com.tencent.workbuddy.mac',
      'com.tencent.workbuddy.app',
      'ai.workbuddy.desktop',
    ],
    executables: ['workbuddyai.exe', 'workbuddy.exe'],
  },
] as const;

export type AgentId = (typeof AGENT_DEFINITIONS)[number]['id'];

export function getAgent(id: unknown) {
  return AGENT_DEFINITIONS.find((agent) => agent.id === id);
}

export function identifyAgent(identity: string) {
  const executable = /^win32:(?:.*[\\/])?([^\\/]+\.exe)#[a-f0-9]+$/i
    .exec(identity)?.[1]
    .toLowerCase();
  return AGENT_DEFINITIONS.find(
    (agent) =>
      (agent.bundles as readonly string[]).includes(identity) ||
      (executable &&
        (agent.executables as readonly string[]).includes(executable))
  );
}
