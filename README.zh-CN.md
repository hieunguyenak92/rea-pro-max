# REA Pro Max

**理解机制。重建行为。验证结果。**

面向 Claude Code 和 Codex 的独立逆向工程技能与可执行工具集。将陌生的应用、扩展程序或 Web 功能，转化为可以解释的机制、可以运行的实现，以及可以核验的有限行为契约。

[English](README.md) · [Tiếng Việt](README.vi.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [简体中文](README.zh-CN.md) · [ไทย](README.th.md) · [Français](README.fr.md)

[探索已记录的实验](https://hieunguyenak92.github.io/rea-pro-max/#explorer) · [安装技能](docs/INSTALL.md) · [验证记录](docs/VALIDATION.md) · [发行版本](https://github.com/hieunguyenak92/rea-pro-max/releases)

![REA Pro Max — Understand the mechanism](docs/media/hero.png)

## 一个像样的界面，只是起点

真正困难的是点击之后发生了什么：哪个上下文接收消息，状态保存在哪里，取消操作究竟中断什么，调用方会收到哪种错误，以及为什么重建的功能到了第二次使用就出问题。

REA Pro Max 把这些问题带入实现过程。分析已分发的 JavaScript，明确相互竞争的解释，选择能区分它们的实验。在你的项目中实现所需行为，比较实际输出、状态变化和事件。发现不一致后，将它缩减为仍能复现同类故障的操作序列。

**交付物是你要求的、能够运行的功能，并附带证据。** 宿主智能体负责代码开发和运行时操作；内置工具提供可执行的分析、实验排序、行为验证与故障缩减机制。

## 直接交付任务，无需先学一套新流程

[安装](docs/INSTALL.md)后，在 Claude Code 中自然地提出需求：

```text
/rea-pro-max 调查这个扩展的保存与恢复机制，并在我的项目中实现。追踪 popup、content script、worker 和 storage 的边界。在确认 worker 确实重新启动的条件下检查持久性，保留错误行为，并交付可运行代码、实际检查过的用例与尚未验证的部分。
```

在 Codex 中选择该技能，或在同样的任务前加上 `$rea-pro-max`。提供目标和接收代码的项目，智能体会编写内部 case 文件。观察真实浏览器、应用或设备，需要宿主具备对应工具。

- **重建指定功能：** 涵盖顺序、错误、取消和持久化边界。
- **理解 MV3 扩展：** 区分 popup、content、page 与 worker 上下文。
- **恢复 Electron 边界：** 分析已提取的 main、preload、renderer 源码。
- **解释两个构建之间的回归：** 对照可比较的输入和可观察效果。
- **缩减可复现故障：** 减少操作步骤，同时保留故障身份。

## 相信承诺之前，先运行它的机制

需要 **Node.js 22+**。内置工具可直接运行，无需 API 密钥、`npm install` 或原版 REA 服务器。

```sh
git clone https://github.com/hieunguyenak92/rea-pro-max.git rea-pro-max
cd rea-pro-max
node skills/rea-pro-max/scripts/rea-pro-max.mjs demo --out ./rpm-lab
```

在浏览器中打开 `rpm-lab/report.html`。项目自有的合成实验，在**使用模拟 Chrome API 的受控 JavaScript 模型**中执行参考 worker 和回归 worker。分析、实验排序、不一致检测和操作缩减均为内核的实际输出。这并不能证明真实 Chromium worker 的暂停行为。独立完成的运行时检查会记录在[验证记录](docs/VALIDATION.md)中。

也可以自行分析附带的产物：

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs inspect ./rpm-lab/fixtures/mv3/reference --out inspection.json
node skills/rea-pro-max/scripts/rea-pro-max.mjs report inspection.json --out inspection.html
node skills/rea-pro-max/scripts/rea-pro-max.mjs prompts --target mv3
```

请使用新的输出路径：工具不会静默覆盖已有结果。宿主设置和更多命令见英文[安装与 CLI 指南](docs/INSTALL.md)。

## 专业能力，应当体现为可检查的机制

| 能力 | 为调查增加的价值 |
| --- | --- |
| 产物边界分析 | Acorn AST 解析、独立执行上下文、候选通信边、精确源码位置和内容摘要。`inspect` 不执行目标代码。 |
| 竞争性解释 | 明确假设、预测与重置感知的探测步骤，避免仅因第一个解释听起来合理就下结论。 |
| 保守的实验排序 | 按声明成本计算最坏情况下可排除的假设数，再按能力、允许的效果和预算筛选。缺失预测始终保持未知。 |
| 绑定观察证据 | 通过目标、场景、重置和工具链身份，将不兼容的观察排除在当前推断之外。哈希标识内容，不证明运行事实。 |
| 有限行为验证 | 对输出、状态、效果和轨迹给出 `pass`、`fail`、`unknown`，保留重复事件与有意义的顺序。 |
| 故障序列缩减 | 在预算内删除操作，重复检查 oracle，并保持稳定的故障指纹。不承诺全局最短序列。 |
| 本地工作台 | 独立 HTML，提供真实搜索、上下文筛选、证据选择和完整 JSON 导出；无需后端或 CDN。 |
| 36 个任务提示词 | 覆盖 Web、扩展、桌面和移动端家族，并明确前提条件。有模板不等于已验证对应 provider。 |

规划器选择下一步该问什么，不会自行执行探测。验证器比较提供的观察，不会独立认证运行时确实执行过。技能会指导宿主智能体完成这些实际操作并保留证据。

## 边界清楚，结果才有明确含义

**v0.1 内置分析：** JavaScript 文件，以及已提取的 Web、Manifest V3、Electron 源码。动态表达式、不支持的语法、缺失 import 和资源限制会明确出现在结果中。

**与 provider 无关的内核：** case 管理、实验排序、有限行为比较、序列缩减和本地报告。`shrink` 会明确执行你提供并控制的 `.mjs` oracle 模块。

**通过宿主工具开展的高级工作流：** 提示词库包含 native、managed、Android、Apple、React Native、Flutter、Tauri 和 WebAssembly 任务。深度分析取决于实际可用且适合目标的工具。本版本没有内置通用反编译器、移动运行时、万能包提取器或语义恢复引擎。格式检测或任务模板不等于经过验证的集成。

CLI 不发起网络请求，也不上传遥测数据。AI 宿主和外部工具遵循各自的数据政策。报告可能包含敏感路径、代码和观察值。分享前请阅读英文[隐私与执行边界](docs/PRIVACY.md)。

## 最终留下什么

重建任务应交付可运行源码及启动方式、选定的行为契约、实际执行的操作、JSON 证据和剩余限制。有限的 `pass` 仅适用于检查过的用例，不代表整个应用等价。

实验导出 `inspection.json`、`case.json`、`planner.json`、`reference.json`、`candidate.json`、`verification.json`、`reduction.json`、`lab.json` 和独立的 `report.html`。你可以单独检查记录，随项目保存，并在工作台中导出完整 JSON。

英文技术资料：[技能说明](skills/rea-pro-max/SKILL.md) · [目标范围](skills/rea-pro-max/references/target-analysis.md) · [Case 格式](skills/rea-pro-max/references/case-format.md) · [验证契约](skills/rea-pro-max/references/verification.md) · [任务提示词](skills/rea-pro-max/references/prompt-library.md)。

REA Pro Max 为独立开发项目。研究灵感和依赖声明见[致谢](THIRD_PARTY_NOTICES.md)；原版 REA 不是必需依赖。[MIT 许可证](LICENSE)。

**带来一个值得理解的功能，带走一个可以核验的结果。**
