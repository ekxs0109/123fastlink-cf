# 123 云盘秒传 Cloudflare Worker

支持 123 云盘、夸克网盘、天翼云盘的秒传 JSON 生成服务。

**在线使用**: [https://123.kkit.app](https://123.kkit.app)

## ✨ 特性

- 📦 支持 123 云盘、夸克网盘、天翼云盘
- 🔐 支持加密分享链接
- 📁 支持文件夹批量获取
- 🎯 自动生成秒传 JSON
- 💰 完全免费

## 🚀 部署

### 方法一：一键部署（推荐）

点击按钮，登录 Cloudflare 账号即可自动部署：

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ekxs0109/123fastlink-cf)

### 方法二：命令行部署

```bash
git clone git@github.com:ekxs0109/123fastlink-cf.git
cd 123fastlink-cf
pnpm install
npx wrangler login
pnpm run deploy
```

## 📖 使用说明

**在线使用**: 直接访问 [https://123.kkit.app](https://123.kkit.app)

部署后访问你的 Worker 域名使用 Web 界面：

1. 输入分享链接
2. 输入分享密码（如有）
3. 选择云盘类型
4. 点击生成秒传 JSON

## 🛠️ 本地开发

```bash
pnpm install
pnpm run dev
# 访问 http://localhost:8787
```

## 📦 支持的云盘

- 123 云盘
- 夸克网盘
- 天翼云盘

## 🔗 配合使用

推荐配合 [123FastLink](https://github.com/Bao-qing/123FastLink) 使用：

1. 使用本项目生成秒传 JSON
2. 使用 123FastLink 客户端导入秒传文件
3. 快速转存到你的网盘

## 📄 许可证

Apache License
