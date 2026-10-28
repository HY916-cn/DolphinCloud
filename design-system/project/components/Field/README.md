# Field

输入框：大字号、粗边框，一次只填一项。

- `<label class="dc-field">`：`dc-field-label`（图标 + 字段名，“存款金额”）、`dc-input-wrap`（64px 高，含 `dc-input` 和单位 `dc-input-unit`）、`dc-field-hint`。
- 金额输入用 `inputmode="numeric"`，数字 24px 加粗、等宽；单位 HTB 写在框内右侧。
- 聚焦：边框变 `dolphin-deep` 并出现 `focus-ring`。
- 出错加 `is-error`：边框和提示变 `danger`，提示前放 `warning` 图标，先说原因、再说怎么改（“超出可用余额 1,280 HTB，请重新输入”），不说“输入非法”“格式错误”。

使用者提供：字段名、单位、提示文字、校验结果。字段名用规范业务用语（存款金额、取款金额、兑换数量），不加冒号。

动效：聚焦时描边和焦点环过渡（160ms）；加 `is-error` 时输入框左右轻摆一次，提示文字淡入（240ms）。
