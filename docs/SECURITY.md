# 安全与交付边界（第 14/15/16 项）

日期：2026-11-22

## 1. API Key（第 14 项）— 已修复

**问题**：旧版把 API Key 明文写在 `server/.data/settings.json`。

**已做改动**
- 配置文件**不再保存密钥**：settings.json 只保留 engine/provider/model/baseUrl/限额等非密钥项；
- 密钥单独存 `server/.data/credentials.json`，文件权限 0600（Windows 尽量收紧）；
- 读取优先级：环境变量 `PI_API_KEY` > credentials.json；
- 老配置首启自动迁移：settings.json 里的 apiKey 搬到 credentials.json 并从配置文件删除；
- 支持环境变量覆盖 ` PI_ENGINE / PI_PROVIDER / PI_MODEL_ID / PI_BASE_URL `L；
- `.gitignore` 已含 `server/.data/`，密钥与凭据不会进 Git。

**验证**：`test/settings.test.ts` 3 项通过（配置文件不含密钥 / 环境变量覆盖 / 旧配置迁移）；已把当前 settings.json 的 key 迁移到 credentials.json。

**轮换与审计**
- 推荐生产用环境变量或系统密钥库注入 `PI_API_KEY`，不要落盘；
- 本轮之前已使用过的 Key **建议轮换**（因为曾以明文存在于本地 settings.json）；
- 检查历史是否泄露：
```powershell
git log -p -- server/.data        # .data 已被忽略，正常应无内容
git grep -n "sk-" $(git rev-list --all)   # 粗查历史中的疑似密钥
```

## 2. 权限控制（第 15 项）— 明确边界

系统是**单用户本地形态**：无登录、无用户隔离、无 API 鉴权、无操作审计、无数据访问权限。本地自用可接受，**不能直接作为公网服务**。若要多用户/公网，需先加：反向代理鉴权（如 Basic/OIDC）、按用户隔离 dataDir、审计日志、HTTPS。

## 3. 部署边界（第 16 项）— 已加守卫

**问题**：担心服务被配置成 0.0.0.0 暴露到网络。

**已做改动**：`server/src/index.ts` 启动时校验绑定地址：
- 默认 `127.0.0.1` / `localhost` / `::1` 才允许启动；
- 若设置成其它地址（如 0.0.0.0）且未显式 `PI_ALLOW_PUBLIC=1`，**直接拒绝启动并打印安全提示**。

**建议**
- 生产/公网：不要直接开放 8787 / 8765，放在带鉴权的反向代理后；
- 需要远程访问时优先 SSH 隧道 / VPN，而非绑定 0.0.0.0；
- 明令禁止「生产环境直接开放」。

## 4. 交付定位（第 19 项）

当前仍是**本地技术验证**，不是正式交付系统。限制：单用户、本地 SQLite、无权限、依赖外部中转、样本量偏小。不应对外宣称「准确率 X%」，只能报「在 N 条固定用例、指定版本与资料快照下的通过率」。正式交付前需补齐：权限、密钥管理、多轮稳定性统计、部署说明。
