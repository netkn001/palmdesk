# PalmDesk 服务端部署与测试环境指南

本文档记录 PalmDesk 完整服务端（Web 前端、信令后端、数据库、缓存与反向代理）的部署架构、配置要求，以及当前 **`ssh-hk` 测试环境**的具体配置与维护说明。

---

## 1. 环境规划与概览

PalmDesk 支持多套服务端环境：

| 环境 | 用途 | 域名 / 地址 | 状态 / 说明 |
| --- | --- | --- | --- |
| **测试环境（当前）** | 团队联调、功能验收、PR 验证 | **`https://palmdesk-hk-test.ziniaocloud.com`** | **已部署在 `ssh-hk` 主机** |
| **官方服务（当前默认）** | 预发布与公网用户默认接入 | `https://palmdesk-hk-test.ziniaocloud.com` | 打包版客户端默认连接 |
| **本地开发环境** | 个人离线开发或单机调试 | `http://127.0.0.1:5173` | 本地 Vite 代理或局域网模式 |

---

## 2. 测试环境部署详情（ssh-hk）

测试环境已于 2026-10-07 在 `ssh-hk` 实例上完成全套容器化部署与 Nginx 反向代理配置。

### 2.1 基础设施信息
- **主机标识**：`ssh-hk`（别名：`ali_hk_ip_assessment_99196`）
- **服务器公网 IP**：`47.238.243.40`（中国香港地域）
- **部署目录**：`/opt/palmdesk`
- **对外公开服务域名**：`https://palmdesk-hk-test.ziniaocloud.com`
- **DNS 解析要求**：
  - 域名：`ziniaocloud.com`
  - 主机记录：`palmdesk-hk-test`
  - 记录类型：`A`
  - 记录值：`47.238.243.40`
- **SSL 证书**：采用已有通配符证书 `/etc/nginx/conf.d/ziniaocloud.com.pem`（覆盖 `*.ziniaocloud.com`）。
- **客户端 SSH 配置 (`~/.ssh/config`)**：
  ```sshconfig
  Host ssh-hk ali_hk_ip_assessment_99196
      HostName 47.238.243.40
      User root
      IdentityFile ~/.ssh/ali_hk_ip_assessment_99196.pem
      StrictHostKeyChecking no
  ```

### 2.2 服务拓扑架构

```mermaid
flowchart TD
    subgraph Internet["公网用户"]
        Desktop["电脑桌面端 (Mac / Windows)"]
        Mobile["手机浏览器 (扫码/直连)"]
    end

    subgraph Host["ssh-hk 宿主机 (47.238.243.40)"]
        NginxHost["宿主机 Nginx\n(:80 / :443 SSL)\npalmdesk-hk-test.ziniaocloud.com"]
        
        subgraph DockerNet["Docker 网络 (palmdesk-net)"]
            WebContainer["palmdesk-web 容器 (:80)\n宿主机端口 127.0.0.1:4380"]
            BackendContainer["palmdesk-backend 容器 (:4300)"]
            MySQLContainer[("MySQL 8.0 容器 (:3306)\npalmdesk 库")]
            RedisContainer[("Redis 7 容器 (:6379)")]
        end
    end

    Desktop -->|WSS / API| NginxHost
    Mobile -->|HTTPS H5 访问| NginxHost
    Desktop <-->|WebRTC P2P 直连 (视频流与控制)| Mobile

    NginxHost -->|反向代理| WebContainer
    WebContainer -->|静态网页 /| WebContainer
    WebContainer -->|内部转发 /api/ 与 /socket.io/| BackendContainer
    BackendContainer --> MySQLContainer
    BackendContainer --> RedisContainer
```

---

## 3. 部署配置文件说明（/opt/palmdesk）

### 3.1 环境变量配置（`/opt/palmdesk/.env`）
测试环境的环境变量权限设为 `600`，核心参数如下：

```dotenv
# 必须为标准 HTTPS 域名，无子路径或斜杠
PUBLIC_ORIGIN=https://palmdesk-hk-test.ziniaocloud.com

# 数据库安全配置（MySQL_USER 不能为 root，密码需 >= 32 位字符）
MYSQL_ROOT_PASSWORD=<随机生成的48位安全密钥>
MYSQL_DATABASE=palmdesk
MYSQL_USER=palmdesk_user
MYSQL_PASSWORD=<随机生成的48位安全密钥>

# Redis 密码（需 >= 32 位字符）
REDIS_PASSWORD=<随机生成的48位安全密钥>

# 后端 JWT 会话签名密钥（需 >= 32 位字符）
JWT_SECRET=<随机生成的48位安全密钥>

# Coturn 纯 IP 中继配置 (47.238.243.40)
TURN_PROVIDER=coturn
TURN_CREDENTIAL_TTL=3600
COTURN_URLS=turn:47.238.243.40:3478?transport=udp,turn:47.238.243.40:3478?transport=tcp
COTURN_AUTH_SECRET=<随机生成的48位安全密钥>
```

### 3.2 容器编排定义（`/opt/palmdesk/docker-compose.yml`）

```yaml
services:
  mysql:
    image: mysql:8.0
    restart: always
    command: --default-authentication-plugin=mysql_native_password --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: ${MYSQL_DATABASE}
      MYSQL_USER: ${MYSQL_USER}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
    volumes:
      - mysql_data:/var/lib/mysql
    networks:
      - palmdesk-net
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-u", "${MYSQL_USER}", "-p${MYSQL_PASSWORD}"]
      interval: 5s
      timeout: 5s
      retries: 15

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --requirepass "${REDIS_PASSWORD}" --appendonly yes
    volumes:
      - redis_data:/data
    networks:
      - palmdesk-net
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 5s
      timeout: 5s
      retries: 15

  coturn:
    image: coturn/coturn:latest
    restart: always
    network_mode: host
    command: ["turnserver", "-c", "/etc/coturn/turnserver.conf"]
    volumes:
      - ./coturn/turnserver.conf:/etc/coturn/turnserver.conf:ro

  backend:
    image: ghcr.io/abreto/palmdesk-backend:latest
    restart: always
    environment:
      NODE_ENV: production
      NODE_APP_RELEASE_PROJECT_ENV: prod
      NODE_APP_RELEASE_PROJECT_NAME: palmdesk-server
      NODE_APP_RELEASE_PROJECT_PORT: 4300
      MYSQL_HOST: mysql
      MYSQL_PORT: 3306
      MYSQL_DATABASE: ${MYSQL_DATABASE}
      MYSQL_USER: ${MYSQL_USER}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_PASSWORD: ${REDIS_PASSWORD}
      JWT_SECRET: ${JWT_SECRET}
      PUBLIC_ORIGIN: ${PUBLIC_ORIGIN}
      ALLOW_ELECTRON_ORIGIN: "true"
      TURN_PROVIDER: ${TURN_PROVIDER:-none}
      COTURN_URLS: ${COTURN_URLS:-}
      COTURN_AUTH_SECRET: ${COTURN_AUTH_SECRET:-}
      TURN_CREDENTIAL_TTL: ${TURN_CREDENTIAL_TTL:-3600}
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - palmdesk-net
    healthcheck:
      test: ["CMD", "node", "runtime/healthcheck.cjs"]
      interval: 10s
      timeout: 5s
      retries: 5

  web:
    image: ghcr.io/abreto/palmdesk-web:latest
    restart: always
    ports:
      - "127.0.0.1:4380:80"
    volumes:
      - ./dist:/usr/share/nginx/html:ro
    depends_on:
      backend:
        condition: service_healthy
    networks:
      - palmdesk-net

volumes:
  mysql_data:
  redis_data:

networks:
  palmdesk-net:
    driver: bridge
```

### 3.3 Coturn 纯 IP 中继配置（`/opt/palmdesk/coturn/turnserver.conf`）

采用 Host 网络模式，直接绑定公网 IP `47.238.243.40`，无需任何域名与证书：

```conf
listening-port=3478
listening-ip=0.0.0.0
external-ip=47.238.243.40/192.168.16.28
realm=47.238.243.40
use-auth-secret
static-auth-secret=<与.env中COTURN_AUTH_SECRET保持一致>
min-port=40000
max-port=40100
fingerprint
log-file=stdout
```

> [!IMPORTANT]
> **阿里云 ECS 安全组端口放行清单**：
> - `3478/TCP` 与 `3478/UDP`（STUN/TURN 探测与主通道）
> - `40000-40100/UDP`（Coturn 动态多媒体中继数据流通道）

> [!NOTE]
> **关键初始化步骤（必须执行一次）**：
> `backend` 启动前，必须在数据库就绪后运行数据库表结构初始化命令，否则会导致接口报错：
> ```bash
> docker compose run --rm backend node runtime/main.cjs init
> ```

### 3.4 宿主机 Nginx 反向代理（`/etc/nginx/sites-available/palmdesk-hk-test.ziniaocloud.com`）

宿主机配置将 443 端口与 SSL 终止，并完整转发 WebSocket 握手请求至 `127.0.0.1:4380`：

```nginx
upstream palmdesk_frontend {
    server 127.0.0.1:4380;
}

server {
    listen       80;
    server_name  palmdesk-hk-test.ziniaocloud.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name palmdesk-hk-test.ziniaocloud.com;

    ssl_certificate      /etc/nginx/conf.d/ziniaocloud.com.pem;
    ssl_certificate_key  /etc/nginx/conf.d/ziniaocloud.com.key;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers off;

    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    include /etc/nginx/mime.types;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        proxy_pass http://palmdesk_frontend;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_connect_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_read_timeout 3600s;

        proxy_buffering off;
    }
}
```

---

## 4. 客户端如何接入测试环境

### 4.1 桌面端配置（macOS / Windows 客户端）

#### 方式 A：GUI 界面配置（最简单）
1. 打开 PalmDesk 客户端；
2. 进入右上角 **「设置」→「连接服务」**；
3. 填入测试环境地址：
   - **API 地址**：`https://palmdesk-hk-test.ziniaocloud.com/api`
   - **信令地址**：`https://palmdesk-hk-test.ziniaocloud.com`
   - **手机网页地址**：`https://palmdesk-hk-test.ziniaocloud.com/`
4. 保存后客户端会自动重载并连接至测试环境。

#### 方式 B：本地源码开发配置文件（`.env.local`）
在本地克隆代码的根目录下创建或编辑 `.env.local`：
```dotenv
VITE_API_BASE_URL=https://palmdesk-hk-test.ziniaocloud.com/api
VITE_SIGNALING_URL=https://palmdesk-hk-test.ziniaocloud.com
VITE_CLIENT_BASE_URL=https://palmdesk-hk-test.ziniaocloud.com/
```
保存后运行 `pnpm dev:desktop`，客户端将默认连接测试环境。

### 4.2 移动端扫码与连接
- 电脑端点击“显示二维码”；
- 手机打开相机、微信扫码，或者直接在浏览器访问 `https://palmdesk-hk-test.ziniaocloud.com`，输入电脑上的设备代码和临时密码即可进入控制或阅读界面。

---

## 5. 测试环境日常运维指南

在终端通过 SSH 连接至测试机：
```bash
ssh-hk  # 或 ssh -i <path-to-pem> root@47.238.243.40
```

### Web 前端热更新快速部署
当本地修改了 Web/移动端界面（如阅读模式），需要快速同步至测试服验证时：

1. **本地构建 Web 产物**：
   ```bash
   pnpm build:prod
   ```
2. **打包并推送至测试机**：
   ```bash
   # 打包并上传
   tar -czf dist.tar.gz -C dist .
   scp dist.tar.gz ssh-hk:/opt/palmdesk/dist.tar.gz
   rm dist.tar.gz

   # 远端解压并重载（或重启 web 容器）
   ssh ssh-hk "mkdir -p /opt/palmdesk/dist && rm -rf /opt/palmdesk/dist/* && tar -xzf /opt/palmdesk/dist.tar.gz -C /opt/palmdesk/dist && rm -f /opt/palmdesk/dist.tar.gz && docker exec palmdesk-web-1 nginx -s reload"
   ```

### 常用管理指令
```bash
# 1. 检查容器运行状态与健康度
cd /opt/palmdesk && docker compose ps

# 2. 查看服务实时日志
docker compose logs -f backend   # 信令后端日志
docker compose logs -f web       # 前端与内部 Nginx 日志
docker compose logs -f mysql     # MySQL 日志

# 3. 重启服务栈
docker compose restart

# 4. 升级镜像与拉取最新构建
docker compose pull
docker compose up -d

# 5. 重载宿主机 Nginx 配置
nginx -t && systemctl reload nginx
```

### 接口与健康探测验证
```bash
# 本机健康检查测试
curl -I http://127.0.0.1:4380/healthz

# 验证公网 HTTPS 路由
curl -k https://palmdesk-hk-test.ziniaocloud.com/healthz
# 正常应返回: {"status":"ok"}
```
