# dsh-web-background 插件维护笔记

> 插件用途：给 dsh web 界面（http://127.0.0.1:3080）换自定义背景图，并根据图片
> 自动生成 GUI 主题（品牌色/界面底色/文字色/字体/图标颜色）。
> 2026-08-15 起：设置面板（General 区块、Agent 预设下方）新增「自定义背景」框，
> 点击后弹出定制对话框：可粘贴图片 URL、选择本地图片、调节遮罩不透明度、停用/启用、恢复默认；
> 对话框底部新增「自动主题」区：自动跟随背景图生成、单独选择主题图片、从当前背景图生成、清除主题。
> v0.2.0 起：背景 + 主题收进独立的「自定义」外观（外观行第四个方块，注册进主题服务的
> 真实主题，colorScheme dark）；浅色/深色/跟随系统 = 完全默认外观。详见「自动主题」章。

## 插件位置

- profile 副本：`~/.dsh/profiles/web/node_modules/dsh-web-background/` —— **是指向源码目录
  （`~/Documents/deepseek/dsh-web-background`）的符号链接**，源码改动直接生效，无需同步。
  ⚠️ 也因此**绝不能**在这个路径下做 `rm -rf` / `rsync --delete` 类操作——操作的就是源码树
  本身（2026-09 踩过：在「部署目录」里清理误删了源码树的 node_modules 和几个未跟踪的
  旁挂目录）。
- 全局副本：`~/.local/lib/node_modules/@deepseek-ai/dsh/node_modules/dsh-web-background/`
  （真实目录，npm 全局安装时复制；macOS TCC 保护，沙箱 shell 写入会 `Operation not permitted`）。

全局副本同步命令（从源码目录执行；**用白名单清单同步**，源码树里的 `dsh-routing-suite/`、
`dsh-super-injector-*/`、`.git`、`node_modules` 等不属于插件，`rsync -a --delete ./` 全量
同步会把它们灌进部署副本）：

```bash
rsync -a --delete lib assets docs scripts LICENSE README.md package.json cordis.patch.yml \
  ~/.local/lib/node_modules/@deepseek-ai/dsh/node_modules/dsh-web-background/
```

> macOS 下 shell 对 `~/.local/lib/node_modules` 的写入会报 `Operation not permitted`（TCC 保护）；
> 改用 DSH 注入器的 `dev_stage_add` 挂一个临时工具，在 DSH 进程内用
> `process.getBuiltinModule('node:fs')` 复制 `lib/index.js`、`lib/client.js` 等文件，
> 然后 `dev_reload_package dsh-web-background` 热重载（改 lib/index.js 的 Config schema 后仍需完整重启，
> 浏览器 configForms 镜像才能看到新字段）。

## 文件结构与构建

- `lib/index.js` — Node 半部分（DSH ≥ 0.1.7）：导出 volatile `Config`（`image`/`overlay`/`enabled`/
  `customActive`/`themeEnabled`/`themePalette`/`themeFont`/`themeCustom`/弹窗尺寸），Host 设置服务据此把字段投到
  浏览器 `configForms` 镜像，并把用户修改持久化进 profile 的 `cordis.patch.yml`；`apply` 只调
  `settings.configure({ auto: false })` 关掉自动设置页。
  **改 schema 必须重启**（configForms 镜像按 entry 重建）。v0.2.0 新增 `customActive`，
  升级后需要一次完整重启才能在 Host 设置里持久化该字段（重启前由 localStorage 镜像兜底）。
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

## 设置持久化（Host 设置 + localStorage 镜像）

- 读：Host 镜像 ready 时以其为准，**但只认 `snap.user` 里显式存在的字段**（用户级写入记录）；
  仅在 `snap.value` 里出现的字段可能只是 schema 默认值——新增的 Config 字段在重启前的写入
  会被 Host 拒收，重启后 value 有默认值而 user 没有记录，若按 value 归一化，第一次设置回显
  就会把 localStorage 里的值打回默认（v0.2.0 的「启动后从暗色跳浅色」就是这么来的：
  customActive 重启前只进了 localStorage，重启后 value=false 盖掉了它）。user 无记录的字段
  一律回退 localStorage 镜像。
- 写：`tryMigrate` 除一次性整体迁移外，还会**逐字段前向迁移**——user 无记录且本地值与 Host
  值不同的字段写进 Host（`forwardWrite`）。写入尝试按字段记录（`forwardAttempts`）防止
  写/回显循环；被拒的尝试会撤销标记以便重启后重试。⚠️ 拒绝回调必须写在独立函数里：
  循环内联的 `var` 闭包共享变量，回调触发时 field 已是循环末值，标记永远清不掉（踩过）。
- `scope.set/unset` 全部包同步 try/catch + promise catch：旧 schema 会以未知字段拒绝写入。

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
- 通过官方主题服务以 **overrideTokens 图层**叠加（v0.2.0 定型；此前曾用 `ctx.theme.register`
  注册独立主题，后因 ui-theme 的 adopt() 机制放弃，见下）：插件声明 `inject: [..., "theme"]`，
  自定义模式下调用 `ctx.theme.overrideTokens("auto-theme",
  schemeLockedTokens(buildThemeTokens(profile, next.themeCustom)))`——`schemeLockedTokens`
  把每个 token 的 `{light, dark}` 两端都锁成 dark 值，使图层与 scheme 无关（退出自定义的
  那一帧即使 scheme 已翻浅色也不会露浅色面）。该图层只在自定义模式叠放，**默认深浅外观
  完全不受影响**（修掉了 v0.1.x「只有深色下生效、且污染深色」的问题）。旧版主题服务没有
  `setTheme`/`getTheme` 时自动降级回 v0.1.3 的常驻叠层行为。
  `dsh-client-ui-layout` 的 ThemePresenter 把各图层合成后的 token 写到 body 内联样式，
  并按 `active.colorScheme` 切 `body[data-ds-dark-theme]`。
- **为什么不再 register 独立主题（v0.2.0 的根治教训）**：ui-theme 的 `adopt()` 在**每一次
  设置同步**（桌面端约 19s 一次）都把外观偏好重置为 Host 持久化值，而其 schema 只认
  light/dark/system——注册进主题服务的自定义 id 无法持久化，于是每 19s 被踩回一次，踩与
  插件拉回之间总有一帧浅色闪烁（用户三连截图里的白色代码块）。改用「持久化合法内置值
  `dark` + overrideTokens 图层」后，`adopt()` 读到的持久化偏好恒等于当前偏好，**永久
  no-op**，翻转消失（信标实测 72s+ 零 theme/change）。
- **「自定义」外观模式（v0.2.0）**：外观行（ui-theme 的 AppearanceRow，三个硬编码
  方块 浅色/深色/跟随系统，选中态跟随 `preference`）被 DOM 注入第四个方块「自定义」。
  实现要点（client.template.js「custom appearance cube」区块）：
  - 行定位：哈希类名探针 `APPEARANCE_CUBE_PROBES = ["kIe1nG", "TDnZ3a"]`（0.2.0-rc.1 /
    0.1.7-rc 构建；选择器形如 `[class*='kIe1nG_cubeRow']`）+ 结构化兜底（恰好 3 个 aria-pressed
    按钮的容器）。都找不到且页面上存在 aria-pressed 按钮组时 warn 一次（设置页未
    打开时不报）。
  - 方块样式在运行时从 shell 自己的方块抄：base class 抄未选中方块；选中态 class 是
    「pressed 方块 − 未 pressed 方块」的 classList 差集，缓存进 localStorage
    （`dsh-web-background:cube`），保证启动即自定义模式（此时没有 pressed 方块可观测）
    也有选中样式；实在没有就用 boxShadow 兜底。
  - 图标走 `require("react-dom/client")` 挂载 `IconSparkleMedium`（primitives）；
    require 失败退化为纯文字方块。
  - React 只就地更新三个已知方块的 props，不会动追加的第四个子节点；MutationObserver
    （childList subtree，microtask 合帧）在设置页重挂载后自愈重插。
  - **进出语义**：进入「自定义」→ 记住当前内置偏好（`prevBuiltInPreference`）→
    `store.setCustomActive(true)` → store 订阅者叠图层 + `setTheme("dark")`（**合法
    schema 值，写进 Host 持久化**）。点 shell 的浅色/深色/跟随系统方块 → 捕获期 click
    监听**立即** `setCustomActive(false)`（不依赖随后的 theme/change，因此重复点击
    已选中的深色方块——不会 publish——也能正确退出到原生深色）。再点一次「自定义」或
    关掉对话框开关 → `leaveCustomMode()`：退出并回切 `prevBuiltInPreference`。
    非点击的偏好变动（Host 设置 adoption / 跨窗口同步）由 `theme/change`（cordis 事件
    挂在共享 events 服务上，任何 ctx.on 都能收到）与 1s 看门狗重新断言回 "dark"。
  - **深色方块的选中态抑制**：自定义激活时 shell 偏好就是 dark，深色方块会渲染成选中；
    `refreshAppearanceCube()` 此时摘掉它的选中 class（差集已知），退出时加回。React
    下次重渲染会自然对齐。
  - 对话框「背景」区也有同一个开关（作为方块注入失败时的备用入口 + 说明文案）。
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

| 层 | ≤0.1.6 构建 | 0.1.7-rc 构建 | 0.2.0-rc.1 构建 | 处理 |
|---|---|---|---|---|
| 应用框架 | `.pI_x6G_frame` | `.P9Gu9a_frame` | `.trXoda_frame` | transparent |
| 中央内容列 | —（旧版无此层） | `.P9Gu9a_centerCol` | `.trXoda_centerCol` | transparent |
| 右侧面板列 | —（旧版无此层） | `.P9Gu9a_rightbarCol` | `.trXoda_rightbarCol` | transparent |
| 会话区 | `.wSkVaW_root` | `._5AcOhq_root` | `.wQcD8W_root` | transparent |
| 侧栏栏位 | `.pI_x6G_sidebarCol` | `.P9Gu9a_sidebarCol` | `.trXoda_sidebarCol` | transparent |
| 侧栏 | `.hHd-Xa_root` | `.pjj1TG_root` | `.yuWXda_root` | `var(--dsw-specific-sidebar-fill, rgba(10,14,28,0.6))` 遮罩保可读性 |

各代的来源插件：ui-layout 提供 `_frame` / `_centerCol` / `_rightbarCol` / `_sidebarCol`，
ui-conversation 提供那个持 `--dsw-alias-bg-base` 的 `_root`，ui-sidebar 提供侧栏 `_root`。
⚠️ 0.1.7 起 ui-layout 把 `bg-base` 拆到了**三个**元素上（frame + centerCol + rightbarCol，
后两个带桌面窗口圆角样式）——只透 frame 不够，主区域会被 centerCol 盖住（踩过，见时间线 9）。
核对方法：对 asar 里 `dsh-client-ui-layout/lib/client.js` 搜 `background:var(--dsw-alias-bg-base)`，
每个命中的类都要进透明列表。外观行 cubeRow 探针同理：0.2.0-rc.1 = `kIe1nG`，0.1.7-rc = `TDnZ3a`
（搜 `dsh-client-ui-theme/lib/client.js` 里的 `_cubeRow`）。

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
11. **register 独立主题被 adopt() 周期踩回（v0.2.0 的核心坑）**：症状是「主题会变」——
    每 ~19s 浅色一闪（代码块/输入框先变白），重启后偶发卡白。信标（把启动事件环
    scope.set 进 themeFont 字段、从 patch 文件回读；YAML 回环会截断 `{`、`"` 和
    续行折叠，payload 只能用 k=v+圆括号编码）抓到 `theme/change pref=system` 每 19s 一次。
    根因：ui-theme 的 `adopt()` 在每次设置同步都把偏好重置为 Host 持久化值；自定义主题 id
    不在其 schema（仅 light/dark/system），`setTheme(自定义id)` 只能会话内存活，必被踩掉。
    修复（定型方案）：自定义模式 = **持久化内置 "dark" 偏好**（合法值，adopt() 恒 no-op）
    + **scheme 锁定 overrideTokens 图层**（light/dark 两端同 dark 值）+ 1s 看门狗兜底
    （scope 未 ready 时 poke store；偏好偏离基底且无壳层方块点击时断言回 "dark"）。
    主动离开在捕获期 click 监听里**立即** setCustomActive(false)，不再依赖 theme/change
    （重点已选中的深色方块不 publish，pending 标志会漏）。
