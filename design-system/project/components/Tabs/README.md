# Tabs

标签页：把同一页的内容按类别分开，例如交易明细的“全部 / 存入 / 支出 / 奖励”。

- 结构：`<div class="dc-tabs" role="tablist">`，每项 `<button class="dc-tabs-item" role="tab" aria-selected="true|false">名称<span class="dc-count">12</span></button>`。
- 选中项文字 `dolphin-deep`，下方 4px 圆头指示条；可选的数量 `dc-count` 用 `cloud-100` 胶囊。
- 动效：指示条从旧标签滑到新标签并改变长度（240ms，`--ease-out`）。标签宽度不同，需要下面这段脚本测量位置；没有脚本时，指示条在新标签下从中间展开（160ms）。

```js
document.querySelectorAll('.dc-tabs').forEach((tabs) => {
  const ink = () => {
    const tab = tabs.querySelector('[aria-selected=true]');
    if (!tab) return;
    const pad = parseFloat(getComputedStyle(tab).paddingLeft);
    tabs.style.setProperty('--ink-x', tab.offsetLeft + pad + 'px');
    tabs.style.setProperty('--ink-s', (tab.offsetWidth - 2 * pad) / 100); // 指示条基准宽 100px，用 scaleX 伸缩
  };
  tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('[role=tab]');
    if (!tab) return;
    tabs.querySelectorAll('[role=tab]').forEach((t) => t.setAttribute('aria-selected', t === tab));
    ink();
  });
  ink();
  tabs.classList.add('has-ink');
  new ResizeObserver(ink).observe(tabs);
});
```
- 标签放不下时可横向滑动；手机上字号缩到 16px，四个标签能完整放下。

使用者提供：标签名称（2～3 个字）、可选的数量、当前项，以及每个标签对应的 `tabpanel`。标签不超过 5 个。
