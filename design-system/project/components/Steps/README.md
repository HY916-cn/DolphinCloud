# Steps

步骤条：办理业务时告诉学生“现在在第几步、还剩几步”。

- `<ol class="dc-steps">` 内每步 `<li class="dc-step">`，圆点 `dc-step-dot` 写数字。
- 已完成 `is-done`：`dolphin` 实心圆 + ✓，连线变蓝；当前 `is-current`（并加 `aria-current="step"`）：更大的 `cloud-100` 圆 + `dolphin-deep` 描边；未到的步骤：白底 `line-strong` 描边。
- 步骤名 2～4 个字，最多 4 步。

使用者提供：步骤名称列表和当前步序号。存款、取款、兑换统一用“选择业务 → 输入金额 → 核对信息 → 完成”。

多端：在 `AppShell` 里的手机宽度下，步骤条变为一条 8px 高的分段进度条（已完成和当前段为 `dolphin`），并显示紧跟其后的 `<p class="dc-steps-caption">第 2 步，共 4 步：录入面额</p>`；平板和电脑显示圆点和步骤名，说明文字自动隐藏。
