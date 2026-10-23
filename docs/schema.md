# 信号图数据模型 v2（规范定义）

> 本文档是信号图数据结构的**唯一定义来源**。实现只有一份：`sysflow.html`（单文件、零依赖、双击即用）。
> 文件内的模型归一化在 `normalizeDoc()`，连线校验在 `checkLink()`，派生逻辑见同名函数
> （`mirrorBPorts` / `followRenames` / `cleanOrphanReceivers` / `traceSignals`）。
> 改模型时本文档与 `sysflow.html` 必须同时修改。

## 设计原则

1. **信号图本体（SignalGraph）是唯一事实源**：描述"有什么设备、端口怎么连、跑什么信号"。
2. **画布细节不属于本体**：节点坐标、视口属于 Layout（视图层状态），分开存储。
3. **AI 友好**：本体本身就是给 LLM 看的格式，无 handle、坐标等渲染噪音；AI 修改图纸通过
   [操作协议](#操作协议-ops)（按设备名+端口号引用），不直接输出整图。
4. **引用规则**：link 用 port `id`（稳定）；用户界面与导入导出用 `name`+`number`（人类可读）。

---

## SignalGraph（存储本体）

```json
{
  "version": 2,
  "name": "机房A主系统",
  "devices": [Device, ...],
  "links": [Link, ...]
}
```

### Device（设备实例）

```json
{
  "id": "dev_a1b2c3",
  "name": "编码器1",
  "type": "Encoder-MUX",
  "ports": [Port, ...],
  "inner_links": [{ "from_port": "1", "to_port": "1" }]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 设备实例 id，图内唯一，`dev_` 前缀 + 短随机串 |
| `name` | string | 设备名，**图内必须唯一**（AI 操作按名引用）；从模板创建时默认为模板名，重名自动加序号 |
| `type` | string | 设备模板类型（见模板表），如 `SDI-Source`、`Net-Switch` |
| `ports` | Port[] | 该设备全部端口（输入输出统一列表，方向见 Port.direction） |
| `inner_links` | InnerLink[] | 设备内部直通关系（信号不做处理），**按 port number 引用** |
| `sparse_ports` | bool | - | 端口间距放大（编辑界面勾选）：输入口/输出口行距 ×5，密集连线汇聚看不清时使用。缺省 false |

### Port（端口）

```json
{
  "id": "p_x9y8z7",
  "number": "1",
  "type": "ip_port",
  "direction": "out",
  "bidirectional": true,
  "program": "云1标清SDI",
  "multicast_in": [MulticastEntry, ...],
  "multicast_out": [MulticastEntry, ...]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✓ | 端口 id，**图内全局唯一**（不只是设备内），`p_` 前缀；从模板实例化时重新生成 |
| `number` | string | ✓ | 设备面板端口号牌（展示 + inner_link/AI 引用），**同一方向内唯一**（输入侧一组、输出侧一组；Ni 等设备输入1与输出1并存合法）；允许自由文本（如 `"8-1"`、`"ets652"`） |
| `type` | enum | ✓ | `sdi_port` \| `asi_port` \| `ip_port` |
| `direction` | enum | ✓ | `in` \| `out` |
| `bidirectional` | bool | - | 双向口既可作线起点也可作落点，可同时传输多路信号。**所有 `ip_port` 天然双向**（此字段为 true），其他类型需显式标记。缺省 false |
| `program` | string | - | 该端口承载的信号/节目名（通常只有输出口有值） |
| `multicast_in` | MulticastEntry[] | - | 该端口接收的组播流（IP 口） |
| `multicast_out` | MulticastEntry[] | - | 该端口发出的组播流（IP 口） |

### MulticastEntry（组播条目）

```json
{ "address": "udp://239.1.1.16:5116", "name": "Stream 01" }
```

`address` 是流的全局唯一标识（同一地址 = 同一路流）；`name` 为节目名。
可选 `id` 字段仅作 UI key，不参与语义。

### Link（物理连线）

```json
{
  "id": "link_m4n5o6",
  "signal_type": "ip",
  "from": { "device": "dev_a1b2c3", "port": "p_x9y8z7" },
  "to":   { "device": "dev_d4e5f6", "port": "p_q1w2e3" }
}
```

| 字段 | 说明 |
|------|------|
| `id` | `link_` 前缀，全局唯一 |
| `signal_type` | `sdi` \| `asi` \| `ip`，创建时按起点端口 port_type 物化（`sdi_port`→`sdi`，类推），冗余存储避免反查 |
| `from` / `to` | 端口引用：`device`=设备 id，`port`=端口 id。from 必须是输出口或双向口，to 必须是输入口或双向口 |
| `kind` | 可选。`"signal"` = 信号连线（IP路由视图中生成，只在路由视图渲染）；缺省 = 物理连线 |
| `stream` | 信号连线必填：所承载的组播地址。语义为"源口发送该流 → 目标口接收该流" |

**信号连线**（IP路由视图交互生成）：
- 建立时目标口自动写入对应的 `multicast_in` 条目（幂等）
- 仅在 IP 路由视图作为流覆盖边渲染（颜色按地址哈希、标签为流名），不进物理画布
- 失效即删（源口不再输出该流或目标口不再接收该流时清理）
- 校验：两端必须都是 IP 端口
- 物理连线的"1口1线"顶替规则不作用于信号连线（同一对端口可承载多路不同流的信号连线）

**接收组播为派生数据**（单一事实源在发送侧）：
- `multicast_in` 由信号连线建立/删除自动写入/移除，UI 上接收侧**只读**（仅查看，不能增删改）
- 发送口修改输出地址时，流标识全局跟随：该流的信号连线 `stream` 与全图所有 `multicast_in` 条目同步改为新地址（按条目 `id` 追踪改址）
- 发送口停发（删除输出条目）时，对应信号连线与接收条目一并清理（含无信号连线的光纤入口场景）

**B 口为 A 口的镜像口**（编号 `1B/2B…` 跟随 `1A/2A…`）：
- 同号 B 口的 `multicast_in/out` 永远是 A 口的深拷贝（条目 id 重新生成），不独立配置；无同号 A 口的 B 口组播为空
- 镜像在所有组播变更路径末尾统一执行（`mirrorBPorts`，幂等）
- IP 路由视图**不渲染挂在 B 口上的连线**（信号连线与流覆盖边都只走 A 口）；光纤连接视图不受影响

**连线规则**（创建/修改时校验，集中实现在 `sysflow.html` 的 `checkLink()`）：

1. 不允许自连（同一设备的两个口相连）
2. 两端端口 `type` 必须相同
3. from 端口必须是 `direction: "out"` 或 `bidirectional`；to 端口必须是 `direction: "in"` 或 `bidirectional`
4. 1 口 1 线：一个端口作为"起点"只能有 1 条线，作为"落点"也只能有 1 条线（双向口两种角色各 1 条）——新线顶掉旧线
5. 双视图语义由 `signal_type` 推导：`ip` 链路物理上即光纤，`sdi`/`asi` 为同轴

**组播地址唯一性**（一个地址一个发送端）在**编辑路径前置校验**（端口组播对话框），排除镜像 B 口；不做整图校验——同一地址沿转发链路重复出现在多个端口是合法形态（流的源在非转发设备上，交换机/光传输的入出口都声明该流以供追踪，见 `traceSignals()` 的源/转发区分），整图校验无从区分转发与双源。

---

## Layout（画布视图状态，与本体分开存储）

```json
{
  "version": 1,
  "nodes": { "dev_a1b2c3": { "x": 100, "y": 200 } },
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

设备 id → 画布坐标。缺失坐标的设备按空位探测自动放置。坐标只由拖拽/整理布局写入，**永不进本体**。
关系图视图的坐标由 `relationLayout()` 每次渲染时按信号流向现算，不写进这里。

---

## DeviceTemplate（设备模板，devices 表）

```json
{
  "id": "3f2b...",
  "type": "Encoder-MUX",
  "name": "编码复用器",
  "description": "2路SDI输入编码复用为1路IP输出",
  "ports": [
    { "number": "1", "type": "sdi_port", "direction": "in" },
    { "number": "2", "type": "sdi_port", "direction": "in" },
    { "number": "1", "type": "ip_port", "direction": "out", "bidirectional": true }
  ],
  "inner_links": [{ "from_port": "1", "to_port": "1" }]
}
```

模板端口**没有 id**（`id` 属于设备实例，实例化时统一生成新 id）。
模板 `type` 全局唯一（保存时校验，重名直接拒绝）。种子模板 3 种：SDI-Source、Net-Switch、Monitor（其余类型由用户在「设备模板」里自建）。
模板与图库都存在浏览器 localStorage（键：`sf.templates.v1` / `sf.library.v1` / `sf.current.v1`），换电脑或清缓存前请「导出」JSON。

---

## 已移除的能力

- **AI 操作协议（ops）/ ChatPanel**：原实现依赖后端代理 LLM，单文件版无后端，已整体移除。
- **服务端存储（REST + SQLite）**：改为 localStorage + JSON 导入导出。
- **v1 → v2 迁移脚本**：仅存在于旧后端，历史提交可查；`normalizeDoc()` 仍能读入 v2 结构的任意来源 JSON。
