# AppShell

多端外壳：同一份页面结构在手机、平板、电脑上自动换成底部导航、图标导航栏或完整侧边导航。

- 结构：`<body class="dc-app">` → `<div class="dc-shell">`，里面依次放 `<aside class="dc-nav">`（`dc-nav-inner` 内放 `dc-nav-brand` 和若干 `<a class="dc-nav-item">`）、`<div class="dc-main">`（`<header class="dc-top">` + `<main class="dc-content">`）、手机用的 `<nav class="dc-tabbar">`。
- 断点用容器查询判断 `.dc-app` 的宽度：手机 <600px 只显示 `TabBar`；平板显示 104px 图标导航栏；电脑显示 248px 侧边导航（标志 + 图标 + 文字）。
- `dc-top`：页面标题行，左侧可放返回按钮 `dc-icon-btn`，标题用 `title` 加 `dc-top-title`，副标题 `dc-top-sub`。
- `dc-content`：内容区，最宽 `content-max` 并居中，子元素纵向排列，间距随屏幕变大。
- `dc-split`：电脑上两栏 7 : 5，手机和平板单列；右栏加 `is-sticky` 后随页面滚动保持可见。`dc-stack` 是纵向排列的一组内容；`dc-card` 是白底卡片；`dc-section-head` 是分区标题 + 右侧轻操作。

使用者提供：导航项（图标 + 2 个字）、当前页（`aria-current="page"`）、页面内容。导航项在 `TabBar` 和 `dc-nav` 里保持同样的顺序和名称；`dc-nav` 最多 20 项，比窗口高时导航自己上下滚动，`TabBar` 最多 5 项（入口多于 5 项时放前 4 项和“我的”），其余入口在手机上从页头的“全部功能”打开；办理流程页（存款、取款、兑换）在手机上不显示 `TabBar`，只保留返回按钮和操作栏。

动效：侧边导航和图标导航的选中底块上下滑动（240ms，纯 CSS，各项等高）；进入新页面时内容区加 `dc-page-forward`，返回加 `dc-page-back`，导航栏不动。

## 全部功能

手机上入口多于 5 项、`TabBar` 放不下时（财务、行长、银行管理员），每个页面的页头 `dc-top` 最右边放一个九宫格按钮，点开列出这个身份的全部入口。入口不超过 5 项的身份（学生、柜员、库管、运维员）底部栏已经放下全部入口，不显示这个按钮。平板和电脑有侧边导航，也不显示。

- 按钮：`<button class="dc-icon-btn dc-apps-btn" aria-label="全部功能" aria-haspopup="dialog">`，图标 `apps`（Lucide `grip`）。放在页头最后，排在页面自己的按钮后面；办理流程页（有返回按钮、不显示 `TabBar` 的页）不放。宽度 600px 起 `dc-apps-btn` 自动隐藏。
- 弹层：`Sheet` 加 `is-apps`，从底部升起。标题行 `dc-section-head`：左边标题“全部功能”，右边 `dc-icon-btn`“关闭”（图标 `close`）。下面 `dc-tiles`（`ServiceTile` 的紧凑尺寸：图标块 44px、名称 16px），一行 4 格，顺序和侧边导航相同，从“总览”到“我的”，类别色同侧边导航（商品 `dc-kind-exchange`、贷款 `dc-kind-withdraw`）。不放底部按钮；高过屏幕时在弹层里滚动（同 `Sheet`）。
- 当前页那一格加 `aria-current="page"`：描边 `dolphin`、`cloud-100` 底、名称 `dolphin-deep`。
- 点一格跳到那一页，弹层随之关闭；点当前页那一格只关闭弹层。
- 焦点：打开后落在当前页那一格（没有就第一格），Tab 和 Shift+Tab 在弹层内循环，按 Esc、点遮罩或右上角“关闭”都关上，焦点回到九宫格按钮。
- 总览页不再放入口宫格：手机上从“全部功能”打开，平板和电脑用侧边导航。

动效同 `Sheet`；减少动态效果时直接出现和消失。
