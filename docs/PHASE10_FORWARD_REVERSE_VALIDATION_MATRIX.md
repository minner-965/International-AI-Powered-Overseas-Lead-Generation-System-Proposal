# Phase 10 正向/反向四象限验证矩阵

执行日期：2026-09-01
Manifest：`services/demo-dashboard/test/fixtures/phase10-four-quadrant-validation-manifest-v1.json`

## 汇总

| Quadrant | Manifest | Automated result | Real external result |
| --- | --- | --- | --- |
| `FORWARD_BASIC` | 固定 | PASS | Provider send/reply/CRM 未发生 |
| `FORWARD_HARD` | 固定 | PASS | 真实 Tavily/worker/export 已运行；真实联系人和发送未发生 |
| `REVERSE_BASIC` | 固定 | PASS | 当前部署的零发送门槛实际生效 |
| `REVERSE_HARD` | 固定 | PASS | 外部 webhook/发送恢复仅 fixture；真实事件未发生 |

Manifest contract 13/13 通过；manifest 引用的完整测试集合 93/93 通过，0 fail、0 skip、0 todo。没有 `easy-only`、warning 降级或由执行器省略困难场景。

## 12 个强制困难场景

| # | 输入/风险 | 预期 | 自动化实际结果 | Real-run 状态 |
| ---: | --- | --- | --- | --- |
| 1 | 无具体 SKU，但客户经营批准类目的女装 | 仅按 approved category scope 通过；无 SKU 要求、无 candidate、无 catalog task | PASS；固定用例加入有效 `product_master` 仍验证 `candidate_count=0`、`candidates=[]`；Rizqé 真实 dry-run/apply 也释放 | 已真实运行 |
| 2 | 同公司命中两个画像 | 分画像审计，联系不重复 | PASS | 双画像任务已存在；未发送 |
| 3 | 来源给出冲突 Buyer 任职 | 不自动放行 | PASS | 当前无实名 Buyer |
| 4 | Hunter 临时错误后成功 | 真实计费、单一有效 revision | PASS | 未达到真实 Hunter gate |
| 5 | `ACCEPT_ALL/UNKNOWN` 后找替代联系人 | 无 VALID 则人工例外 | PASS | 未达到真实 Hunter gate |
| 6 | 两个 scheduler 扫同一 blocker | 单一 singleton 任务 | PASS | 调度审计有 dedupe 记录 |
| 7 | 途中导入历史客户或 suppression | 排队联系立即失效 | PASS | 当前无待发联系 |
| 8 | 批准后证据过期/范围撤销 | approval stale，发送阻断 | PASS | 当前无批准 |
| 9 | webhook 重复、延迟、乱序 | 最终一致、一次副作用 | PASS | 未产生真实 webhook |
| 10 | worker 关键阶段重启 | 不重复 Provider/发送、不丢审计 | PASS | worker 稳定；真实发送未发生 |
| 11 | Tavily 账户真实额度耗尽后恢复 | `BUDGET_PAUSED` 保留 checkpoint；Provider 恢复后 exactly-once continuation | PASS | WP-A04.2 已真实恢复 4 条旧暂停任务；未修改旧 stop reason |
| 12 | reply/退订/硬退信/投诉 | 正确 CRM/suppression | PASS | 未产生真实事件 |

## 基础正向与基础反向

- 基础正向 fixture 覆盖清晰类目、Buyer、VALID 邮箱、管理批准、草稿批准、允许用途发送、送达、回复和 CRM 的确定性状态机。
- 基础反向 fixture 覆盖类目不匹配、历史客户、suppression、INVALID 邮箱和未批准草稿的阻断。
- 当前部署状态进一步证明所有真实外发副作用为 0，没有绕过 gate。

## 判定边界

四象限自动化 suite 全部 PASS，但 V1.1 明确规定 fixture 不替代 `CONTROLLED LIVE E2E`。真实 Provider 发送、回复、CRM 和 approved opportunity pilot 未执行，因此 Phase 10 总体状态仍为 `INCOMPLETE`。
