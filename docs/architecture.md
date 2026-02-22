# 🛡️云端同步零知识 OTP 验证器（WebOTP）：系统架构设计文档

**文档版本**: v2.1
**更新日期**: 2026年2月20日
**文档密级**: 内部公开 (Public)
**核心标签**: `Zero-Knowledge`, `E2EE`, `Svelte 5`, `Better Auth`, `Offline-First`, `WebAuthn PRF`

---

## 0. 执行摘要 (Executive Summary)

本项目旨在构建一个极高安全级别、端到端加密 (E2EE) 的跨平台云端同步 OTP（一次性密码/两步验证）查看应用。

本系统基于严格的**零知识 (Zero-Knowledge, ZK)** 原则设计：服务器充当“盲”存储网关，用户的真实密码、加密密钥及 OTP 种子绝不以明文形式离开本地设备。本系统实现了**安全的离线优先闭环**，并结合**乐观并发控制 (OCC)** 与**客户端三方合并**策略，完美处理多设备并发写入及密码轮换冲突。配合现代化的 Svelte 5 响应式引擎与 WebAuthn PRF 硬件解锁技术，在提供军工级安全的同时，保障极致流畅的用户体验。

---

## 1. 系统架构与技术栈选型

系统采用现代化的全栈 Serverless/Edge 友好架构，严格分离“身份验证”与“加密数据”。

| 组件类别        | 技术选型                           | 架构考量与优势                                                                                                                |
| :-------------- | :--------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| **前端基座**    | SvelteKit + Svelte 5               | 利用 Runes (`$state`) 提供极低开销的精细化响应式状态，利于及时追踪并销毁敏感内存。天然支持 SSR/SSG，配合 PWA 提供原生级体验。 |
| **UI 与样式**   | Tailwind CSS + shadcn-svelte       | 提供高度可定制、无障碍 (a11y) 的现代化组件库。配合 Svelte 5 实现零运行时开销的丝滑交互体验。                                  |
| **身份与网关**  | Better Auth                        | 现代全栈 Auth 标准。提供强类型 API，内置安全的 HttpOnly 会话控制、多设备追踪、主动吊销及防暴力破解（Rate Limiting）机制。     |
| **后端/持久化** | Node.js + Drizzle ORM + PostgreSQL | Drizzle ORM 的强类型穿透保障前后端数据契约，其轻量级的原子事务控制是实现 OCC 数据同步的刚需。                                 |
| **密码学核心**  | Web Crypto API (`SubtleCrypto`)    | 纯浏览器原生底层实现，避免引入 Wasm 从而维持最严格的 CSP (Content Security Policy)。提供高性能 PBKDF2 与 AES-GCM 算法。       |
| **本地存储**    | IndexedDB (`idb` 库)               | 大容量、结构化持久化存储本地密文 (Blob) 及同步版本元数据，支撑“无网秒开”的离线优先策略。                                      |
| **解锁方式**    | WebAuthn PRF (Passkeys)            | 2026 年现代浏览器标配。通过设备安全芯片 (Secure Enclave) 的伪随机函数派生对称密钥，替代密码输入。                             |

---

## 2. 零知识密码学模型 (The ZK Cryptographic Model)

本系统不信任服务器。所有的加密计算均在客户端内存中完成。

### 2.1 核心密钥与参数定义

1.  **$MP$ (Master Password)**: 用户输入的高强度密码，或通过 WebAuthn PRF 扩展获取的硬件级伪随机字节串。**（绝不离开设备）**
2.  **公共盐值 (Salts)**: `login_salt` 与 `data_salt`，用户注册时本地生成的高熵随机字符串。**（非机密，缓存在本地以支持离线计算）**
3.  **迭代次数 ($Iterations$)**: 推荐值 $\ge 600,000$ (PBKDF2-HMAC-SHA256)。

### 2.2 密钥派生与使用流 (Key Derivation Flow)

为适配 Better Auth 并保持零知识，采用**双重派生策略**：

- **身份认证密钥 (LAK - Login Authentication Key)**
  $$LAK = Base64Encode(PBKDF2(MP, login\_salt, Iterations))[0:64]$$
  _用途_: LAK 作为“虚拟密码”提交给 Better Auth 接口。服务器会再次对其进行 Bcrypt/Argon2 哈希入库。（截取前 64 字符为规避 Bcrypt 长度限制）。
- **数据加密密钥 (DEK - Data Encryption Key)**
  $$DEK = PBKDF2(MP, data\_salt, Iterations)$$
  _用途_: 导入 Web Crypto API 作为 `CryptoKey`（强制 `extractable: false`）。仅用于本地执行 $AES\_GCM_{256}(Vault Data, DEK)$。

### 2.3 灾难恢复机制 (Disaster Recovery)

为防止遗忘密码导致数据永久丢失：

1.  **注册时**: 客户端随机生成高熵**恢复密钥 (RK)** 展示给用户离线抄写。
2.  **派生与存储**: $REK = PBKDF2(RK, data\_salt)$。将当前 DEK 使用 REK 加密，存入服务器 `encrypted_dek_by_recovery_key` 字段。
3.  **恢复流**: 输入 RK -> 解密出 DEK -> 恢复 Vault 数据 -> 强制设置新 MP 并重写零知识金库。

---

## 3. 数据模型设计 (Drizzle ORM Schema)

数据存储严格隔离“用户身份标识”与“零知识数据金库”。

```typescript
// 1. Better Auth User 扩展表 (存储盐值与认证元数据)
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  dataSalt: text("data_salt").notNull(),
  loginSalt: text("login_salt").notNull(),
  kdfIterations: integer("kdf_iterations").notNull(),
});

// 2. 零知识数据金库表 (Vault)
export const vault = pgTable("vault", {
  id: text("id").primaryKey(), // 关联 user.id
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  encryptedBlob: text("encrypted_blob").notNull(), // ZK 密文: "v=1;iv=...;ct=..."
  encryptedDekByRecoveryKey: text("encrypted_dek_by_recovery_key").notNull(),
  version: bigint("version", { mode: "number" }).notNull().default(1), // OCC 版本号
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

---

## 4. 前端架构与状态管理 (Svelte 5 Runes Engine)

充分利用 Svelte 5 Runes 实现细粒度的响应式系统，划分为三大核心状态模块：

### 4.1 `auth.svelte.ts` (身份与设备控制)

封装 Better Auth 客户端，管理 `isAuthenticated` 与多设备追踪逻辑。提供一键吊销 (Revoke) 异常设备会话的功能。

### 4.2 `crypto.svelte.ts` (内存安全与加解密)

负责内存生命周期管理。持有 `isUnlocked` 状态与不可导出的 `DEK`。

- **防内存窃取 (Anti-Memory Dump)**: 在锁定 (主动锁定/5分钟无操作/切后台 `visibilitychange`) 时，除了将 `$state` 置空，必须对所有敏感 `Uint8Array` 中间产物调用 `crypto.getRandomValues()` 覆写乱码，彻底阻断 JS 内存驻留风险。

### 4.3 `vault.svelte.ts` (核心同步引擎)

维护业务模型与同步状态机：

```typescript
export const vaultState = $state({
  accounts: [] as Account[],
  baseSnapshot: [] as Account[], // 用于三方合并的基准快照
  syncStatus: "idle" | "dirty" | "syncing" | "conflict",
  lastVersion: 0,
});
```

_机制_: 任何对 `accounts` 的增删改都会将 `syncStatus` 标为 `dirty`。服务防抖拦截后，静默打包加密并进入 `syncing` 状态，触发网络请求。

---

## 5. 核心工作流与冲突解决 (Core Workflows)

### 5.1 离线优先启动闭环 (Offline-First Boot)

1.  **数据沉淀**: 成功登录后，必须将 `loginSalt`, `dataSalt`, `kdfIterations` 以及最新的 `encryptedBlob` 明文写入 IndexedDB。
2.  **无网冷启动**: SvelteKit 拦截器检测到无网，直接读取 IndexedDB 中的盐值缓存。
3.  **本地解锁**: 用户输入密码 -> 结合本地 Salt 派生 DEK -> 解密本地 Blob，实现地铁/机舱等环境下的**毫秒级 UI 渲染**。
4.  **网络恢复**: 后台转为 `syncing` 发起 `GET /api/vault` 对比版本号。

### 5.2 并发同步与三方合并 (3-Way Merge OCC)

服务端提供 `PUT /api/vault`，利用 Drizzle 执行原子条件更新 (`WHERE version = expectedVersion`)。

**当收到 412 Precondition Failed 时**：

1.  拉取远端最新密文 (`RemoteBlob`)，使用 DEK 解密得到 `RemoteData`。
2.  执行合并引擎：$Merged = Merge(BaseSnapshot, LocalData, RemoteData)$。
3.  **垃圾桶策略 (Trash Can Strategy)**：依据 `updatedAt` 解决字段级冲突，但**软删除 (`deletedAt`) 拥有绝对优先级**。如果设备 A 删除了账户 X，即使设备 B 在离线时修改了账户 X 的名称并同步，合并结果仍将账户 X 标记为已删除，彻底根绝“僵尸数据复活”问题。
4.  重新加密 $Merged$，携带新版本号再次上传。

### 5.3 灾难级冲突：密码轮换并发 (Key Rotation Conflict)

**场景**: 设备 A 更改了密码（云端被新 DEK 覆写）。设备 B 离线添加了数据，上线触发同步收到 412。设备 B 使用旧 DEK 解密远端数据时，将触发 Web Crypto API 的 **AEAD 校验失败**。
**阻断与恢复策略**:

1.  捕获解密异常，**绝对禁止覆盖或丢弃设备 B 的本地数据**。
2.  触发阻断式 UI：“云端数据已使用新的密码加密，请验证新密码以同步离线数据。”
3.  用户输入新 MP -> 派生新 DEK -> 解密云端数据 -> 使用旧 DEK 提取本地差异 -> 完成内存合并 -> 使用新 DEK 重新加密并上传。

---

## 6. 后端控制与会话安全 (Backend Security)

### 6.1 反枚举防御 (Anti-Enumeration)

`GET /api/auth-params?email={email}` 针对不存在的邮箱，使用 $HMAC(email, ServerSecret)$ 动态生成固定伪盐值并返回 Http 200，耗时与真实用户一致，杜绝时序与响应体枚举。

### 6.2 密码轮换的原子事务 (Atomic Key Rotation)

调用 `POST /api/vault/rotate-key`，必须在单个 Drizzle 事务中完成：

1. 用新 LAK 覆写 Better Auth 密码哈希，更新盐值。
2. 写入用新 DEK 加密的新 Blob。
   _关键收尾_: 事务提交后，调用 Better Auth API **主动吊销该用户除了当前设备外的所有活动会话**。

### 6.3 严格的会话校验 (Session Revocation Check)

客户端定时或在发同步请求时，如果后端返回 `401 Unauthorized`（由于会话被其他设备远程吊销），前端 SvelteKit 拦截器捕获后，**立即强制触发内存锁**擦除密钥并重定向至登录页。

---

## 7. 安全与防御体系汇总 (Threat Mitigation)

| 威胁向量 / 攻击方式 | 系统防御机制 / 缓解措施                                                                |
| :------------------ | :------------------------------------------------------------------------------------- |
| **服务器完全泄露**  | **零知识绝对防御**：数据库仅存 Bcrypt(LAK) 和 AES-GCM 密文。无真实 MP 无法反推 DEK。   |
| **JS 内存驻留窃取** | 严格设置 `extractable: false`；敏感 Uint8Array 手动调用 `getRandomValues()` 覆写擦除。 |
| **恶意插件 / XSS**  | 部署严格的 CSP：禁止 `unsafe-inline` 和 `unsafe-eval` 阻止内联脚本执行。               |
| **设备丢失风险**    | IndexedDB 仅存密文；原主可远程一键 Revoke 丢失设备的 Token 触发强制销毁。              |
| **暴力撞库攻击**    | Better Auth 网关层内置 Rate Limiting，基于 IP + 账号双重维度的指数级冷却拦截。         |

---

## 8. 核心用户体验增强 (UX & Product Features)

1.  **TOTP 时钟漂移检测 (Clock Drift Warning)**
    前端启动时静默比对 HTTP Date Header 与本地 `Date.now()`。若偏差超过 15 秒，弹出非阻塞式警告提示用户校准系统时间，防止验证码失效。
2.  **无门槛数据导出 (Data Portability)**
    用户拥有数据的绝对控制权。在验证密码解锁状态下，可在内存中解密全部数据，并直接在浏览器端生成 JSON/CSV 供用户下载迁移。
3.  **多语言支持 (i18n)**
    采用现代无运行时、类型安全的方案（如 `paraglide-sveltekit`），提供无缝的国际化支持。

---

## 9. 架构全局优势总结 (Architectural Advantages)

从传统的自研鉴权或中心化密码管理器，迁移至 **Better Auth + Svelte 5 + Drizzle** 的新一代组合，为本项目带来三大核心优势：

1.  **工程效能与类型安全**：Drizzle ORM 的强类型约束穿透至前后端，极大减少了 ZK 密文交互中的序列化错误；Better Auth 削减了 80% 身份验证及设备追踪的样板代码。
2.  **安全性升维**：利用 Better Auth 久经考验的会话模型，填补了传统 ZK 应用极易忽略的“设备管理与并发风暴”盲区；结合强化的内存强制擦除机制与 2026 标配的 WebAuthn PRF 解锁，实现了纯 Web 端的军工级防御。
3.  **无缝的跨端体验**：Svelte 5 精细的有限状态机 + IndexedDB 本地缓存 + 乐观并发控制 (OCC)，让离线优先不再是口号。即使用户在网络极度不稳定的离线环境中，依然能够享受“零延迟解锁、无损冲突合并”的丝滑体验。
