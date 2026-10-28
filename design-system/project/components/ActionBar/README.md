# ActionBar

页面操作栏：放一页最后的一到两个动作，保证手机上的主按钮整行、贴底、拇指够得到。

- 结构：`<div class="dc-actions">`，内放次按钮在前、主按钮在后：`<button class="dc-btn dc-btn-secondary">上一步</button><button class="dc-btn dc-btn-primary">确认存款</button>`。
- 手机：贴在屏幕底部（白底、上方圆角、`shadow-float`），按钮整行、上下堆叠，主按钮在上；内容短时也停在屏幕底部。
- 平板：跟在内容后面，按钮一行等分整行，主按钮在右。
- 电脑：按钮靠右，每个最小 160px，主按钮在最右。
- 放在 `dc-content` 的最后（可在 `dc-form` 里），不要放进卡片；卡片和弹层里的按钮用 `Sheet` 或 `dc-btn-sm`。

使用者提供：一到两个按钮。只有一个动作时只放主按钮；不放三个及以上按钮，其余动作改为页面里的链接或 `dc-btn-ghost`。
