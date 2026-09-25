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
> 然后 `dev_reload_package dsh-web-background` 热重载（改 lib/index.js 的 Config schema 后仍需完整重启，
> 浏览器 configForms 镜像才能看到新字段）。

## 文件结构与构建

- `lib/index.js` — Node 半部分（DSH ≥ 0.1.7）：导出 volatile `Config`（`image`/`overlay`/`enabled`/
  `themeEnabled`/`themePalette`/`themeFont`/`themeCustom`/弹窗尺寸），Host 设置服务据此把字段投到
  浏览器 `configForms` 镜像，并把用户修改持久化进 profile 的 `cordis.patch.yml`；`apply` 只调
  `settings.configure({ auto: false })` 关掉自动设置页。
  **改 schema 必须重启**（configForms 镜像按 entry 重建）。
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

## 加载链路（DSH ≥ 0.1.7，条件缺一不可）

1. **Node 半部分** `lib/index.js`：cordis 插件必须是「函数」或「带 `apply` 方法的对象」；
   设置字段走 volatile `Config` 导出（不再有 `settings.register`）。
2. **浏览器半部分** `lib/client.js`：factory 返回值必须 `exports.apply = apply; return module.exports;`
   （返回空对象会报 `invalid plugin, expect function or object with an "apply" method`）。
3. **package.json 的 `dsh.client` 必须有 `"immediately": true`**，否则浏览器只登记不加载。
   package.json 元数据有缓存，改它**必须重启**；`lib/client.js` 内容改动由 HMR
   轮询（500ms）自动推送，不用重启。
4. **服务依赖必须指向存在的服务**：bundle 导出的 `inject`（服务名：
   `slots`/`locale`/`configForms`/`theme`）+ `dsh.client.inject`（包名，仅排序激活）。
   0.1.7 删掉了 `settingsScope` 服务，谁等它谁永远 pending——桌面端 web boot 会把
   「entry 未激活」当致命错误（`web boot: 1 entry did not activate`），整个 GUI 起不来。

## 设置持久化（DSH ≥ 0.1.7，两段式）

- 浏览器端 `ctx.configForms.get("dsh-web-background")`（entry id 见 cordis.patch.yml）拿到
  共享表单：`getSnapshot()` → `{status,value,base,user,revision,writable,mode}`，
  `set`/`unset`/`mutate` 写回；Host 端 `dsh-settings` 把 volatile 字段的用户覆盖持久化到
  profile 的 `cordis.patch.yml`（`- id: dsh-web-background config: ...`）。
- localStorage（`dsh-web-background:v1`）继续作镜像与兜底：Host 无用户覆盖而 localStorage
  有值时自动迁移进 Host；之后以 Host 为准。
- 「恢复默认」会同时清掉 localStorage 和 Host 字段。
- 0.1.6 及更早版本请用插件 v0.1.2（旧 `settingsScope` API）。

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

应用自身有不透明全屏层会盖住 body 背景，当前在 `lib/client.template.js` 的 `buildCss()` 里已置透明。
选择器按前端构建「代」并排保留：不再匹配的那一代只是空转 CSS，不影响另一代，因此一次 App 升级不会立刻打断另一侧。

| 层 | ≤0.1.6 构建 | 0.1.7-rc 构建 | 处理 |
|---|---|---|---|
| 应用框架 | `.pI_x6G_frame` | `.P9Gu9a_frame` | transparent |
| 中央内容列 | —（旧版无此层） | `.P9Gu9a_centerCol` | transparent |
| 右侧面板列 | —（旧版无此层） | `.P9Gu9a_rightbarCol` | transparent |
| 会话区 | `.wSkVaW_root` | `._5AcOhq_root` | transparent |
| 侧栏栏位 | `.pI_x6G_sidebarCol` | `.P9Gu9a_sidebarCol` | transparent |
| 侧栏 | `.hHd-Xa_root` | `.pjj1TG_root` | `rgba(10,14,28,0.6)` 深色遮罩保可读性 |

各代的来源插件：ui-layout 提供 `_frame` / `_centerCol` / `_rightbarCol` / `_sidebarCol`，
ui-conversation 提供那个持 `--dsw-alias-bg-base` 的 `_root`，ui-sidebar 提供侧栏 `_root`。
⚠️ 0.1.7 起 ui-layout 把 `bg-base` 拆到了**三个**元素上（frame + centerCol + rightbarCol，
后两个带桌面窗口圆角样式）——只透 frame 不够，主区域会被 centerCol 盖住（踩过，见时间线 9）。
核对方法：对 asar 里 `dsh-client-ui-layout/lib/client.js` 搜 `background:var(--dsw-alias-bg-base)`，
每个命中的类都要进透明列表。

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

把新类名加进 `buildCss()` 对应规则即可（保留旧一代作跨版本兼容）。

## 可调参数（lib/client.template.js）

- `DEFAULT_OVERLAY`（0.55）：默认遮罩不透明度；运行时可在设置框里调（0–95%）。
- 侧栏 `_root` 规则里的 `0.6`：侧栏遮罩明暗。
- 设置行插槽：`settings.general.item`，`id: "background"`，`order: -23`
  （Agent 预设 -25 之下、权限 -20 之上）。

## 本次踩过的坑（时间线）

1. 初版浏览器半部分返回空对象 → `invalid plugin`（修复：补 `exports.apply`）。
2. 缺 `immediately: true` → 浏览器从未加载 client.js（修复后需重启 dsh web）。
3. 应用不透明层遮挡 + OVERLAY 0.72 太暗（修复：置透明 + 调 0.55）。
4. 残留 `dsh web` 进程占用 3080 端口（EADDRINUSE）；先 `lsof -nP -iTCP:3080 -sTCP:LISTEN` 查 PID。
5. 新增设置行时，Host 命名空间未注册（未重启）→ 设置作用域 `unavailable`；
   已用 localStorage 兜底 + 自动迁移解决，重启后自动切换到 Host 持久化。
6. App 升到 0.1.7-rc.2 后哈希前缀换代（`pI_x6G`/`wSkVaW`/`hHd-Xa` → `P9Gu9a`/`_5AcOhq`/`pjj1TG`），
   旧选择器全部失配 → 设置项在、主题能生成，但主对话区仍是不透明 `--dsw-alias-bg-base`，背景被挡住。
   修复：两代选择器并排保留（空转 CSS 无副作用），并已用 `app.asar` 内
   `dsh-client-ui-{layout,conversation,sidebar}/lib/client.js` 的 CSS 串核对来源。
7. **0.1.7 删除 `settingsScope` 服务** → 桌面端 web boot 报
   `1 entry did not activate / pending (waiting for service: settingsScope)`，整个 GUI 起不来
   （崩溃日志在 `~/Library/Logs/Deep Seek Harness/crash-*-web-boot.log`）。
   迁移（v0.1.3）：设置体系改为「entry volatile Config」——Node 半部分导出带 `.volatile()` 的
   schemastery `Config`（需 schemastery ≥3.18.4 + cosmokit ≥1.8.5，直接从 app.asar 提取同版本）；
   浏览器半部分 `ctx.configForms.get(<entry id>)`（接口形状与旧 scope 相同，无缝替换）；
   entry id 统一为 `dsh-web-background`（= 包名 = 旧命名空间）；`dsh.client.inject` 按官方
   `cordis-plugin-development` skill 补上 4 个客户端包排序。
   注：官方要求第三方插件**不要** `require('@deepseek-ai/dsh-client-ui-primitives')`
   （应拷贝所需控件进插件）；当前静态模块表仍提供它（Modal/Button/Input 均在），暂未改，
   属已知脆弱点。
8. **崩溃自愈会把插件从 bundles 里摘掉**：web boot 连续崩溃两次后，App 自动把插件从
   profile `package.json` 的 `dsh.profile.bundles` 列表移除（依赖保留），之后能正常开机但
   插件不加载——"修好了重启却没效果"多半是这个。**修好代码后必须重新
   `dsh plugin --profile <name> add <dir>`**（reconcile 会把 bundle 加回列表），光重启没用。
9. **只透 frame 不够：0.1.7 的 ui-layout 有三个不透明层**。症状：主题紫色生效、图片已持久化
   （patch.yml 里有完整 config），但背景图不可见——`.P9Gu9a_centerCol`（中央内容列，带桌面
   圆角样式）和 `.P9Gu9a_rightbarCol` 也持 `bg-base`，漏透就整片盖住。排查法：主题色在而图不在
   = 取色/持久化/主题管道全通，问题只剩 CSS 层；对 asar 全量审 `background:var(--dsw-alias-bg-base)`
   命中（shell / ui-layout / ui-conversation / ui-sidebar）。修复即热更（client-hmr 在
   dsh-web-app 里，500ms 推送 client.js），不用重启。
10. **桌面端专属坑：macOS 半透明窗口规则打掉 html/body 背景**。frontend.css 有
    `html[data-platform=darwin], html[data-platform=darwin] body{background:transparent}`
    （桌面毛玻璃窗口用），属性选择器优先级 (0,1,1) 碾压我们的元素选择器 (0,0,1)——
    浏览器端没有 data-platform 属性所以一直正常，桌面端 html/body 背景声明静默失效。
    修复：html/body 背景声明**必须带 `!important`**（buildCss 已加）。
    诊断手法（可复用）：无 DevTools 时给插件加一个一次性探针，把
    getComputedStyle/selector 匹配数/Image 加载测试 JSON 化后 `scope.set("themeFont", json)`
    写进 profile patch 回读；注意 store 快照会做 normalizeFontId 归一化，清理时要读
    `scope.getSnapshot().user/value` 的**原始值**；清理定时器要重试（apply 后表单可能还在
    loading，一次性 setTimeout 会错过）。另：`--headless=new` 在本机沙箱里起不来，Chrome
    自测用 `--headless=old --no-sandbox --disable-crashpad --user-data-dir=/tmp/...`，
    且 macOS 没有 `timeout` 命令。
