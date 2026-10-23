# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)，
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

## [1.0.0] - 2026-10-23

首个公开版本。

### 新增

- **单文件应用** `sysflow.html`：HTML + CSS + JS 全内联，零依赖、离线可用、双击即开
- **三种视图**：光纤连接（物理连线）/ IP 路由（按组播追踪）/ 关系图（自动分层总览，只读）
- **设备与端口编辑**：增删改设备、端口类型与方向、节目名、设备内部直通
- **组播配置**：双击 IP 端口配置收发；接收侧由信号连线自动派生；B 口镜像同号 A 口
- **信号流追踪**：沿物理链路与转发设备逐跳推导，断点位置直接标出
- **工程能力**：撤销 / 重做、图库与自动保存、JSON 导入导出、旧版 SQLite 一键转换
- **示例数据**：`data/sample-system-diagram.json`（合成 Mock）与 `tools/make-mock-data.py`

### 变更

- 由 Vue3 + VueFlow + FastAPI 双端实现迁移为单文件零依赖实现，旧代码不再随仓库分发

### 安全

- 公开仓库只保留脱敏后的合成示例数据，不含真实机房拓扑
- 启用 GitHub 的 secret scanning 与 push protection
