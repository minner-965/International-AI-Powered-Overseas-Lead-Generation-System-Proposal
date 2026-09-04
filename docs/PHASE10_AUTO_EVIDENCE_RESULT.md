# Phase 10 自动补证结果

执行日期：2026-09-01；现行政策更新：2026-09-04

## WP-A04.2 现行 Provider-only 政策

本文件后文保留 2026-09-01 的历史运行事实。自 WP-A04.2 起，旧的每日、单次、单任务、公司/画像、purpose-pool、全局及账期 Tavily 数值预算不再参与创建或调度；company cooldown 和 numeric max-attempt 也不再构成阻断。任务仅在 Tavily 明确返回真实账户额度耗尽时暂停，429 按 `Retry-After` 延迟，精确去重、query fingerprint、有限并发、策略清单耗尽和 Provider usage 审计继续保留。

## 实现范围

Phase 10 在现有 pg-boss、ResearchJob、Tavily、Hunter、Phase 7 append-only decision 和 Research Workbench 上增加：

- 事件触发与周期对账；
- `company + product_profile + blocker + evidence_revision` 稳定 execution key；
- 阶段 claim、row lock、lease、worker 重启恢复与 singleton 去重；
- Tavily 单任务/UTC 单日/账期预算、持久 reservation、超时回收和 replay；
- 来源 TTL 复用、Provider 临时错误退避，以及当时的 7 天 company/profile cooldown（现已由 WP-A04.2 取消阻断作用）；
- 管理权限 + CSRF 的受控批次端点；
- 自动任务与人工例外的明确分流；
- inactive-first n8n 对账工作流 `workflows/03-phase10-auto-evidence-reconciliation.json`。

部署默认保持：

```text
AUTO_EVIDENCE_ENABLED=false
AUTO_EVIDENCE_OPERATOR_OVERRIDE_ENABLED=false
```

所以本次通过受控管理入口执行验证，没有把周期工作流擅自切为生产自动运行。

## 真实任务结果

| Task | Company | Profile | Final status | Attempts |
| --- | --- | --- | --- | ---: |
| `ba03dace-a7a8-4978-95c8-bb695e2fb8b1` | Rizqé | WOMENSWEAR | `EVIDENCE_EXHAUSTED` | 1 |
| `04a513ed-7578-47d4-9800-44be553542f0` | Apparel Group | WOMENSWEAR | `EVIDENCE_EXHAUSTED` | 1 |
| `c2a40fe7-b0b6-4ed6-adea-a5664f8a8d3b` | ELK Fashion Dubai | WOMENSWEAR | `EVIDENCE_EXHAUSTED` | 1 |
| `56dc38ac-8793-4027-aef0-a19a1710e5f0` | Right Face General Trading LLC | WOMENSWEAR | `EVIDENCE_EXHAUSTED` | 1 |
| `abe1577d-afa3-43a0-a0b3-ee3a92e00a10` | Right Face General Trading LLC | GENERAL_MERCHANDISE | `EVIDENCE_EXHAUSTED` | 1 |

5 个任务均到达 `REFRESHING_DECISION`，随后因没有可验证的实名相关 Buyer/VALID 联系路径进入证据耗尽和 7 天冷却。代表性最后任务完整经过 8 个阶段：来源发现、抓取、提取、归一、验证、Buyer 查找、邮箱 gate、决策刷新；没有人工伪造补证。

## Provider 使用审计

| Provider | Endpoint | Status | Events | Used units |
| --- | --- | --- | ---: | ---: |
| Tavily | `api.tavily.com/search` | `COMPLETED` | 2 | 2 |
| Tavily | `api.tavily.com/search` | `NOT_FOUND` | 6 | 6 |
| Hunter | Finder / Verifier | — | 0 | 0 |

合计 Tavily 8 次、8 units。Hunter 未调用是正确的业务门槛结果：没有经过公开证据验证的实名相关 Buyer，就不消耗 Finder/Verifier 额度。

`provider_usage_events` 只记录 Provider、用途端点、稳定指纹、状态、额度、请求 ID 和时间；不会保存 API Key、原始查询、网页 URL、标题或摘要。正常化结果先进入业务表，重复执行从持久数据 replay，不重复计费。

## 自动与人工边界

- 自动：搜索、抓取、提取、类目归一、确定性证据验证、Buyer 候选发现、符合 gate 后的邮箱验证、决策刷新。
- 人工例外：来源冲突、公司身份歧义、跨画像冲突、Buyer 任职冲突、`ACCEPT_ALL/UNKNOWN` 且替代路径耗尽、历史/suppression 冲突或线下证据补充。

本次 `human_evidence_exceptions=0`。调度审计为 `SCHEDULED=5`、`DEDUPLICATED=1`；后续受控调度均带 operator identity、role 和 approval reference，旧的 pre-hardening 事件保持原样，没有补造身份字段。

## 结论

自动补证基础设施和真实 Tavily 证据链已运行并可审计；真实公开证据没有产生实名 Buyer，因此任务诚实停在 `EVIDENCE_EXHAUSTED`，未进入 Hunter 或外发链路。
