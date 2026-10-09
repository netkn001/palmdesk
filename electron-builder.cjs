/**
 * https://www.electron.build/configuration/configuration
 * https://github.com/electron-vite/electron-vite-vue/blob/main/electron-builder.json5
 */
const { getDesktopIdentity } = require('./scripts/desktop-identity.cjs');
const signingCertificate = require('./build/macos-signing.json');

const channel = process.env.PALMDESK_BUILD_CHANNEL || 'local';
if (!['local', 'release'].includes(channel))
  throw new Error('PALMDESK_BUILD_CHANNEL must be local or release.');
const identity = getDesktopIdentity(__dirname, {
  release: channel === 'release',
});

module.exports = {
  $schema:
    'https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/scheme.json',
  appId: identity.appId,
  productName: identity.productName,
  extraMetadata: { productName: identity.productName },
  beforePack: './scripts/before-pack.cjs',
  directories: {
    output: identity.checkoutId
      ? `electron-release/\${version}/${identity.worktreeId ? 'worktree' : 'local'}-${identity.checkoutId}`
      : 'electron-release/${version}',
  },
  files: [
    'dist',
    'electron-dist',
    'LICENSE.txt',
    'THIRD_PARTY_NOTICES.md',
    'session-core/LICENSE',
    'session-core/NOTICE',
    'session-core/*.node',
    'native-bin/*.node',
  ],
  asarUnpack: ['**/*.node'],
  mac: {
    identity: channel === 'release' ? signingCertificate.sha1 : undefined,
    sign: './scripts/sign-macos.cjs',
    extraFiles: [{ from: 'native-bin/codex-window', to: 'MacOS/codex-window' }],
    target: ['dmg'],
    artifactName: '${productName}-${version}-mac-${arch}.${ext}',
    icon: 'build/icons/icon.icns',
    extendInfo: {
      PalmDeskBuildChannel: channel,
      NSScreenCaptureUsageDescription:
        '用于远程观察或控制时捕获选定的应用窗口。',
      NSAppleEventsUsageDescription: '用于聚焦选定的应用窗口。',
    },
  },
  linux: {
    artifactName:
      '${productName}-linux-${platform}-${version}-${arch}-installer.${ext}',
    // amd是x64
    target: [{ target: 'AppImage', arch: ['x64', 'arm64'] }],
  },
  win: {
    extraResources: [
      {
        from: 'native-bin/palmdesk-window.exe',
        to: 'native/palmdesk-window.exe',
      },
    ],
    artifactName: '${productName}-${version}-windows-${arch}.${ext}',
    requestedExecutionLevel: 'asInvoker',
    target: [
      {
        // portable、nsis
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    icon: 'build/icons/icon.ico',
  },
  // https://www.electron.build/generated/nsisoptions
  nsis: {
    // oneClick，是否创建一键安装程序或辅助安装程序
    oneClick: false,
    // perMachine，是否显示辅助安装程序的安装模式安装程序页面（按计算机或按用户选择）。或者是否始终为所有用户（每台计算机）安装。
    perMachine: false,
    // allowToChangeInstallationDirectory，仅辅助安装程序。是否允许用户更改安装目录。
    allowToChangeInstallationDirectory: true,
    // removeDefaultUninstallWelcomePage，仅辅助安装程序。删除默认卸载欢迎页面。
    removeDefaultUninstallWelcomePage: false,
    // deleteAppDataOnUninstall，仅限一键安装程序。卸载时是否删除应用程序数据。
    deleteAppDataOnUninstall: false,
    // installerIcon: 'build/icons/icon.ico',
    // uninstallerIcon: 'build/icons/icon.ico',
  },
};
