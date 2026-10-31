# 辅助模型：云端接口与本地模型部署（E1）

适用：SIM外贸获客系统管理员。执行标准见 `docs/llm/LOW_COST_MODEL_EXECUTION_STANDARD.md`（llm-exec-standard-v1），选型与费用见 `docs/plan/2026-10_LLM_EVALUATION.md`。

## 一、先说结论

- **辅助模型默认关闭。** 不开时系统完全靠规则工作，不调用任何模型、不产生费用。
- **默认用云端接口**：在"接口密钥 → 模型"里，服务商默认选中 **Claude Haiku**（`claude-haiku-5-5`）；也可以选 DeepSeek、通义千问 Qwen、OpenAI 兼容接口。
- **本地 Ollama 是可选项**：只给"数据必须留在自己服务器上"的情况用。compose 里的 `ollama` 服务属于 `local-llm` 配置组，**默认不启动**；只有 SIM 管理员能选，商家不能选（商家只能填公开的 https 云端接口）。
- 模型只做"带原文出处的证据摘录"（T1–T5）。企业是否合适、档位、能否发信，一律由服务端规则决定；模型结果只能**补充证据或把企业降为待复核**，不能让企业通过核验、不能放行发信、不能撤销退订或抑制。

## 二、在页面上开启（云端接口，推荐）

1. 管理员登录 → 左侧"接口密钥 / API keys" → "模型"分组。
2. "低成本模型"卡片：服务商保持 **Claude Haiku（默认）**，填 API 密钥（Anthropic 控制台申请），模型名称可不填（默认 `claude-haiku-5-5`），点"保存"，再点"测试"（只读取模型列表，不产生费用）。
   - DeepSeek：模型 `deepseek-chat`，地址可不填（默认 `https://api.deepseek.com`）。
   - 通义千问 Qwen：模型 `qwen-flash`；国际站地址填 `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`（不填则用国内站 `https://dashscope.aliyuncs.com/compatible-mode/v1`）。
   - OpenAI 兼容接口：填该服务的地址和模型名（不填地址即 OpenAI 官方）。
3. 同一分组的"辅助模型 / Model assist"卡片：
   - 总开关"辅助模型"：管 SIM 自己的客户搜索和回信。
   - 使用方式：**只记录 Shadow**（默认，结果只记下来供对比，不影响任何判断，建议先跑两周）/ **辅助判定 Assist**（把握 ≥80% 的结果可补充证据或降级）。
   - 分项开关 T1–T5（默认全关）：官网商品类目、买家类型、第三方内容识别、规则对照清单、回信意图。
   - 每月费用上限（美元，默认 20）：本月用 SIM 密钥的花费到上限即停止调用；本地模型不计费。
   - "本月"一行显示调用次数、tokens 和费用（按官方标价估算；价格表里没有的模型记"费用未知"，不记 0）。
4. "待人工确认"列表：置信度 0.50–0.79 的条目在这里，点"确认"或"不采用"（都会留记录）。≥0.80 自动成为可用证据（仅 Assist 模式），<0.50 丢弃只留记录。
5. 商家：在"我的接口密钥"里填**自己的**模型密钥后，可以开自己账号的辅助模型，费用记在商家自己的账户上。商家没有密钥时，管理员可在"辅助模型 → 允许商家使用 SIM 的模型"里逐个开通，费用计入 SIM。

## 三、本地模型（可选）：Ollama + Qwen2.5 7B

### 3.1 服务器配置要求

| 项 | 要求 | 依据 |
|---|---|---|
| 内存（只用 CPU） | 7B 模型至少 **8 GB 可用内存**；建议整机 16 GB（工作台、PostgreSQL、SearXNG、翻译服务同机运行） | Ollama 官方 README："at least 8 GB of RAM available to run the 7B models"（[v0.5.0 README](https://github.com/ollama/ollama/blob/v0.5.0/README.md)） |
| 磁盘 | `qwen2.5:7b` 下载约 **4.7 GB**（Q4_K_M 量化），预留 10 GB | [ollama.com/library/qwen2.5:7b](https://ollama.com/library/qwen2.5:7b) |
| 上下文 | 模型支持最长 128K tokens；我们每次只发约 4–6 千 tokens | 同上 |
| 许可证 | Qwen2.5-7B：Apache 2.0；Ollama：MIT | 同上；[github.com/ollama/ollama](https://github.com/ollama/ollama) |
| CPU | 4 核以上 x86-64（支持 AVX2）；核数越多越快 | 经验值 |

速度：

- **GPU**（官方数据，Qwen2.5-7B-Instruct，单张 A100 80GB，Transformers）：4bit 量化约 **38–43 token/s**，显存约 **5.5–6.5 GB**；BF16 约 39–40 token/s，显存 14–15 GB（[Qwen2.5 速度基准](https://qwen.readthedocs.io/en/v2.5/benchmark/speed_benchmark.html)）。消费级显卡 8 GB 显存即可装下 4bit 7B 模型。
- **只用 CPU**：官方没有公布数字。经验上 7B Q4 在 8 核桌面 CPU 上每秒只有几个 token，一条 T1 任务（约 600 token 输出）可能要一到几分钟。**部署后请实测**（看"本月"里的调用次数和服务日志耗时），不要据此估算吞吐。后台任务对速度不敏感，但每天上千页时建议用 GPU 或改用云端接口。

GPU 选项（官方 Docker 说明：[docs.ollama.com/docker](https://docs.ollama.com/docker)）：

- NVIDIA：先装 NVIDIA Container Toolkit，再给 `ollama` 服务加 GPU 设备（compose 中 `deploy.resources.reservations.devices` 或 `gpus: all`）。
- AMD：使用 `ollama/ollama:0.40.11-rocm` 镜像，并映射 `/dev/kfd`、`/dev/dri`。
- Windows + Docker Desktop：需 WSL2 后端并开启 GPU 支持。

### 3.2 启动与拉取模型

```powershell
cd E:\claude\SIM
# 只启动本地模型服务（不影响其他服务；不加 --profile 时它永远不会启动）
docker compose --profile local-llm up -d ollama
# 拉取模型（约 4.7 GB，只需一次，保存在 ollama_models 卷里）
docker compose exec ollama ollama pull qwen2.5:7b
# 可选：DeepSeek-R1 蒸馏版（会先输出思考内容，系统会自动去掉）
docker compose exec ollama ollama pull deepseek-r1:7b
# 查看已有模型
docker compose exec ollama ollama list
# 从工作台容器内检查接口（ollama 不对外开放端口，只在内部网络）
docker compose exec demo-dashboard wget -qO- http://ollama:11434/v1/models
```

然后在"接口密钥 → 模型"里选 **本地 Ollama（可选）**，模型名称填 `qwen2.5:7b`，地址可不填（默认 `http://ollama:11434/v1`），密钥不用填，保存后点"测试"。

停止：`docker compose --profile local-llm stop ollama`。镜像版本固定为 `ollama/ollama:0.40.11`（2026-10-24 发布），升级时改 compose 里的版本号。

### 3.3 数据与安全

- 本地模型时，网页正文和回信只在本机内部网络传输。
- 无论云端还是本地，发给模型的回信都先把邮箱、电话、人名替换成 `[EMAIL]` `[PHONE]` `[NAME]`；网页里的密钥样式文本替换成 `[SECRET]`；隐藏元素和脚本不发送；网页正文包在固定分隔标记里，正文里的"指令"一律不执行。
- 密钥加密保存在服务端，页面只显示末四位；模型调用记录里不存任何密钥。

## 四、记录与追溯（迁移 075，全部只追加）

| 表 | 内容 |
|---|---|
| `leadgen.llm_assist_settings` | 每次开关/模式/分项/上限的修改（最新一行生效） |
| `leadgen.llm_merchant_allowances` | 管理员是否允许某商家使用 SIM 的模型 |
| `leadgen.llm_calls` | 每次调用：服务商、模型、任务、标准版本、提示版本、输入摘要、tokens、费用、结果、耗时；同一输入重复时记为 CACHED 并复用旧结果 |
| `leadgen.llm_evidence` | 每条校验后的结果：引文、置信度、状态（ACCEPTED / REVIEW / DISCARDED / REJECTED / NO_ITEMS）、extraction_version（如 `llm-T1-v1-claude-haiku-5-5`） |
| `leadgen.llm_review_decisions` | 人工确认 / 不采用的记录 |

## 五、接入点（给各模块负责人）

代码在 `services/demo-dashboard/src/llm/`。服务端创建一次：

```js
import {createModelAssist} from './llm/assistService.js';
import {createModelAssistHooks} from './llm/hooks.js';
const modelAssist=createModelAssist({pool,credentials:credentialStore});
const modelAssistHooks=createModelAssistHooks({assist:modelAssist});
```

钩子在开关关闭时立即返回 `{ran:false}`，出错也不会抛到流水线里；`usable` 只在 Assist 模式下有内容：

| 钩子 | 调用位置 | 用法 |
|---|---|---|
| `afterPageCrawl({merchantId,companyId,company,url,html,approvedCategories})` | `src/categoryProcurement/CategoryEvidenceService.js` `collect()` 中 `extractCategoryBuyerObservations(...)` 之后 | `usable` 每条另存为一条类目观测，`extraction_version` 用 evidence 行的值；ACCEPTED 才可标 VERIFIED |
| `checkBuyerType({merchantId,companyId,company,pages})` | 企业核验（`src/verification/companyVerificationService.js`）读取官网 1–3 页后 | `usable` 作为额外证据交给 `buyerBusinessModel` / C1 零售连锁规则，不能单独让企业通过 |
| `checkAttribution({merchantId,companyId,company,evidence})` | 证据入档位前（`src/opportunityPool/` 分类前） | `needs_review===true` 时把该证据标"需复核"、不参与档位；false 不能恢复被规则排除的证据 |
| `ruleChecklist(...)` | 人工复核页面需要时 | 只给人看，规则不读 |
| `classifyReply({merchantId,replyId,companyId,subject,bodyText,ruleResult})` | `src/phase7/service.js` 两处 `classifyInboundReply(...)` 之后 | 用 `merged`：`opt_out===true` 立即按退订处理再进人工复核；`create_task===true` 才自动建任务；Shadow 模式下 `merged` 与规则结果相同 |
