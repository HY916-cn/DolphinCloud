# Badge

角标：提示有新消息或待处理的事项。

- 数字角标：在 `dc-icon-btn` 里放 `<span class="dc-badge">3</span>`，`danger` 底、`on-danger` 白字、外圈白边，贴在按钮右上角；超过 99 写“99+”。
- 圆点角标：`dc-badge is-dot`，只表示“有新内容”，不写数字。
- 列表和标签页里的数量用 `Tabs` 的 `dc-count`，不用红色角标。

使用者提供：数量。按钮的 `aria-label` 要包含数量（“消息，3 条未读”）；数量为 0 时不显示角标。

动效：出现时轻轻弹出（320ms）；数字变化时加 `dc-bump`。
