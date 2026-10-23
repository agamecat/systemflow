# 贡献指南

感谢愿意花时间改进 SysFlow。这是一个**零依赖的单文件前端项目**：所有代码都在 `sysflow.html` 里，
没有构建、没有后端、没有第三方库。改动前请先读一遍 [`AGENTS.md`](AGENTS.md)，尤其是「数据不变式」一节。

## 报告问题（Issue）

1. 先搜一下 [现有 Issue](https://github.com/agamecat/systemflow/issues)，避免重复。
2. 新建 Issue 时请写清：
   - **环境**：浏览器与版本（Chrome / Edge / Firefox / Safari）、操作系统
   - **复现步骤**：从打开页面开始，一步一步到出问题的地方
   - **期望结果 / 实际结果**
   - **证据**：截图，或按 `F12` 后 Console 里的报错文本
3. **请勿提交真实机房数据**：设备名、组播地址、内网 IP 属于敏感信息，贴图或导出 JSON 前请脱敏，
   或改用仓库里的示例数据复现。

## 提交代码（Pull Request）

```bash
# 1. Fork 后克隆自己的仓库
git clone https://github.com/<your-name>/systemflow.git
cd systemflow

# 2. 从 main 切一个语义化分支
git checkout -b fix/multicast-rename
#    分支前缀：feat/ 新功能 · fix/ 缺陷 · docs/ 文档 · style/ 样式 · refactor/ 重构

# 3. 改完先自检（见下），再提交
git commit -m "fix: 端口改址后接收组播未跟随"
git push origin fix/multicast-rename
```

然后在 GitHub 上对 `main` 发起 Pull Request，描述里写清：

- 这个 PR 解决什么问题（关联 Issue 号，如 `Closes #12`）
- 改了什么、为什么这么改
- 自检结果（`33/33 通过` 这类）
- 涉及界面的改动，附上前后对比截图

请保持 PR **小而专注**：一个 PR 只做一件事，避免顺手重构无关代码。

## 代码风格

- **零依赖是硬约束**：不引入框架、构建工具、npm 包；图标用 Unicode 字符，不引外部字体/图库。
- **单文件**：HTML / CSS / JS 都写在 `sysflow.html` 内，按文件里的小节注释分段（常量 / 存储 / 派生 /
  写操作 / 几何 / 渲染 / 事件 / 弹窗）。
- **ES5 风格**：用 `function` 与 `var`，不用 class、箭头函数、可选链，保持老浏览器也能开。
- **2 空格缩进**，语句结尾带分号；注释写中文，解释「为什么」而不是「做了什么」。
- **所有进入 SVG / HTML 的字符串必须过 `esc()`**；数字先 `Number()` 或 `clamp()`；颜色只来自常量表。
- **破坏性操作先 `snapshot()`**，且必须在写入之前调用，否则撤销会失效。
- 不要破坏 `AGENTS.md` 里的 10 条数据不变式（本体/视图分离、接收组播派生、B 口镜像、信号连线语义……）。

## 自检

改完 `sysflow.html` 后请跑一遍语法检查与端到端自检，全绿再提 PR：

```bash
# 语法
python -c "import re;h=open('sysflow.html',encoding='utf-8').read();open('.tmp_check.js','w',encoding='utf-8').write(re.search(r'<script>(.*?)</script>',h,re.S).group(1))"
node --check .tmp_check.js

# 端到端（先起一个带调试端口的 Chrome，再跑脚本）
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new --disable-gpu --remote-debugging-port=9224 \
  --user-data-dir="$PWD/.tmp/profile" --window-size=1600,1000 \
  "file:///$PWD/sysflow.html" &
node tools/e2e.cjs 9224 .tmp
```

自检覆盖 33 项：示例建图、流追踪、三种视图、撤销重做、连线规则、组播派生与孤儿清理、
导入导出、以及真实鼠标的拖拽 / 拖线 / 双击 / 滚轮 / 平移 / 点线删除。全部通过时退出码为 0。

## 提交信息

采用 Conventional Commits 前缀：

```
feat: 新增关系图视图
fix: 修正只含信号连线的图在光纤视图下的误导
docs: 补充贡献指南
style: 调整卡片投影与配色
refactor: 抽出 applyViewMode
chore: 更新 .gitignore
```

第一行控制在 50 字以内；需要解释的细节写在空行之后的正文里。

## 许可

本项目采用 [MIT License](LICENSE)。提交 Pull Request 即表示你同意自己的贡献以同一许可发布。
