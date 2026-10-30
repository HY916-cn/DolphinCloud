# Result

办理结果：用大字告诉学生和柜员“办成了什么、钱到了哪里”。

- 结构：`<section class="dc-result">`，内放 `dc-result-badge`（`success` 图标）、`<h1 class="display">存款成功</h1>`、`dc-result-lead`（“存入 15 HTB，当前余额 43 HTB”），以及放办理明细的 `dc-card` + `SummaryList`。
- 没办成时加 `is-danger`，徽章换成 `warning` 图标和 `danger` 配色，标题写发生了什么（“余额不足”）。
- 动效：徽章 `dc-pop` 轻微回弹；余额用 `data-from` 和 `data-count` 从原余额滚动到新余额。
- 后面紧跟 `ActionBar`（“返回首页”“继续办理”），平板和电脑上与结果同宽，按钮整组居中，与徽章同一条中线。

使用者提供：结果标题、金额与余额、办理明细（学生、面额、经办柜员、时间、交易号）。
