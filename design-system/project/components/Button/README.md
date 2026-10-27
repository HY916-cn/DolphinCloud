# Button

按钮是学生“办一件事”的地方：大、圆、有按下去的手感。

- `dc-btn dc-btn-primary`：每屏最多一个，用于这一页最重要的动作（“确认存款”）。厚底阴影 `shadow-button`，按下时下沉 3px。
- `dc-btn dc-btn-secondary`：次要动作（“查询余额”“帮助”），白底 + `line-strong` 描边。
- `dc-btn dc-btn-ghost`：返回、取消这类轻动作。
- `dc-btn-sm`：弹层、引导气泡里的按钮，高 44px，仍是合格的触控尺寸。
- 默认高 56px，文字用 `body-lg`；图标放在文字前，写成内联 `<svg class="dc-icon" stroke="currentColor">`（26px），颜色跟随按钮文字，主按钮上即为 `on-dolphin`。

使用者提供：按钮文字（2～5 个字，用规范业务用语：“存款”“确认存款”“知道了”，不写“提交”“确定操作”这类含糊的词）、可选的图标、`disabled` 状态。禁用时把原因写在按钮上（“余额不足”），不要只变灰。
