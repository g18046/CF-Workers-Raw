# CF-Workers-Raw

基于 **Cloudflare Workers / Pages** 构建的 GitHub 动态代理与鉴权中转脚本。

支持**私有/公有仓库文件代理、毫秒级实时无缓存更新、自定义路径鉴权、代码预览与一键下载**，并自带根目录 Nginx 页面伪装。

---

## ✨ 核心特性

- ⚡ **毫秒级无缓存**：基于 GitHub REST API 实时回源，彻底解决 GitHub Raw 5分钟 CDN 缓存问题，修改文件刷新即生效。
- 👁️ **源码预览与下载**：默认以 `text/plain` 纯文本直接预览（适合 JS / JSON / TXT 等配置或应用订阅），加上 `?dl=1` 参数可直接触发文件下载。
- 🔐 **多重安全鉴权**：
  - 支持隐藏全局 GitHub PAT Token，避免密钥暴露。
  - 支持 `TOKEN_PATH` 针对不同文件夹设置不同的访问密码。
- 🎭 **首页伪装机制**：访问根目录默认显示标准 Nginx 欢迎页（也可配置随机 302 重定向），隐藏后端真实用途。
- 🌐 **全域 CORS 解锁**：自动响应 `Access-Control-Allow-Origin: *`，方便各类播放器、订阅软件或前端跨域直接加载。

---

## 🚀 快速部署

### 方式一：Cloudflare Pages 部署（推荐）

1. Fork 本仓库。
2. 登录 Cloudflare 控制台，进入 **Workers & Pages** -> **Create application** -> **Pages** -> **Connect to Git**。
3. 选择本项目仓库，构建设置保持默认（无需填写 Build Command），直接点击 **Save and Deploy**。
4. 部署完成后，在 **Settings -> Environment variables** 中添加需要的环境变量（见下表）。

### 方式二：Cloudflare Workers 手动部署

1. 在 Cloudflare 控制台新建一个 Worker。
2. 将 `_worker.js` 代码粘贴至编辑器中并保存发布。
3. 在 Worker 的 **Settings -> Variables** 中配置环境变量。

---

## ⚙️ 环境变量配置 (Environment Variables)

在 Cloudflare 项目设置中，配置以下变量以使代理正常工作：

| 变量名 | 必填 | 示例 / 说明 |
| :--- | :---: | :--- |
| `GH_NAME` | **是** | GitHub 用户名或组织名（例：`octocat`） |
| `GH_REPO` | **是** | 默认代理的 GitHub 仓库名（例：`my-configs`） |
| `GH_BRANCH` | 否 | 默认分支，不填默认为 `main` |
| `GH_TOKEN` | **是** | GitHub Personal Access Token（建议开启私有仓库读取权限 `repo`） |
| `TOKEN` | 否 | 通用访问 Token（如果设置，客户端请求需带有 `?token=xxx`） |
| `TOKEN_PATH` | 否 | 细粒度路径鉴权配置（格式：`密钥@路径`，多个用逗号分隔）<br>例：`pass123@private,key456@vip/nodes` |
| `URL302` | 否 | 访问根目录时重定向的目标网址（多个用逗号或换行分隔，随机跳转） |
| `ERROR` | 否 | 请求失败时自定义的错误提示文本 |

---

## 📖 链接使用指南

### 1. 基础读取与代码预览（默认）
适合直接作为影视仓、TVBox、Clash 等客户端的**订阅/配置地址**，或者在浏览器直接看源码：
```http
https://你的域名/config/rules.json?token=你的TOKEN
