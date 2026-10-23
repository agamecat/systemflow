# AGENTS.md — AI 助手交接说明（任何后续 AI 或人类开发者）

读完这份文件就能安全修改本项目。**改代码前先读「数据不变式」与「踩坑」两节。**

## 项目是什么

**基带 IP 系统信号流图编辑器**：广播行业用来画"设备—端口—信号"拓扑的工具。

核心能力：
- **双视图**：光纤连接图（物理连线）/ IP 路由图（按组播地址追踪信号流）
- **JSON 为唯一事实源**：信号图本体（SignalGraph v2）驱动一切，画布只是派生
- **零依赖单文件**：`sysflow.html` 一个文件包含 HTML/CSS/JS，双击用浏览器打开即用；无构建、无后端、无网络请求

## 仓库内容

```
sysflow.html      全部代码（单文件）
docs/             数据模型与可视化方法论
data/             脱敏示例图（7 设备 / 6 连线 / 3 路流，由 tools/make-mock-data.py 生成）+ 3 个模板
tools/            e2e.cjs 自检、import-sqlite.py 旧库转换
```

## 仓库与运行

```
主仓库：https://cnb.cool/gamecatobs/sysflow
GitHub：https://github.com/agamecat/systemflow （public 镜像，同一份代码，含 data/ 系统图）
分支：main，两边同步推（每次改动即 commit+push 是既定工作流）
旧仓库 systemflow、systemflow2（cnb 上的旧名）均已废弃，勿推
```

**运行**：双击 `sysflow.html`。没有 dev server、没有 `npm install`、没有 `.env`。

**推送**（本机不保存令牌，每次由用户临时提供，用完不落盘）：
```bash
git -c credential.helper= push "https://cnb:<token>@cnb.cool/gamecatobs/sysflow.git" main
git -c credential.helper= push "https://agamecat:<pat>@github.com/agamecat/systemflow.git" main
git ls-remote "<带令牌的远端>" refs/heads/main   # 核对远端真值（两边都要核）
```
显式 URL 推送不会更新本地 `origin/main`，推完用
`git update-ref refs/remotes/origin/main <远端SHA>` 对齐。
提交身份用仓库级 `sysflow <sysflow@local>`（未配全局身份）。

## 架构：一条单向管线

```
用户操作 ─┐
          ├→ Actions（唯一写入口：校验 → 改本体 → snapshot → afterChange）
导入 JSON ┘                                   │
                                              ├→ 派生（mirrorBPorts / followRenames / cleanOrphanReceivers）
                                              │
                                              ├→ buildSegments()（视图/流追踪）
                                              │
                                              └→ render() 拼 SVG 字符串 → svg.innerHTML 整体替换
```

- **本体**：`S.doc.graph = {version:2, name, devices[], links[]}`，不含坐标
- **视图层**：`S.doc.layout.nodes[deviceId] = {x,y}`，只由拖拽/整理布局写入
- **派生**：接收组播、B 口镜像、流路径都是算出来的，不单独存储
- **重绘**：每次数据变化整棵 SVG 重拼，不做增量 diff（图规模 24~50 台设备，实测流畅）
- **事件**：委托在 `#canvas` / `window` 上，不随 SVG 重建而失效

## 代码地图（`sysflow.html`，按文件内小节标题搜）

| 区域 | 关键函数 | 职责 |
|---|---|---|
| 常量 | `NODE_PAD/NAME_H/PORT_ROW/SPARSE_ROW` | 设备卡片与端口行距（与旧 layout.ts 一致） |
| 工具 | `uid/esc/clamp/deep/isBidi/isMirror` | 通用；**所有进 SVG 的字符串必须过 `esc()`** |
| 存储 | `lsGet/lsSet/persistCurrent/saveToLibrary/openDoc` | localStorage 三键：`sf.current.v1` 草稿、`sf.library.v1` 图库、`sf.templates.v1` 模板 |
| 查找 | `deviceById/portByRef/portPoint/portPointById` | 端口坐标由此唯一产出 |
| 校验 | `checkLink/uniqueName` | 连线规则集中处 |
| 派生 | `mirrorBPortsIn/followRenames/cleanOrphanReceivers/pruneSignalLinks/traceSignals/allFlows/flowColor` | 全部幂等 |
| 写操作 | `addDevice/removeDevice/updateDevice/connect/connectSignal/deletePhysicalLink/deleteSignalLink/applyPortMulticast/tidyLayout` | 每个都要先 `snapshot()` |
| 几何 | `nodeGeom/bezierOf/applyFanOffsets` | 端口位置、贝塞尔、同端口多线扇形 |
| 关系图 | `relationLayout/cardAnchor/relEdgePath/relNodeSvg/relationSvg/relationPanelHtml` | 自动分层布局（只读视图），坐标现算不落盘 |
| 旧数据迁移 | `tools/import-sqlite.py`（Python，仅标准库） | 读旧 `graphs`/`device_templates` 表 → 每张图一个 JSON + `_all.json` + `templates.json`；坏行跳过 |
| 渲染 | `renderCanvas/renderChrome/renderStatus/renderAll` | 画布、右侧流面板、状态栏 |
| 相机 | `canvasSize/worldFromScreen/zoomAt/fitView` | viewBox 缩放；**唯一换算因子是 zoom** |
| 交互 | `onCanvasPointerDown/onPointerMove/onPointerUp/onWheel/onContextMenu/onKeyDown` | 拖拽/平移/连线/双击/快捷键 |
| 弹窗 | `modal/confirmDialog/toast/openDeviceEditor/openMulticastModal/openTemplateManager/openLibrary` | 可叠层，Esc 关最上层 |
| 导入导出 | `normalizeDoc/exportJson/importFile/importDocs` | 导入做归一化与引用校验；单个 JSON 替换画布，**数组则整批进图库** |
| 模板导入 | `normalizeTemplate/importTemplates` | 模板管理里的「导入模板…」；同 `type` 跳过、其余追加 |
| 视图建议 | `suggestedMode(doc)` | 只有信号连线（无物理连线）的图默认进 IP 路由视图，避免一屏孤立卡片 |

## 必须遵守的数据不变式（改代码前默读）

1. **本体/视图分离**：SignalGraph 不含坐标；坐标只进 `layout.nodes`。禁止把 x/y 写进 devices。
2. **接收组播是派生数据**：`multicast_in` 由信号连线自动生成/删除，UI 接收侧只读。
   源口改址 → 流标识全局跟随（`followRenames` 按条目 id）；源口停发 → 孤儿接收条目清理（`cleanOrphanReceivers`）。
   组播变更统一收口：画布双击端口走 `applyPortMulticast(..., live=true)`；
   设备编辑弹窗里改的是**深拷贝**，全局同步延迟到 `updateDevice` 写回本体后统一执行——
   提前同步会按"本体还是旧地址"误判停发、清掉信号连线。
3. **一个组播地址一个发送端**（排除镜像 B 口）：只在编辑路径前置校验；不做整图校验
   （同一地址沿转发链路重复出现是合法形态：交换机入/出口都声明该流）。
4. **删除设备/编辑设备也走停发清理**：`removeDevice`/`updateDevice` 末尾调 `cleanOrphanReceivers()`。
5. **B 口是 A 口的镜像**（1B 跟随 1A）：`mirrorBPortsIn()` 在所有组播变更末尾执行；B 口组播只读；
   IP 路由视图不画挂在 B 口上的线；追踪器不把 B 口当流源/出口。
6. **信号连线**（`kind:"signal"` + `stream`）：只在 IP 路由视图渲染；建立时自动写目标口 `multicast_in`；
   删线只删接收侧，源口输出不动；1口1线顶替规则不作用于信号连线。
7. **追踪规则**：下一跳 = from 侧物理连线 或承载该流的信号连线；不倒走 to 侧光纤；断路段不渲染；
   镜像 B 口跳过；转发设备（`FORWARDERS`：Net-Switch / Ni / OTN）不作为流源。
8. **模型只有一处**：本文件 + `docs/schema.md`，改模型必须两边同步；`normalizeDoc()` 是唯一入口，
   导入旧 JSON 时由它补齐缺省字段、丢弃坏引用。
9. **撤销/重做**：破坏性操作前 `snapshot()`（并在写入**之前**调用），栈深 30；坐标在快照里，
   但视图相机不在。换图（`openDoc`）清空两栈。
10. **双击端口用 pointerdown 时间戳判定**，不要依赖原生 dblclick：画布每次点击都会重绘，
    元素被替换后浏览器不再派发 dblclick。
11. **关系图视图坐标现算**：`relationLayout()` 按信号流向分层，结果只用于渲染，**绝不写回
    `layout.nodes`**。所以切到关系图再切回来，手拖的位置原样保留；关系图里也不允许拖拽/连线。

## UI 约定

- 深色单主题（无浅色切换）；全部图标用 Unicode 字符，不引外部字体/图标库
- 设计令牌集中在 `:root`（表面/描边/文字/语义色/圆角/三级阴影），改配色只动这一处
- 画布卡片：竖向渐变 `url(#cardGrad)` + 类型色描边 + 右上角类型徽标 + 投影（选中换 `selGlow`）；
  名称左对齐、`入 N · 出 N` 淡化居中（卡片高 ≥76 才画）
- 流面板是**右侧停靠栏**（`#flowPanel`，非浮层）：`#stage` 横向 flex，`#canvasWrap` 自适应，
  面板显隐会改变画布宽度——切视图必须走 `applyViewMode()`（先渲染侧栏再 fit），否则 fit 用的是旧宽度
- 浮动缩放条 `#zoomCtl` 在画布左下；`fitView` 内容是居中的
- 端口布局：`direction:"in"` 画在左侧、`"out"` 画在右侧；IP 口天然双向（`bidirectional:true`）
- 提示统一用 `toast()`；破坏性操作统一 `confirmDialog()`
- 路由视图右侧流面板：点流可只看该流，再点「全部」恢复
- 顶栏顺序：撤销 / 重做 / 适应画布 / 整理布局 / 设备模板 / 图库 / 导入 / 导出 / ＋设备 / 保存

## 本机踩坑（都踩过）

- **`file://` 也能用 localStorage**，但每个文件路径是独立来源；换目录打开会看不到旧数据。
- **无头 Chrome 会缓存 `file://` 页面**：跑自检脚本必须 `Network.setCacheDisabled(true)`，
  否则改了代码仍在测旧版本（曾因此误判"改了没效果"）。
- **CDP 截图/自动化**：Chrome 必须用 `run_in_background` 方式常驻；前台 `&` 启动的进程在 shell 退出后会被回收，
  随后 Node 连调试端口得到 `ECONNREFUSED`。
- **SVG 字符串注入**：设备名、组播名、流名全部 `esc()`；数字先 `Number()`/`clamp`；颜色只来自常量表。
- **`innerHTML` 整体替换**的副作用：焦点丢失、原生 click/dblclick 不可靠 → 命中判定一律放在 `pointerup` 里，
  用 `document.elementFromPoint` + `closest('[data-...]')` 反查。
- **连线中点可能被设备卡片盖住**（SVG 无 z-index，节点后画）：点击热区是整条 path（`stroke-width:14` 的透明 path），
  自检脚本要在路径上采样找可命中点，不要只取中点。
- **端口方向决定画在哪一侧**：Net-Switch 模板 1~8 口在左、9~16 口在右（全部双向）。
  若全设成 `out`，所有端口会挤在右侧、连线绕卡片而过。
- **缩放必须写 `viewBox`**（2026-10-23 实际踩过）：只改 `cam` 数字但忘了
  `svg.setAttribute('viewBox', ...)`，会出现"缩放按钮有反应、画面不动，但拖拽位移按 zoom 折算"
  的假缩放（拖起来跟手不一致）。自检里有一条专门断言缩放后 viewBox 真的变了。

## 当前状态与已知限制

已完成（2026-10-23 单文件重构，端到端自检 33 项全绿）：
双视图、设备增删改、端口与组播编辑、信号连线与流追踪、B 口镜像、撤销重做、图库/自动保存/导入导出、
适应画布、整理布局、深色 UI、示例图。

已知限制（按优先级）：
- **无多人协作**：数据只在本机浏览器，靠导出/导入交换。
- **无鉴权/加密**：文件谁拿到谁能看，敏感机房拓扑请自行控制文件流转。
- **大图性能**：全量重绘在数百设备时会开始掉帧（当前目标规模 24~50 台，未优化）。
- **导入不合并**：导入是整图替换，不支持把另一张图合并进来。
- **无浅色主题**、无打印/导出图片。
- **流标签可能重叠**：多条流并行时标签会挤在一起（可点单条流隔离查看）。

## 改动后的自检

```bash
# 1. 语法
python -c "import re;h=open('sysflow.html',encoding='utf-8').read();open('.tmp_check.js','w',encoding='utf-8').write(re.search(r'<script>(.*?)</script>',h,re.S).group(1))"
node --check .tmp_check.js

# 2. 端到端（先按 README 起无头 Chrome，端口 9224）
node tools/e2e.cjs 9224 .tmp
```

`tools/e2e.cjs` 覆盖：启动无报错、示例建图、流追踪路径、双视图段数、撤销重做、连线校验与 1口1线顶替、
组播派生与孤儿清理、schema 字段、设备编辑/组播弹窗、图库保存与刷新恢复、真实鼠标拖拽/拖线/双击/滚轮/平移/点线删除。
全部通过退出码 0，截图与 `report.json` 落在输出目录。
