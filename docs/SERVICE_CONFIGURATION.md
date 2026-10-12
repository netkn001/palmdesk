# 服务配置

## 组成

手机端是普通网页。macOS 电脑运行本仓库的 Electron 客户端并捕获选定窗口。两端连接同一个 PalmDesk API/Socket.IO 服务，视频和输入走 WebRTC；无法直连时使用后端配置的 TURN 中继。

这条链路不使用 Codex app-server。后端负责设备注册、密码校验和信令，不需要访问 Codex 会话目录。

## 配置项

环境变量示例在根目录 `.env.example`。在 `.env.local` 或构建环境中提供值，修改后重启 Vite/重新构建。设置页保存的值优先于构建环境变量，并在保存后重载客户端生效。

| 配置                   | 浏览器默认      | 打包后的 Electron 默认  | 测试环境（ssh-hk） |
| ---------------------- | --------------- | ----------------------- | ------------------ |
| `VITE_API_BASE_URL`    | `/api`          | `https://palmdesk-hk-test.ziniaocloud.com/api` | `https://palmdesk-hk-test.ziniaocloud.com/api` |
| `VITE_SIGNALING_URL`   | 当前网页 origin | `https://palmdesk-hk-test.ziniaocloud.com` | `https://palmdesk-hk-test.ziniaocloud.com` |
| `VITE_CLIENT_BASE_URL` | 空，手机端无需设置 | `https://palmdesk-hk-test.ziniaocloud.com/` | `https://palmdesk-hk-test.ziniaocloud.com/` |
| `VITE_TURN_URL`        | 空，后端自动下发 | 空，后端自动下发        | 空，后端自动下发 |
| `VITE_TURN_USERNAME`   | 空              | 空                      | 空 |
| `VITE_TURN_CREDENTIAL` | 空              | 空                      | 空 |

`VITE_ENABLE_UPSTREAM_VERSION_CHECK=true` 才调用上游版本接口；`VITE_OPEN_DEVTOOLS=true` 才在开发客户端自动打开控制台。默认都关闭。

信令地址填服务的 origin，例如 `https://remote.example.com`，Socket.IO 会使用 `/socket.io` 路径。API 地址可填同域的 `/api`，或完整的 `https://remote.example.com/api`。

打包版 Electron 使用 `file:` 页面，默认连接 PalmDesk 公共服务。自部署或接入测试环境时可覆盖完整 HTTPS API/信令地址及手机网页地址，两端必须使用同一个后端。开发时 Vite 继续使用本地同域代理。设置页之前保存的地址优先于新的默认值，需要清除或修改旧设置才会使用默认值。

测试环境目前部署在 `ssh-hk`（`https://palmdesk-hk-test.ziniaocloud.com`），完整的服务端容器架构、Nginx 反代与运维步骤详见 [服务端部署与测试环境指南](DEPLOYMENT.md)。

## 扫码连接

电脑端“手机扫码连接”的设置按钮以及“高级设置 → 连接服务”中的“手机网页地址”使用同一项配置。可以填写 `https://remote.example.com/`，局域网调试可以填写 `http://192.168.1.10:5173/`；实际 IP 和端口以运行环境为准。也可通过 `VITE_CLIENT_BASE_URL` 设置构建默认值，界面保存的值优先。

这里必须是本项目网页客户端的首页，不是 API 或 Socket.IO 地址。可以包含部署子路径，例如 `https://remote.example.com/client/`。地址不能带登录信息、查询参数或邀请内容；不接受 `localhost`、回环 IP、`0.0.0.0` 等手机无法直接使用的监听地址。未配置地址或电脑尚未完成服务连接时，不生成二维码。手机网页与电脑必须连到同一个 BilldDesk 后端。

二维码是普通 HTTP/HTTPS 链接，设备代码和临时密码位于 `#/remote?...` 片段中。系统相机或微信识别后打开网页，即可自动发起连接；网页内也可通过扫码按钮调用后置相机，或从相册选择二维码图片。若扫到另一部署地址的连接码，会打开该码对应的客户端地址。

连接信息在接收后从地址栏和当前历史记录中移除，片段不会被浏览器发送到 HTTP 服务端。二维码、复制出的链接和截图仍相当于临时密码，不能公开分享；成功连接后的设备历史沿用现有密码保存行为。修改密码只有在服务器确认成功后才会更新二维码，旧码随后无法通过认证。设备离线、密码错误、网络失败都会显示错误并允许重试。

网页实时相机扫码需要有效 HTTPS 和相机权限。局域网 HTTP 调试可以使用系统相机打开链接，或在网页里选择二维码图片。正式访问需要部署 HTTPS，本次功能不自动部署网站、签发证书或建立公网隧道。

微信扫码使用微信内置浏览器打开同一个网页链接，没有接入微信 JS-SDK、公众号或原生 App 唤起。扫码后是否出现确认页面，以及内置浏览器的 WebRTC 能力，取决于微信版本、系统和域名状态；不承诺强制跳到 Safari/Chrome。缺少 WebRTC 时会提示改用系统浏览器，并提供复制连接链接入口。系统相机、iOS Safari 和微信的实机验收仍需在最终 HTTPS 地址上完成。

## 手机与服务器

同局域网临时调试可运行：

```bash
npm run dev:web:lan
```

手机打开电脑的局域网 IP 和 Vite 端口。该命令会允许局域网访问开发服务；默认命令只监听本机回环地址。局域网 HTTP 只适合临时浏览器兼容性检查，正式手机访问使用 HTTPS。

部署网页：

```bash
npm run build:prod
```

把 `dist/` 作为静态站点，代理 `/api/` 到 BilldDesk HTTP 服务，代理 `/socket.io/` 到同一服务并支持 WebSocket Upgrade。可参考 [Nginx 配置模板](../config/nginx.conf.example)，替换域名、证书和静态目录后使用。此模板未在本次环境部署。

容器后端通过 `PUBLIC_ORIGIN` 允许正式网页的 origin，`EXTRA_ALLOWED_ORIGINS` 可增加本地调试地址，`ALLOW_ELECTRON_ORIGIN=true` 允许桌面包。手机和电脑需能访问相同的信令/API 地址。

Windows 打包版 Electron 的 WebSocket 握手使用 `Origin: file://`。服务端若校验 WebSocket 来源（例如 Socket.IO 的 `allowRequest`），需显式允许 `file://`；允许字符串 `null` 不能替代它。API 登录成功但 WebSocket 握手返回 HTTP 400 时，应检查这项配置。开发客户端则使用实际页面 origin，例如 `http://127.0.0.1:5173`，也需要被允许。

## TURN

推荐由容器后端签发临时凭据。部署变量示例见 [turn.env.example](../containers/backend/turn.env.example)，这些变量只注入后端容器，不能放进任何 `VITE_*` 变量或前端构建环境。

```dotenv
TURN_PROVIDER=cloudflare
CLOUDFLARE_TURN_KEY_ID=your-turn-key-id
CLOUDFLARE_TURN_API_TOKEN=your-turn-key-api-token
TURN_CREDENTIAL_TTL=3600
TURN_HOSTNAME=turn.abreto.icu
```

未设置 `TURN_PROVIDER` 时默认为 `none`，后端可以在不配置 TURN 密钥的情况下启动，客户端会提示仅尝试直连。选择 `cloudflare` 后，缺少 Key ID 或 Token 会阻止后端启动。TTL 支持 600 到 172800 秒，默认一小时，在到期前五分钟刷新；短 TTL 会按有效期的 20% 提前刷新。

`TURN_HOSTNAME` 可选，需要 CNAME 到 `turn.cloudflare.com` 并使用 DNS-only 灰云。它只替换 UDP/TCP 的主机名，`turns:` 的 TLS 主机名保留 `turn.cloudflare.com`。下发配置过滤 53 端口，保留 UDP、TCP 和 TLS 443 等入口。参见 [Cloudflare 凭据接口](https://developers.cloudflare.com/realtime/turn/generate-credentials/) 和 [自定义域名限制](https://developers.cloudflare.com/realtime/turn/custom-domains/)。

### 会话与续期

后端验证设备加入、双方设备密码及真实 Socket ID 后，只向双方各自发送会话令牌。成功消息不携带设备密码，也不向房间广播。两端以 `Authorization: Bearer <session-token>` 请求 `POST /api/webrtc/ice-servers`，响应沿用 `{ code, message, data: { iceServers, expiresAt, refreshAfter } }`，两个时间都是 Unix 毫秒。接口忽略客户端传入的 TTL，使用后端配置。

令牌绑定设备、Socket 和远控会话，保存在客户端内存中。后端在 Redis 存储令牌摘要对应的授权，闲置有效期为 TURN TTL 加一小时，每次有效请求刷新。会话断开或主动结束会立即停止领取凭据；已经领取的 TURN 凭据仍然按原 TTL 到期。新进程不会恢复旧连接授权，重启后客户端需重新连接。

配置缓存按会话和参与端隔离，不跨用户共用 TURN 凭据。缓存保持实际签发时的过期时间；进程内并发请求合并，凭据接口按 IP 限制为每分钟 60 次，实际签发另按会话每分钟 6 次、设备每分钟 12 次限流。设备加入和开始连接也有限流，单个 Socket 最多保持 8 个远控会话。反向代理必须覆盖客户端 IP 头，后端端口只应对可信代理开放，仓库 Nginx 模板已满足这一约束。

客户端等待 ICE 配置后创建连接，获取期间收到的候选会暂存。续期通过 `setConfiguration()` 更新配置，由被控端统一发起 ICE restart 和 offer/answer 协商，避免双方同时发 offer。临时断网先等待恢复，再最多尝试三次重新协商。上游超时时可以继续使用仍有效的凭据；没有有效凭据则提示中继不可用并尝试 STUN/直连，不继续分配过期凭据。结束会话会取消请求并清理定时器。

当前部署使用单个后端进程维护实时 Socket 会话。Redis 用于授权记录、凭据缓存和限流；增加后端副本前还需配置 Socket.IO 跨进程路由和共享会话管理。

### 境内 coturn

后端已提供 `coturn` 签发实现，可切换为：

```dotenv
TURN_PROVIDER=coturn
TURN_CREDENTIAL_TTL=3600
COTURN_URLS=turn:turn.abreto.icu:3478?transport=udp,turns:turn.abreto.icu:5349?transport=tcp
COTURN_AUTH_SECRET=your-server-shared-secret-at-least-32-characters
```

coturn 配置 `use-auth-secret` 和匹配的 `static-auth-secret`，后端生成时间戳用户名和 HMAC-SHA1 凭据。还需配置公网地址、中继端口范围、防火墙以及自有域名的 TLS 证书。切换供应商时应同时更新签发配置和返回的服务器地址；使用新主机名逐步迁移可以让旧会话继续使用 Cloudflare，不能只改 CNAME 而沿用旧凭据。客户端接口无需变动。

### 手动覆盖

仍可在设置页或构建环境中显式配置静态 ICE，例如：

```dotenv
VITE_TURN_URL=turn:relay.example.com:3478?transport=udp
VITE_TURN_USERNAME=your-client-username
VITE_TURN_CREDENTIAL=your-client-password
```

中继地址也可以使用 `turns:`，或只配置 `stun:`。两端都要设置可达的 ICE 服务。TURN 需要部署 coturn、配置公网地址和中继端口范围，并放通相应的 UDP/TCP 端口。

所有 `VITE_*` 值都会进入客户端，TURN 客户端凭据对用户可见。不要把 Cloudflare API Token 或 coturn 的 `static-auth-secret` 放进前端。手动配置优先于后端自动下发，使用手动配置时不自动续期，清空手动 TURN 地址后才恢复自动模式。

自动化测试覆盖签发协议、授权隔离、过期处理、重连和请求取消。发布前仍需在实际 Cloudflare 账户及目标手机网络上验证强制 relay、长连接续期和视频/输入传输。Cloudflare TURN 不在中国网络提供服务，境内访问会连接境外节点，参见 [官方 FAQ](https://developers.cloudflare.com/realtime/turn/faq/)。
