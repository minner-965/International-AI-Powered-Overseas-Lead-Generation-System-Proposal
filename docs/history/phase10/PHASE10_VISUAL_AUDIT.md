# Phase 10 UI/UX 浏览器审计

审计日期：2026-09-01
部署地址：`http://localhost:3000/?v=phase10-category-score-final-7#opportunities`

## 范围

使用实际本地部署和真实 API 数据检查：

- Opportunities
- Research Workbench
- Jobs
- Data Export
- Settings
- Companies / Company Detail
- Contact Queue

检查尺寸：1440 desktop、1280、1024、768、390×844 portrait、844×390 landscape；768 宽度同时用于约 200% zoom 等价审查。

## 数据与交互结果

- Opportunities 正确显示 14 条真实状态：12 `EVIDENCE_REQUIRED`、2 `NOT_SUITABLE`。
- 列表、筛选、待补资料卡和客户详情统一显示“商品类目评分 / Product Category Score”；评分按客户采购/经营类目与 DPV 可供货类目计算，不显示精确单品匹配或商品候选。
- Research 正确显示当前真实 job/task 汇总，自动总开关为关闭，0 verified Buyer、0 valid contact-ready。
- Contact Queue 正确显示 0，不用占位数据填充。
- Data Export 实际创建 READY job，显示 14 行、36 列 XLSX，并包含类目评分、评分等级、客户类目、DPV 可供类目和机会依据；下载按钮进入可用状态。
- Company Detail 在 desktop 为约 1200×810 内容窗口；mobile 为约 359×828，不超过 viewport。
- 详情窗口同时提供返回和关闭；四个详情 tab 可访问；底部业务动作在手机端改为纵向全宽，不再中英文重叠。
- 高级筛选弹窗可打开/关闭，关闭后焦点回到触发按钮。
- 浅色/深色与舒适/紧凑密度均检查，并恢复浅色舒适模式。

## 本轮修复

1. 修复手机导航抽屉内导航/页脚裁切，改为完整宽度和可换行布局。
2. 修复手机 Company Directory 隐藏操作列导致无法进入详情；移动端改为信息卡式 grid，并保留全宽“查看公司”。
3. 修复手机 Company Detail 底部双语按钮横排拥挤，520px 以下使用纵向全宽按钮。
4. 保持长内容在内部滚动区域或详情弹窗展示，不使用页面 transform 缩放。
5. 更新静态资源 cache-bust 到 `workspace-system.css?v=20260901-r6`，并加入 UI contract 防回归断言。

## 验收

| 项目 | 结果 |
| --- | --- |
| 页面横向溢出 | 0 |
| Desktop detail 超出 viewport | 0 |
| Mobile detail 超出 viewport | 0 |
| Mobile 详情入口 | PASS |
| 返回/关闭/focus restoration | PASS |
| 双语同级、上下排列 | PASS |
| Light/Dark | PASS |
| Comfortable/Compact | PASS |
| Console errors/warnings | 0 |
| 真实数据导出 UI | PASS |

页面保留正式业务字段和证据，不显示合成数据、内部实现说明或面向老板的 AI 过程性文案。长表格和 tab 在自身容器内滚动，手机仍可总览核心 KPI、状态和操作。
