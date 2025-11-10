# 夸克网盘秒传JSON生成器 - 用户脚本

## 功能特性

- ✅ 支持个人网盘页面生成JSON（直接在浏览器中获取MD5）
- ✅ 支持分享页面生成JSON（通过Cloudflare Worker获取MD5）
- ✅ 自动递归扫描文件夹
- ✅ 批量处理文件
- ✅ 显示进度条
- ✅ 一键复制JSON

## 安装步骤

### 1. 安装用户脚本管理器

推荐使用 [Tampermonkey](https://www.tampermonkey.net/)

### 2. 安装用户脚本

将 `quark-json-generator.user.js` 安装到 Tampermonkey

### 3. 部署 Cloudflare Worker（分享页面必需）

#### 3.1 登录 Cloudflare

```bash
cd /Users/ekxs/Codes/123fastlink-cf
pnpm run login
```

#### 3.2 部署 Worker

```bash
pnpm run deploy
```

部署成功后会得到类似这样的地址：
```
https://123fastlink.your-subdomain.workers.dev
```

#### 3.3 配置用户脚本

打开 `quark-json-generator.user.js`，找到这一行：

```javascript
const WORKER_API = "https://123fastlink.ekxs.workers.dev/api/quark/rapid";
```

替换为你自己的 Worker 地址：

```javascript
const WORKER_API = "https://123fastlink.your-subdomain.workers.dev/api/quark/rapid";
```

## 使用方法

### 个人网盘页面

1. 打开 https://pan.quark.cn/list
2. 勾选要生成JSON的文件或文件夹
3. 点击页面上的"生成JSON"按钮（绿色）
4. 等待处理完成
5. 复制JSON或下载文件

### 分享页面

1. 打开任意夸克分享链接，如 https://pan.quark.cn/s/xxxxxx
2. **确保已登录夸克网盘**（脚本需要Cookie）
3. 勾选要生成JSON的文件或文件夹
4. 点击页面上的"生成JSON"按钮（绿色）
5. 等待Worker API处理
6. 复制JSON或下载文件

## 工作原理

### 个人页面
- 直接调用夸克网盘API获取文件列表和MD5
- 无需额外服务，纯前端实现

### 分享页面
- 由于浏览器CORS限制和夸克的文件大小限制（23018错误）
- 脚本将分享链接和Cookie发送到你的Cloudflare Worker
- Worker在服务端调用夸克API获取MD5（绕过限制）
- 返回完整的秒传JSON给用户脚本

## 常见问题

### Q: 分享页面提示"Worker API调用失败"
A: 请确保已正确部署Worker并配置了API地址

### Q: 提示"请先登录网盘"
A: 分享页面需要登录才能获取Cookie，请先登录夸克网盘

### Q: MD5显示为空
A: 
- 个人页面：可能是网络问题或文件太大
- 分享页面：检查Worker是否正常部署，Cookie是否有效

### Q: 为什么分享页面需要Worker？
A: 夸克网盘对分享页面的下载接口有限制，直接在浏览器中调用会返回23018错误（文件大小限制）。通过Worker在服务端调用可以绕过这个限制。

## 技术细节

- **User-Agent伪装**：模拟夸克客户端（quark-cloud-drive/3.14.2）
- **Cookie传递**：将浏览器Cookie传递给Worker
- **批量处理**：每批处理10个文件，避免请求过载
- **递归扫描**：自动处理文件夹内的所有文件

## 安全说明

- Cookie仅在你自己的Cloudflare Worker中使用
- 不会发送到第三方服务器
- Worker代码完全开源，可自行审查

## 开源协议

MIT License

## 参考项目

- [tgto123-public](https://github.com/walkingddd/tgto123-public)
- Cloudflare Workers
