# Checkbox

复选框：在一组选项里勾选任意多项。

- 结构：`<label class="dc-check"><input type="checkbox"><span class="dc-check-box"></span><span>名称<small>说明</small></span></label>`；一组放在 `<fieldset class="dc-check-group"><legend>组名</legend>…</fieldset>` 里。
- 28px 方框，`radius-xs` 圆角，和圆形的 `Radio` 一眼区分；勾选后填满 `dolphin`，白色对勾轻微弹出。
- 文字和方框整行可点；禁用时方框变 `cloud-200`，说明里写原因。

使用者提供：组名、选项（名称 + 可选说明）、勾选状态。只有一项“同意 / 不同意”时也用复选框；立即生效的开关用 `Switch`。
