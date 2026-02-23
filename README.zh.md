<div align="center">
  <img src="static/original.png" alt="WebOTP Logo" width="128">
  <h1>WebOTP</h1>
  <p><strong>零知识云端 OTP 验证器</strong></p>

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-2.0-FF3E00?logo=svelte)](https://kit.svelte.dev/)
[![Better Auth](https://img.shields.io/badge/Better_Auth-1.0-000000?logo=auth0)](https://better-auth.com/)

<p>
  <a href="README.md">English</a> | <a href="README.zh.md">简体中文</a>
</p>

</div>

**WebOTP** 是一个安全的、开源的双因素认证（2FA）应用，基于严格的**零知识架构**构建。它允许用户通过云端在多个设备间同步 OTP 账户，而服务器永远无法访问用户的密钥或密码。

## 目录

- [功能特性](#功能特性)
- [架构设计](#架构设计)
- [技术栈](#技术栈)
- [本地开发快速开始](#本地开发快速开始)
  - [环境准备](#环境准备)
  - [安装](#安装)
  - [配置](#配置)
  - [数据库设置](#数据库设置)
  - [运行应用](#运行应用)
- [部署](#部署)
  - [方案 1: Vercel + Neon (Serverless)](#方案-1-vercel--neon-serverless)
  - [方案 2: 自托管 (Docker)](#方案-2-自托管-docker)
- [使用指南](#使用指南)
- [安全模型](#安全模型)
- [开发](#开发)
- [贡献](#贡献)
- [许可证](#许可证)

## 功能特性

- **零知识架构**：所有加密均在客户端进行。服务器仅存储加密数据块，无法读取您的 OTP 密钥。
- **云端同步**：在多个设备间无缝同步账户。
- **离线支持**：利用 IndexedDB 实现全功能离线使用。恢复在线后自动同步更改。
- **生物识别解锁**：通过 WebAuthn PRF 扩展，支持 Face ID、Touch ID 或 Windows Hello 解锁保险库。
- **灾难恢复**：如果您忘记了主密码，可以使用 64 字符的恢复密钥找回保险库。
- **TOTP 生成**：支持标准的 RFC 6238 TOTP。
- **导入/导出**：支持从 Google Authenticator、Aegis、2FAS 和纯文本导入。支持导出为 JSON。
- **PWA 支持**：可安装在手机和桌面上作为独立应用使用。
- **多语言**：支持英文和中文（i18n）。

## 架构设计

WebOTP 实现了“不信任任何人”的模型。服务器充当盲存储提供商。

### 密钥派生

1.  **主密码 (MP)**：用户的主要秘密。
2.  **双重派生**：
    - **LAK (登录认证密钥)**：通过 PBKDF2 派生。用于与服务器进行身份验证。
    - **DEK (数据加密密钥)**：通过 PBKDF2 派生。用于在本地加密/解密保险库。
3.  **盐值**：`loginSalt` 和 `dataSalt` 在注册时生成并存储在服务器上。

### 加密

- **算法**：AES-256-GCM。
- **存储**：保险库以数据块格式 (`v=1;iv=...;ct=...`) 存储在 PostgreSQL 中。
- **同步**：使用带有版本控制和三方合并的乐观并发控制（OCC）来处理冲突。

### 恢复

- 注册时会生成一个随机的 256 位恢复密钥。
- DEK 使用从恢复密钥派生的密钥 (`REK`) 进行加密，并存储在服务器上。

## 技术栈

- **前端**: [SvelteKit](https://kit.svelte.dev/) (Svelte 5 Runes), [Tailwind CSS](https://tailwindcss.com/), [DaisyUI](https://daisyui.com/).
- **后端**: SvelteKit Endpoints (Node.js).
- **数据库**: [PostgreSQL](https://www.postgresql.org/) 配合 [Drizzle ORM](https://orm.drizzle.team/).
- **认证**: [Better Auth](https://better-auth.com/).
- **密码学**: 原生 [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API).
- **本地存储**: [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) (通过 `idb`).

## 本地开发快速开始

### 环境准备

- [Node.js](https://nodejs.org/) (v18 或更高版本)
- [pnpm](https://pnpm.io/) (v8 或更高版本)
- [PostgreSQL](https://www.postgresql.org/) 数据库

### 安装

1. 克隆仓库：

   ```bash
   git clone https://github.com/your-username/webotp.git
   cd webotp
   ```

2. 安装依赖：
   ```bash
   pnpm install
   ```

### 配置

在根目录创建 `.env` 文件：

```env
# 数据库连接 (必填)
DATABASE_URL="postgresql://user:password@localhost:5432/webotp"

# Better Auth 配置 (必填)
# 用于加密会话令牌的随机字符串。生成命令: openssl rand -base64 32
BETTER_AUTH_SECRET="your-super-secret-key-at-least-32-chars-long"

# 应用的公开 URL (WebAuthn 和 Cookie 必需)
# 本地开发使用 http://localhost:5173
BETTER_AUTH_URL="http://localhost:5173"

# 可选：如果生产环境 URL 与 BETTER_AUTH_URL 不同
# PUBLIC_URL="https://your-domain.com"
```

### 数据库设置

使用 Drizzle Kit 推送数据库架构：

```bash
pnpm db:push
```

### 运行应用

启动开发服务器：

```bash
pnpm dev
```

应用现在应该在 `http://localhost:5173` 运行。

> **注意**：WebAuthn（通行密钥）在生产环境中需要 HTTPS。对于本地开发，项目使用 `@vitejs/plugin-basic-ssl` 提供自签名证书。您可能需要让浏览器信任该证书。

## 部署

### 方案 1: Vercel + Neon (Serverless)

这是快速免费部署 WebOTP 的推荐方式。

1.  **Fork 仓库**：将此项目 Fork 到您的 GitHub 账户。
2.  **创建 Neon 项目**：
    - 前往 [Neon](https://neon.tech) 并创建一个新项目。
    - 复制 **Connection string**（以 `postgresql://...` 开头）。
3.  **部署到 Vercel**：
    - 点击下方按钮导入您 Fork 的仓库：
      [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-username/webotp)
    - 或者在 Vercel 中创建新项目并手动导入您的仓库。
4.  **设置环境变量**：
    在 Vercel 项目设置中，添加以下环境变量：
    - `DATABASE_URL`：粘贴从 Neon 获取的连接字符串。
    - `BETTER_AUTH_SECRET`：生成一个随机字符串（至少 32 个字符）。
    - `BETTER_AUTH_URL`：您的 Vercel 部署 URL（例如 `https://webotp.vercel.app`）。**不要**添加尾部斜杠。
5.  **推送数据库架构**：
    在应用可以工作之前，您需要创建数据库表。
    - 在本地运行以下命令（将 URL 替换为您的 Neon 连接字符串）：
      ```bash
      DATABASE_URL="postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/webotp?sslmode=require" pnpm db:push
      ```
6.  **重新部署**：如有必要，在 Vercel 上触发重新部署。

### 方案 2: 自托管 (Docker)

您可以使用 Docker 部署此应用。我们建议使用 Docker Compose 来管理应用和数据库。

#### 1. 创建 `docker-compose.yml` 文件

在项目根目录（或您的服务器上）创建一个 `docker-compose.yml` 文件：

```yaml
version: '3.8'

services:
  db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: webotp
      POSTGRES_PASSWORD: your_secure_password_here
      POSTGRES_DB: webotp
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U webotp"]
      interval: 5s
      timeout: 5s
      retries: 5

  app:
    image: node:20-alpine
    working_dir: /app
    restart: always
    environment:
      # 连接到内部 docker 服务 'db'
      DATABASE_URL: postgresql://webotp:your_secure_password_here@db:5432/webotp
      # 修改此处：设置一个随机字符串
      BETTER_AUTH_SECRET: your-super-secret-key-at-least-32-chars-long
      # 修改此处：您的实际域名
      BETTER_AUTH_URL: https://your-domain.com
      NODE_ENV: production
    ports:
      - "3000:3000"
    command: sh -c "npm install -g pnpm && pnpm install --frozen-lockfile && pnpm db:push && pnpm build && node build"
    volumes:
      - .:/app
    depends_on:
      db:
        condition: service_healthy

volumes:
  postgres_data:
```

#### 2. 运行容器

```bash
docker-compose up -d
```

应用将在 `http://localhost:3000` 上可用。

> **注意**：在生产环境中，强烈建议在应用前放置反向代理（如 Nginx 或 Caddy）以处理 SSL 终止。

## 使用指南

1. **注册**：
   - 使用您的邮箱和一个强主密码创建一个新账户。
   - **关键步骤**：系统将向您展示一个 **恢复密钥**。请下载此密钥并安全地离线存储。这是您忘记主密码后找回数据的**唯一**方式。服务器管理员无法为您恢复。

2. **登录**：
   - 使用您的邮箱和主密码解锁保险库。
   - 如果您在受信任的设备上，可以在设置中启用“生物识别解锁”（Face ID/Touch ID）以跳过密码输入。

3. **添加账户**：
   - 点击“添加账户”按钮。
   - 扫描二维码、上传图片或手动输入密钥。
   - 您也可以从其他验证器应用（Google Authenticator、Aegis、2FAS）导入数据。

4. **同步**：
   - 您的数据会在您进行更改时自动同步到云端。
   - 如果您使用多个设备，更改会在后台自动合并。

5. **恢复**：
   - 如果您忘记了密码，请在登录屏幕上点击“忘记密码？”。
   - 输入您的电子邮件和注册时保存的恢复密钥。
   - 设置新密码。您的数据将被恢复，并会生成一个新的恢复密钥。

## 安全模型

| 威胁向量       | 缓解措施                                                                                                      |
| :------------- | :------------------------------------------------------------------------------------------------------------ |
| **服务器泄露** | 数据库仅存储加密数据块和哈希认证密钥。不会泄露任何密钥。                                                      |
| **内存转储**   | 敏感的 `Uint8Array` 缓冲区在使用后立即通过 `crypto.getRandomValues()` 擦除。密钥标记为 `extractable: false`。 |
| **XSS**        | 严格的内容安全策略（CSP）头。禁止 `eval()` 或内联脚本。                                                       |
| **密码猜测**   | Better Auth 提供速率限制和账户锁定机制。                                                                      |
| **设备丢失**   | 在新设备上使用恢复密钥恢复访问权限。                                                                          |

## 开发

### 脚本

- `pnpm dev`: 启动开发服务器。
- `pnpm build`: 构建生产版本。
- `pnpm preview`: 预览生产构建。
- `pnpm lint`: 代码检查和格式化。
- `pnpm test`: 运行单元测试。
- `pnpm test:e2e`: 运行 E2E 测试。

### 项目结构

```
src/
├── lib/
│   ├── crypto/         # ZK 引擎 (PBKDF2, AES-GCM, PRF)
│   ├── server/         # 服务端逻辑 (DB, Auth)
│   ├── stores/         # Svelte 5 Runes 状态管理
│   └── utils/          # TOTP 逻辑, 辅助函数
├── routes/
│   ├── api/            # 后端 API 端点
│   ├── login/          # 登录页
│   ├── register/       # 注册页
│   └── settings/       # 设置页
└── app.html            # 主 HTML 模板
```

## 贡献

欢迎贡献代码！请阅读 [CONVENTIONS.md](CONVENTIONS.md) 了解编码标准和提交规范。

1. Fork 本项目。
2. 创建您的特性分支 (`git checkout -b feature/AmazingFeature`)。
3. 提交您的更改 (`git commit -m 'feat: add some feature'`)。
4. 推送到分支 (`git push origin feature/AmazingFeature`)。
5. 打开一个 Pull Request。

## 许可证

根据 MIT 许可证分发。有关更多信息，请参阅 `LICENSE`。
