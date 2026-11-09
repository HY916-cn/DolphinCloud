# BatchBar

批量管理：列表进入“选择”后，每行前出现复选框，底部的操作条对选中的行一起操作。

- 每行 `<div class="dc-batch-row">`：`<label class="dc-check dc-batch-pick">`（名称写在 `dc-sr-only` 里）加原来的 `dc-list-link`。
- 操作条 `<div class="dc-batch-bar" role="toolbar" aria-label="批量操作">`：左边 `dc-check` 全选和“已选 3 个”，右边 `dc-batch-actions` 放 `dc-btn-secondary dc-btn-sm`。
- 操作条 sticky 贴底，手机上在 `TabBar` 上方，按钮过多时横向滑动。
- 会影响多人的操作先经 `Sheet` 确认，结果说清多少个办成、哪些没办成以及原因。

使用者提供：已选数量、总数、全选回调、操作按钮。

动效：无。
