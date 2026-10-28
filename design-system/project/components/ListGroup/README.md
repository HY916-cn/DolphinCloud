# ListGroup

列表组：把设置项、账户入口按主题分组排列。

- 结构：组标题 `<p class="dc-list-title">通知</p>`，下面 `<ul class="dc-list">`，每行一个 `<li>`。行内可以放 `Switch`、`Select`、`Segmented`，或跳转链接 `<a class="dc-list-link"><span class="dc-list-icon">图标</span><span>名称</span>右箭头</a>`。
- 白底、`line` 描边、`radius-lg`，行间用 `line` 分隔；链接整行可点，至少 48px 高。
- 危险动作（退出登录）加 `is-danger`：文字和图标 `danger`，图标底 `danger-soft`，放在组的最后，点击后用 `Sheet` 确认。

使用者提供：分组标题、各行内容。每组不超过 6 行。
