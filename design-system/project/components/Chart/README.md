# Chart

单系列图表：柱状图、折线和横条，一张图只回答一个问题。

- 容器：多张图放进 `dc-charts`，自动并排；每张是 `<figure class="dc-chart">`，`<figcaption>` 写系列名，`<small>` 写合计或期末。
- 柱状图：`dc-chart-plot` 里放 `dc-chart-grid`（顶、半、零三条刻度）和 `dc-chart-cols`，每根是 `<span class="dc-chart-col" data-tip style="--v:0.5"><i></i></span>`；下面是 `dc-chart-axis`，最多 7 个标签。
- 折线：在 `dc-chart-cols` 上再加 `dc-chart-line`，放一个 `preserveAspectRatio="none"` 的 `<svg>`（`polygon` 面积、`polyline` 线），最后一个 `dc-chart-col` 加 `is-end` 显示终点。
- 横条：`<dl class="dc-chart-bars">`，每项 `<div><dt>名称</dt><dd><i style="--v:0.5"></i><b>数值</b><small>占比</small></dd></div>`，从长到短排。
- 颜色：在 `dc-chart` 上加该业务的 `dc-kind-*`，不加时是海豚蓝。

使用者提供：系列名、数据、单位。`--v` 是相对刻度顶的比例（0～1），刻度顶取整到 1、2、5 乘以 10 的幂。`dc-chart-cols` 要有 `role="img"` 和写出全部数据的 `aria-label`，同样的数字还要放进 `DataTable`。

动效：无。悬停时显示数值，触屏和读屏靠表格。
