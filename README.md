# dsh-web-background

给 DeepSeek Harness Web 界面换自定义背景，并根据背景图自动生成一整套 GUI 主题。

只需一张图：插件会把它铺成界面背景（自动加可读性遮罩），同时从图片里提取主色，生成品牌色、界面底色、文字色、边框、按钮、侧边栏、代码块、字体等一系列主题 token——浅色/深色外观分别适配。

当前版本：**0.1.3**（需要 DSH **≥ 0.1.7**；0.1.6 及更早版本请用 v0.1.2）

## 特性

### 🖼️ 自定义背景

- 支持粘贴图片 URL，或选择本地图片（最大 8 MB）
- 可调节遮罩不透明度（0–95%），保证长文本可读
- 可随时停用 / 恢复默认背景
- 内置一张默认背景图（base64 内联，不依赖外部文件）

### 🎨 图片自动主题

- 用 Canvas 把图片缩到 64px，量化 512 个 RGB 桶，提取最多 8 个主色
- 采用「中心加权 + 边缘对比」估计主体色：越靠近画面中心、与边缘背景差异越大的像素权重越高
- 主体色固定为品牌色来源；高光 / brand / hover 状态统一从主体色派生，保留色相与饱和度
- 浅色 / 深色外观各生成一套 token，通过 DSH 官方主题服务投影生效
- 「黑框」类表面（对话框 / 弹层 / 代码块 / 气泡 / 菜单 / 侧边栏）使用同色相深色调，不再是近黑中性色
- 字体按图片饱和度 / 明度 / 色相自动在 4 套字体栈中挑选（系统 / 圆润 / 科技 / 衬线古典）
- 状态色（success / warn / error）保留语义色，不参与图片配色

### 🧩 逐项自定义

在自动主题之上，还可以对 11 个表面分组逐项覆盖：

基础背景 · 对话框/弹层 · 模块面板 · 公式/代码黑框 · 气泡 · 输入区 · 菜单 · 选择器 · 侧边栏 · 展开侧边栏 · 高光/品牌色

每项支持：

- 指定颜色（该表面完全由你控制）
- 只调透明度（留空颜色时，对自动色按表面默认透明度等比缩放，层级关系自动保留）
- 一键「恢复自动」

### 🪟 编辑器体验

- 外观对话框右下角可**拖拽调整大小**，尺寸自动保存；**双击拖拽角恢复自然大小**
- 三个折叠区全部展开时各自内部滚动，对话框不会超出屏幕
- 折叠区展开状态在重渲染后保持，不会被弹回

### 💾 持久化

- 插件的偏好就是它的 volatile `Config`（DSH ≥ 0.1.7）：Host 设置服务把用户修改持久化到
  profile 的 `cordis.patch.yml`（`- id: dsh-web-background config: ...`）
- 浏览器端同时镜像到 localStorage，Host 设置可用后自动迁移，无缝切换
- 背景、主题、逐项覆盖以及**对话框尺寸**都会持久化
- 「恢复默认」会同时清除 Host 设置和本地缓存

## 快速开始

### 安装

推荐直接通过 GitHub 仓库装配：

```powershell
dsh plugin --profile web add github:Focalorsdd/dsh-web-background
```

或克隆后本地装配：

```powershell
git clone https://github.com/Focalorsdd/dsh-web-background
dsh plugin --profile web add ./dsh-web-background
```

装配完成后**重启 `dsh web`**（首次需要注册 Host 设置命名空间）。之后的 `lib/client.js` 改动会被 HMR 自动推送，无需反复重启。

### 使用

1. 打开 DSH Web 界面 → 设置 → General
2. 在 Agent 预设下方找到「**自定义外观**」卡片，点击打开编辑器
3. 「背景」区：粘贴 URL / 选择本地图片 / 调遮罩 / 启停 / 恢复默认
4. 「自动主题」区：跟随背景生成、单独选主题图、从当前背景重新生成、清除主题
5. 「逐项自定义」区：按需覆盖单个表面的颜色和透明度
6. 拖拽对话框右下角可调整大小；双击拖拽角恢复默认尺寸

## 自动主题怎么工作

```
图片 → 缩放到 64px → 量化主色（≤8）→ 主体色识别
     → 派生 hue/saturation + 明度可读性 clamp
     → 生成 light/dark 两套 token
     → ctx.theme.overrideTokens 投影
     → 用户逐项覆盖（如有）→ 最终生效
```

- 低饱和图片自动回退到默认主题色相（222）
- 跨域图片（外部 URL 无 CORS）无法读取像素，背景仍可显示，但自动主题会提示改用本地图片
- 代码字体不动，图标随 `label-*` / `brand-primary` 自动变色

## 本地构建

插件源码分为两部分：`lib/index.js`（Node 半部分）与 `lib/client.js`（浏览器半部分，由模板构建而来）。

```bash
# 重新生成 lib/client.js（默认背景图替换后也需要执行）
npm run build

# 离线冒烟测试（无需浏览器）
npm test
```

也可以直接调用脚本（冒烟测试支持 `DSH_PACKAGE_JSON` 指定 DSH 安装位置）：

```bash
node scripts/build-client.mjs
DSH_PACKAGE_JSON=/path/to/@deepseek-ai/dsh/package.json node scripts/smoke-test.mjs
```

## 文件结构

| 路径 | 说明 |
|---|---|
| `lib/index.js` | Node 半部分：注册 Host 设置命名空间与 schema |
| `lib/client.template.js` | 浏览器半部分可读源码（设置 UI + 背景 CSS + 主题逻辑） |
| `lib/client.js` | 浏览器部署产物，由模板构建生成，勿手改 |
| `assets/default-photo.b64` | 默认背景图 base64 |
| `scripts/build-client.mjs` | 把模板 + 默认图构建为 `lib/client.js` |
| `scripts/smoke-test.mjs` | 离线冒烟测试 |
| `cordis.patch.yml` | bundle patch：装配后插入 `web-background` loader entry |
| `docs/MAINTENANCE.md` | 维护笔记：加载链路、设置持久化、主题实现细节、踩坑记录 |

## 常见问题

**图片显示出来了，但自动主题提示跨域失败？**
外部图片 URL 没有 CORS 头时浏览器无法读取 Canvas 像素。背景不受影响；如需自动主题，请选择本地图片。

**换了图片但界面没变化？**
`lib/client.js` 会热更新；如果是首次安装、改过 `package.json`，或 Host 设置命名空间还没出现，请重启 `dsh web`。

**DSH 升级后背景消失了？**
应用自身不透明层的类名是前端构建生成的哈希名，升级后可能变化。排查方法见 `docs/MAINTENANCE.md`。

**外观对话框尺寸不合适？**
拖拽右下角调整到合适大小，尺寸会自动保存；双击拖拽角即可恢复默认尺寸。

## License

MIT
