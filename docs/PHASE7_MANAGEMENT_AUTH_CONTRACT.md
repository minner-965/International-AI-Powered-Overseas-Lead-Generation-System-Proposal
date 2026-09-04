# Phase 7 工作区身份与权限合同

版本：`phase7-workspace-context-v2`
日期：2026-09-03

## 当前边界

管理访问令牌、浏览器令牌输入框、管理 session 接口和 CSRF challenge 已移除。浏览器直接调用业务 API，不保存或发送管理 token。

当前单公司工作区由服务端附加固定审计身份：

```ini
DPV_WORKSPACE_ACTOR=dpv-workspace
DPV_WORKSPACE_ROLE=MANAGEMENT
```

该身份只用于现有业务记录的操作人、角色和审计字段，不执行登录验证。n8n/worker 的 `INTERNAL_API_TOKEN` 与邮件 Provider Webhook 签名仍是独立的机器调用边界，不会显示在浏览器中。

## 角色与审计

现有角色矩阵及发送前业务复检继续保留。所有管理事件、消息审批、导入审批和导出请求仍记录操作身份、角色、资源、版本、时间、原因和幂等摘要；append-only 历史通过新事件表达变化。

## 公网部署

当前工作区已不包含临时管理令牌验证。正式公网部署需要接入公司的统一账号登录（SSO 或员工账号）并把登录身份映射到现有角色矩阵；不要重新加入前端手输共享令牌的方式。
