# Phase 7 管理端认证与权限合同

版本：`phase7-management-auth-v1`
日期：2026-08-31

## 边界

管理端浏览器身份、内部 worker 调用和外部邮件 Webhook 使用三条独立信任链：

| 调用方 | 认证方式 | 禁止替代方式 |
| --- | --- | --- |
| 管理端浏览器 | `DPV_MANAGEMENT_API_TOKEN`、操作人身份、角色、CSRF | 不复用 `INTERNAL_API_TOKEN` |
| n8n / worker | `INTERNAL_API_TOKEN` | 不代表管理审批身份 |
| 外部邮件 Webhook | Provider 原始请求体验签 | 不接受 internal token 代替签名 |

所有密钥仅保存在本地环境或公司的 secret manager，不写入 Git、浏览器脚本、工作流 JSON、导出文件或日志。

## 管理端请求

认证请求头：

~~~http
Authorization: Bearer <DPV_MANAGEMENT_API_TOKEN>
X-DPV-Actor: <compatibility hint; not authoritative>
X-DPV-Role: <compatibility hint; not authoritative>
X-DPV-CSRF: <session token for state-changing requests>
~~~

服务端行为：

- actor 与 role 由服务端 `token → identity/role` 绑定决定；客户端请求头不能选择或提升角色；
- 单用户本地配置使用 `DPV_MANAGEMENT_API_TOKEN` + `DPV_MANAGEMENT_API_ACTOR` + `DPV_MANAGEMENT_API_ROLE`；多用户使用 `DPV_MANAGEMENT_TOKEN_BINDINGS`；

- 未配置管理 token：`503 MANAGEMENT_AUTH_NOT_CONFIGURED`；
- token 不匹配：`401 MANAGEMENT_AUTH_REQUIRED`；
- 身份为空或角色不在允许列表：`403 MANAGEMENT_ROLE_INVALID`；
- 角色不具备该操作权限：`403 MANAGEMENT_ROLE_FORBIDDEN`；
- 写请求 CSRF 不匹配：`403 MANAGEMENT_CSRF_INVALID`。

CSRF 值由服务端以独立的 `DPV_MANAGEMENT_CSRF_SECRET` 对 `identity|ROLE|dpv-phase7` 计算 HMAC-SHA256，并只在通过认证的 session 响应中返回。前端不计算、不保存服务端密钥。为兼容既有本地配置，服务端在未配置独立 CSRF secret 时会回退到 management token；公司环境应始终配置两个不同的长随机值。

## 角色

当前实现允许的基础角色：

~~~text
SALES
MANAGEMENT
DATA_ADMIN
FINANCE
MANAGEMENT_APPROVER
OUTREACH_APPROVER
SENDER_OPERATOR
~~~

操作权限最小合同：

| 操作 | 允许角色 |
| --- | --- |
| 查看获授权的机会、联系队列和任务 | `SALES`, `MANAGEMENT` |
| Opportunity Management Approval / Hold / Request Evidence | `MANAGEMENT` |
| 编辑草稿 | `SALES`, `MANAGEMENT` |
| Exact Message Approval / Reject / Revoke | `MANAGEMENT` |
| 触发已审批消息队列 | `SENDER_OPERATOR` 或明确兼容授权的 `MANAGEMENT`，且继续执行发送前复检 |
| 导入 dry-run、查看行错误 | `DATA_ADMIN`, `MANAGEMENT` |
| 批准及 commit 导入 | `DATA_ADMIN`, `MANAGEMENT`，审批人与行为均审计 |
| 客户成交/价格字段导出 | `FINANCE` 或明确获授权的 `MANAGEMENT` |
| 普通销售机会导出 | `SALES`, `MANAGEMENT`，应用列级权限 |

一个人员可以获授多个角色，但每个事件只记录该次操作使用的一个角色。

## 审计字段

管理事件、消息审批、导入审批和导出请求至少记录：

~~~text
actor identity
actor role
operation
resource id
decision/input revision or digest
timestamp
reason nullable
request/idempotency digest
~~~

审计表中的 append-only 记录通过新事件表达撤销或替代，不覆盖旧记录。

## 当前实现状态

`services/demo-dashboard/src/phase7/managementAuth.js` 已实现 token、身份、角色和 CSRF 中间件。路由级角色矩阵、管理端 session 接线和浏览器端调用均已完成，并纳入 Phase 7 自动化测试。浏览器多视口最终验收仍以 `docs/PHASE7_RESULT.md` 为准。
