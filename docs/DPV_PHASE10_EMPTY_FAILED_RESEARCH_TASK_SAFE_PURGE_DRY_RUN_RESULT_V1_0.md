# DPV Phase 10 — 空任务/失败任务安全清理 Dry-run 执行结果 V1.0

执行日期：2026-09-04
执行范围：分类器、隔离 PostgreSQL 测试、主库 dry-run
最终状态：PASS（未执行 apply）

## 1. 本轮交付

- 新增 `scripts/classify-and-purge-empty-research-jobs.mjs`。
- 支持 `--dry-run`、`--apply` 以及 `--job-id`、`--task-id`、`--status`、`--created-before` 过滤参数。
- 实现七类逐任务分类和严格零副作用硬删除资格公式。
- 新增 20 个隔离 PostgreSQL 验收场景。
- 对主库 128 条 ResearchJob 完成只读 dry-run。
- 对计划点名的 4 条 historical continuation task 逐条完成分类。
- 未执行主库删除、归档或其他数据变更。

## 2. 主库 dry-run 汇总

| 分类 | 数量 |
|---|---:|
| EMPTY_NEVER_STARTED | 2 |
| EMPTY_FAILED_BEFORE_SIDE_EFFECT | 5 |
| DUPLICATE_EMPTY_TASK | 0 |
| PROVIDER_USED_NO_BUSINESS_RESULT | 2 |
| BUSINESS_OUTPUT_PRESENT | 68 |
| ACTIVE_OR_RECOVERABLE | 51 |
| AMBIGUOUS_REFERENCE | 0 |
| HARD_DELETE_ELIGIBLE | 7 |
| 总计 | 128 |

未知 lineage 字段：0。

## 3. HARD_DELETE_ELIGIBLE 候选

以下 7 条记录均通过严格零副作用公式；本轮只报告，不删除。

| ResearchJob | 状态 | 分类 | Worker claim | Provider events / units | 业务引用 | Continuation | Checkpoint | Pending outbox | Live queue | Email / CRM | 结论 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `2ab91a32-1f3e-43c7-a2ff-14ecfd8a5692` | COMPLETED | EMPTY_FAILED_BEFORE_SIDE_EFFECT | 1 | 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 / 0 | STRICT_ZERO_SIDE_EFFECT_FORMULA_PASSED |
| `828d802f-3cd0-4905-bebf-92e901cbac65` | FAILED | EMPTY_NEVER_STARTED | 0 | 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 / 0 | STRICT_ZERO_SIDE_EFFECT_FORMULA_PASSED |
| `5b58b913-d68a-4dd1-8c4b-6c317d9cea85` | COMPLETED | EMPTY_FAILED_BEFORE_SIDE_EFFECT | 1 | 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 / 0 | STRICT_ZERO_SIDE_EFFECT_FORMULA_PASSED |
| `1829f338-4ef8-4abc-a8b4-c0f83e7ff1df` | COMPLETED | EMPTY_FAILED_BEFORE_SIDE_EFFECT | 1 | 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 / 0 | STRICT_ZERO_SIDE_EFFECT_FORMULA_PASSED |
| `00d05028-fff0-4f25-b29c-34bbe70a6ed6` | FAILED | EMPTY_FAILED_BEFORE_SIDE_EFFECT | 1 | 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 / 0 | STRICT_ZERO_SIDE_EFFECT_FORMULA_PASSED |
| `ad410086-2137-4ffb-bcb8-ddfc4f79b2a2` | FAILED | EMPTY_FAILED_BEFORE_SIDE_EFFECT | 1 | 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 / 0 | STRICT_ZERO_SIDE_EFFECT_FORMULA_PASSED |
| `aad48749-b47d-474a-b564-fff0164f6b86` | FAILED | EMPTY_NEVER_STARTED | 0 | 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 / 0 | STRICT_ZERO_SIDE_EFFECT_FORMULA_PASSED |

全部候选的 provider request id、active continuation、ambiguous reference 计数也均为 0。

## 4. 四条 historical continuation task 的逐条结论

| AutoEvidenceTask | 当前状态 | 关联 ResearchJob 数 | 实际分类结果 | 硬删除资格 |
|---|---|---:|---|---|
| `56dc38ac-8793-4027-aef0-a19a1710e5f0` | RETRY_SCHEDULED | 6 | BUSINESS_OUTPUT_PRESENT / ACTIVE_OR_RECOVERABLE；业务引用 2–28，已有 Provider 使用记录 | 否 |
| `7f9d4d2f-2555-4f40-8958-21d49eb3740b` | EVIDENCE_EXHAUSTED | 4 | BUSINESS_OUTPUT_PRESENT / ACTIVE_OR_RECOVERABLE；业务引用 12–65，存在 checkpoint/continuation | 否 |
| `abe1577d-afa3-43a0-a0b3-ee3a92e00a10` | EVIDENCE_EXHAUSTED | 6 | BUSINESS_OUTPUT_PRESENT / ACTIVE_OR_RECOVERABLE；业务引用 0–28；无业务引用的那次运行有 Provider 用量和 continuation | 否 |
| `ba03dace-a7a8-4978-95c8-bb695e2fb8b1` | RETRY_SCHEDULED | 9 | BUSINESS_OUTPUT_PRESENT / ACTIVE_OR_RECOVERABLE；业务引用 2–49，部分运行存在 continuation | 否 |

结论：这 4 条任务均不是空任务，均保留完整 lineage；该结论来自逐任务、逐 ResearchJob 的实际引用检查，而不是预设全部保留。

## 5. 隔离数据库测试

| 指标 | 结果 |
|---|---:|
| tests | 20 |
| pass | 20 |
| fail | 0 |
| skipped | 0 |

覆盖：从未派发、派发前失败、worker 启动但未产生副作用、重复空任务、Provider 用量、checkpoint、continuation、公司/候选/决策输出、pending outbox、live pg-boss、竞态重检、重复 purge、邮件零变化、CRM 零变化。

测试使用临时数据库 `leadgen_empty_purge_test_20260904`。测试结束后已删除该临时数据库，并确认残留数量为 0。

## 6. 安全与停止条件

- 主库运行模式：DRY_RUN。
- 主库 purge audit 表仍不存在，`--apply` 会 fail closed；本轮未调用 `--apply`。
- 主库数据写入：0。
- Tavily 调用：0。
- Hunter 调用：0。
- 邮件发送：0。
- CRM 写入：0。
- 未关闭 Phase 9 immutable trigger。
- 未删除 migrations、provider_usage_events 或任何业务输出。

按计划在分类器、测试和 dry-run 完成后 STOP。后续若批准物理清理，应先通过独立 migration 建立 purge audit 表，再单独执行受控 apply；`PROVIDER_USED_NO_BUSINESS_RESULT` 只进入归档流程，不进入硬删除流程。
