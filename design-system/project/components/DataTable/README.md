# DataTable

数字表格：第一列是文字，其余数字右对齐，用来核对图表背后的每个数。

- 结构：`<div class="dc-table-scroll"><table class="dc-table" aria-label>`；`thead` 表头，`tbody` 数据，可选的 `tfoot` 合计（加粗、无下边线）。
- 数字单元格和它的表头加 `n`，右对齐；等宽数字由表格统一设置。千分位，负数写 `−`，空值写 `—`。
- 列多时只有 `dc-table-scroll` 横向滚动，页面不滚动；单元格不折行。

使用者提供：表格名称（`aria-label`）、表头、行、可选的合计。

动效：无。
