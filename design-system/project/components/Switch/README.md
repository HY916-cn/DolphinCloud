# Switch

开关：一项设置的开启与关闭，切换后立即生效。

- 结构：`<label class="dc-switch"><span class="dc-switch-text"><b>名称</b><small>说明</small></span><input type="checkbox" role="switch"><span class="dc-switch-track"></span></label>`，整行都可以点。
- 关闭：`line-strong` 轨道、圆钮在左；开启：`dolphin` 轨道、圆钮滑到右侧（160ms，`--ease-out`）。开关状态同时由颜色和圆钮位置表示。
- 禁用：轨道变 `cloud-200`，文字变 `ink-muted`，说明里写由谁控制（“由指导老师统一设置”）。

使用者提供：名称、一句说明、开关状态。只用于立即生效的设置；需要“保存”才生效的选项用 `Checkbox`。切换后可用 `Toast` 提示“设置已保存”。
