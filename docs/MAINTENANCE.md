# dsh-web-background 插件维护笔记

> 插件用途：给 dsh web 界面（http://127.0.0.1:3080）换自定义背景图，并根据图片
> 自动生成 GUI 主题（品牌色/界面底色/文字色/字体/图标颜色）。
> 2026-08-15 起：设置面板（General 区块、Agent 预设下方）新增「自定义背景」框，
> 点击后弹出定制对话框：可粘贴图片 URL、选择本地图片、调节遮罩不透明度、停用/启用、恢复默认；
> 对话框底部新增「自动主题」区：自动跟随背景图生成、单独选择主题图片、从当前背景图生成、清除主题。

## 插件位置（两个副本，改动后必须同步）

- profile 副本：`~/.dsh/profiles/web/node_modules/dsh-web-background/`
- 全局副本：`~/.local/lib/node_modules/@deepseek-ai/dsh/node_modules/dsh-web-background/`

同步命令（从源码目录 `~/Documents/deepseek/dsh-web-background` 执行）：

```bash
rsync -a --delete ./ ~/.dsh/profiles/web/node_modules/dsh-web-background/
rsync -a --delete ./ ~/.local/lib/node_modules/@deepseek-ai/dsh/node_modules/dsh-web-background/
```

> macOS 下若 shell 对 `~/.dsh` 报 `Operation not permitted`（TCC 保护），rsync 会失败；
> 改用 DSH 注入器的 `dev_stage_add` 挂一个临时工具，在 DSH 进程内用
> `process.getBuiltinModule('node:fs')` 复制 `lib/index.js`、`lib/client.js` 等文件，
> 然后 `dev_reload_package dsh-web-background` 热重载（改 lib/index.js 后仍需完整重启 dsh web 才能让浏览器 settingsScope 看到新 schema）。

## 文件结构与构建

- `lib/index.js` — Node 半部分：向 Host 注册 `dsh-web-background` 设置命名空间
  （schema: `image`/`overlay`/`enabled`/`themeEnabled`/`themePalette`/`themeFont`）。
  **改它必须重启 `dsh web`**（仅热重载 Host fiber 时，浏览器 settingsScope 可能仍看不到新命名空间）。
- `lib/client.template.js` — 浏览器半部分的可读源码（设置行 UI + 背景注入 CSS + 调色板
  提取/主题 token 投影，约 392 行主题逻辑集中在 `paintBackground()` 之后的 Auto theme 区块）。
- `assets/default-photo.b64` — 默认背景图的 base64（678K JPEG）。
- `lib/client.js` — 部署产物，由下面命令生成，**不要手改**：

```bash
node scripts/build-client.mjs
node scripts/smoke-test.mjs   # 离线冒烟测试（无需浏览器）
```

换默认背景图：替换 `assets/default-photo.b64` 后重新构建。
（dsh 的 `/plugins/<id>/` 路由只下发 `client.js`，不能引用外部文件；`file://` 被浏览器拦截，图片必须内联。）

## 加载链路（三个必要条件，缺一不可）

1. **Node 半部分** `lib/index.js`：cordis 插件必须是「函数」或「带 `apply` 方法的对象」。
2. **浏览器半部分** `lib/client.js`：factory 返回值必须 `exports.apply = apply; return module.exports;`
   （返回空对象会报 `invalid plugin, expect function or object with an "apply" method`）。
3. **package.json 的 `dsh.client` 必须有 `"immediately": true`**，否则浏览器只登记不加载。
   package.json 元数据有缓存，改它**必须重启 `dsh web`**；`lib/client.js` 内容改动由 HMR
   轮询（500ms）自动推送，不用重启。

## 设置持久化（两段式，都无需额外操作）

- 浏览器端把 `image`/`overlay`/`enabled` 写入 localStorage（`dsh-web-background:v1`），
  并同步写入 Host 设置命名空间（重启 dsh 后命名空间由 Node 半部分注册）。
- Node 半部分生效后（即重启后）首次读到 Host 视图时，若 Host 无用户覆盖而 localStorage 有值，
  自动把 localStorage 值迁移进 Host 设置文档；之后以 Host 为准。
- 「恢复默认」会同时清掉 localStorage 和 Host 字段。

## 自动主题（图片 → GUI 主题）

- 客户端用 Canvas 把图片缩到 64px，量化 512 个 RGB 桶，按频次 + 色距挑出 ≤8 个主色；
  同时用**中心加权 + 边缘对比桶**估计主体色：像素越靠近画面中心、或与边缘背景平均色
  差异越大，主体权重越高；再按权重 × 饱和度选主体色并固定放到 `palette[0]`。
  高光/brand/交互 hover 一律从 `palette[0]` 取色，只按深浅外观调整明度、保留主体
  色相与饱和度（低饱和图回退到 `DEFAULT_THEME_HUE`）。
- 通过官方主题服务投影 token：插件声明 `inject: [..., "theme"]`，在 effect 中调用
  `ctx.theme.overrideTokens("auto-theme", buildThemeTokens(profile, next.themeCustom))`；
  `dsh-client-ui-layout` 的 ThemePresenter 会把 token 写到 `document.body`，并随浅色/深色
  外观自动取 `light`/`dark` 值。
- **自定义外观（背景 + 主题合一）**：General 设置的外观区只有一个「自定义外观」行
  （slot id `appearance-custom`，order 11），点击进入同一个 Modal，内含三个可折叠区
  （展开状态由 React state 管理，重渲染不会把折叠区弹开）：「背景」管理图片 URL/本地图/
  遮罩/启用，错误提示就显示在本区内；「自动主题」管理跟随生成/单独选图/重新生成/清除；
  「逐项自定义」是逐项表面编辑器。每个表面分组（基础背景/对话框弹层/模块面板/公式代码框/
  气泡/输入区/菜单/选择器/侧边栏/展开侧边栏/高光品牌色）一行：生效色预览 swatch（自动时
  显示按当前深浅外观解析出的自动色）、颜色选择器（自动模式下打开取色器以自动色为起点，
  不再误导为黑色）、透明度滑杆（**颜色留空时也可用**：设了颜色 = 绝对透明度原样投影；
  留空 = 对自动色内建 alpha 按 `alpha/表面默认值` 等比缩放——solid 色按表面默认值当作
  内建 alpha，同组多 token 的层级（hover < active < 填充）自动保留）、「恢复自动」按钮
  （仅在该行被自定义后出现）；底部「全部恢复自动」也只在有自定义项时出现。字体行带
  「自动」选项（回到按图自动选字体）。设置存 `themeCustom`，空颜色代表跟随自动主题，
  非空颜色按用户给定值原样覆盖对应 token（light/dark 同值）。
  自动色解析走 `ctx.theme.getTheme()` 的 active colorScheme，取不到时回退 matchMedia → dark。
- 覆盖范围：`--dsw-alias-bg-*`、`border-*`、`brand-primary`、按钮、交互 hover、
  `label-*`、markdown 代码块、sidebar 相关 token；状态色（success/warn/error）保留语义色。
- 「黑框」类表面（对话框/弹层、markdown 代码块、气泡、菜单、侧边栏及展开侧边栏的
  激活/悬停项）使用 `darkTint`/`lightTint` 生成——保留主体色相、显著提高饱和度，
  不再是近黑色中性面板。背景 CSS 里侧边栏 scrim 也改为
  `var(--dsw-specific-sidebar-fill, rgba(10,14,28,0.6))`，主题开启时自动变主体色。
- 字体：按图片饱和度/明度/色相在 4 套系统字体栈里自动选择（system / rounded / tech / serif），
  同时覆盖 `--dsw-font-family` 与前端使用的全部非代码字体 shorthand token；代码字体不动。
- 图标：DSH 图标基本用 `currentColor`，会随 `label-*` / `brand-primary` 自动变色；
  插件不替换图标形状（图标资源是构建期固定的，运行时无法新增）。
- 跨域图片（外部 URL 无 CORS）无法读 Canvas 像素，会自动提示改选本地图片；背景图本身不受影响。
- 持久化：`themeEnabled`/`themePalette`/`themeFont` 与背景字段同路径（Host 设置 + localStorage 镜像）。

## 遮挡层（dsh 升级后背景消失的排查点）

应用自身有不透明全屏层会盖住 body 背景，当前在 `lib/client.template.js` 的 `buildCss()` 里已置透明：

| 层 | 类名 | 处理 |
|---|---|---|
| 应用框架 | `.pI_x6G_frame` | transparent |
| 会话区 | `.wSkVaW_root` | transparent |
| 侧栏栏位 | `.pI_x6G_sidebarCol` | transparent |
| 侧栏 | `.hHd-Xa_root` | `rgba(10,14,28,0.6)` 深色遮罩保可读性 |

**这些类名是 dsh-web-frontend 构建时生成的哈希名，dsh 升级后会变。** 升级后若背景消失，重新探测类名：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --user-data-dir=/tmp/dsh-chrome-profile --remote-debugging-port=9223 about:blank &
```

然后用 CDP `Runtime.evaluate` 执行探针（Node 26 自带 WebSocket / fetch）：

```js
// 找出从点击点到 body 之间所有带不透明背景的元素
let el = document.elementFromPoint(720, 450);
while (el && el !== document.documentElement) {
  const cs = getComputedStyle(el);
  if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') console.log(el.className, cs.backgroundColor);
  el = el.parentElement;
}
```

把新类名替换进 `buildCss()` 对应规则即可。

## 可调参数（lib/client.template.js）

- `DEFAULT_OVERLAY`（0.55）：默认遮罩不透明度；运行时可在设置框里调（0–95%）。
- `.hHd-Xa_root` 规则里的 `0.6`：侧栏遮罩明暗。
- 设置行插槽：`settings.general.item`，`id: "background"`，`order: -23`
  （Agent 预设 -25 之下、权限 -20 之上）。

## 本次踩过的坑（时间线）

1. 初版浏览器半部分返回空对象 → `invalid plugin`（修复：补 `exports.apply`）。
2. 缺 `immediately: true` → 浏览器从未加载 client.js（修复后需重启 dsh web）。
3. 应用不透明层遮挡 + OVERLAY 0.72 太暗（修复：置透明 + 调 0.55）。
4. 残留 `dsh web` 进程占用 3080 端口（EADDRINUSE）；先 `lsof -nP -iTCP:3080 -sTCP:LISTEN` 查 PID。
5. 新增设置行时，Host 命名空间未注册（未重启）→ 设置作用域 `unavailable`；
   已用 localStorage 兜底 + 自动迁移解决，重启后自动切换到 Host 持久化。
