# EmptyState

空状态：列表或搜索没有内容时，说明原因并给出下一步。

- 结构：`<div class="dc-empty">`：`dc-empty-icon`（96px `cloud-100` 圆底 + 图标）、`<h3>` 标题、`<p>` 说明、可选的 `dc-btn-secondary dc-btn-sm`。
- 居中排列，说明最宽 22 个字，上下留白 `space-7`。

使用者提供：图标（从 Icons 组选，常用 `inbox`、`query`）、标题（直接说没有什么：“这段时间没有交易”）、说明（为什么、可以怎么做）、可选的按钮。

动效：图标轻轻弹出一次（320ms），整块可随页面 `dc-enter`。
