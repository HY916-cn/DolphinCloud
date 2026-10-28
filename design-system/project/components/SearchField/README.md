# SearchField

搜索框：按名称、金额或学号查找交易和学生。

- 结构：`<label class="dc-search">搜索图标<input type="search" aria-label="…" placeholder="…"><button class="dc-search-clear" aria-label="清除">关闭图标</button></label>`。
- 胶囊形，52px 高，`line-strong` 描边；聚焦时描边变 `dolphin-deep` 并出现 `focus-ring`。有内容时才显示清除按钮。

使用者提供：占位文字（写清能搜什么：“搜索交易名称或金额”）、搜索结果。输入时即时筛选，没有结果时显示 `EmptyState`。

动效：聚焦时描边和焦点环过渡（160ms）；清除按钮出现时轻轻弹出。
