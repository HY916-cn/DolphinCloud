# Progress

进度条：显示储蓄目标、任务完成等进度。

- 结构：`<div class="dc-progress">`：`dc-progress-head`（名称 + `<b>780 / 1,200</b>`）、`<div class="dc-progress-track" role="progressbar" aria-valuenow aria-valuemax>`（内放 `<div class="dc-progress-fill" style="--value:.65">`）、`dc-progress-note`（下一步说明）。
- 16px 胶囊轨道 `cloud-200`，已完成部分 `dolphin`。储蓄目标、存款次数这类储蓄进度加 `dc-kind-save`：轨道 `sea-soft`、已完成部分 `sea-ink`。
- 动效：出现时从左向右增长；数值变化时平滑伸缩到新长度（320ms，只用 `transform`）。

使用者提供：名称、当前值、目标值、一句说明（还差多少、怎样达成）。进度总是配数字，不只靠长度表示。
