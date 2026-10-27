# Field

输入框：大字号、粗边框，一次只问孩子一个问题。

- `<label class="dc-field">`：`dc-field-label`（图标 + 问句，“存多少海豚币？”）、`dc-input-wrap`（64px 高，含 `dc-input` 和单位 `dc-input-unit`）、`dc-field-hint`。
- 金额输入用 `inputmode="numeric"`，数字 24px 加粗；单位 HTB 写在框内右侧。
- 聚焦：边框变 `dolphin-deep` 并出现 `focus-ring`。
- 出错加 `is-error`：边框和提示变 `danger`，提示前放 `warning` 图标，并告诉孩子怎么改（“换个小一点的数字吧”），不说“输入非法”。

使用者提供：问句、单位、提示文字、校验结果。标签用问句，不用“金额：”这类表格式写法。
