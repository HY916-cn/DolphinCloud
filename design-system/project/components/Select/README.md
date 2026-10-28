# Select

下拉选择：选项较多（超过 6 个）或页面空间有限时使用，例如学期、班级、排名范围。

- 结构：放在 `Field` 里：`<label class="dc-field"><span class="dc-field-label">图标名称</span><span class="dc-select"><select>…</select></span></label>`。
- 使用原生 `<select>`：手机和平板上弹出系统自带的选择器，大而好点；电脑上是下拉列表。56px 高、`line-strong` 描边、右侧 `dolphin-deep` 下箭头。
- 聚焦时描边变 `dolphin-deep` 并出现 `focus-ring`；禁用时底色 `cloud-100`。

使用者提供：字段名、选项、当前值。选项文字简短（不超过 8 个字），按自然顺序排列（时间从近到远、班级从小到大）。
