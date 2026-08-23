import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "E:/AI Automatic Lead Generation System/outputs/dpv_leadgen_cost_budget_cn";
const today = "2026-08-20";

const wb = Workbook.create();
const summary = wb.worksheets.add("Summary");
const detail = wb.worksheets.add("Cost_Detail");
const assumptions = wb.worksheets.add("Assumptions");
const rollout = wb.worksheets.add("Rollout_View");
const sources = wb.worksheets.add("Sources");

for (const ws of [summary, detail, assumptions, rollout, sources]) {
  ws.showGridLines = false;
}

function setWidths(ws, widths) {
  widths.forEach((w, idx) => {
    ws.getCell(0, idx).format.columnWidth = w;
  });
}

function title(ws, range, text, subtitle = "") {
  const r = ws.getRange(range);
  r.merge();
  r.values = [[text]];
  r.format = {
    fill: "#17324D",
    font: { color: "#FFFFFF", bold: true, size: 15 },
    horizontalAlignment: "left",
    verticalAlignment: "center",
  };
  r.format.rowHeight = 30;
  if (subtitle) {
    const s = ws.getRange("A2:H2");
    s.merge();
    s.values = [[subtitle]];
    s.format = {
      fill: "#EAF1F8",
      font: { color: "#17324D", italic: true },
      wrapText: true,
    };
  }
}

function styleHeader(range) {
  range.format = {
    fill: "#2F5F8F",
    font: { color: "#FFFFFF", bold: true },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: "#8EA9C1" },
  };
}

function styleBody(range) {
  range.format = {
    font: { color: "#1F2933" },
    verticalAlignment: "top",
    wrapText: true,
    borders: {
      insideHorizontal: { style: "thin", color: "#E1E7EF" },
      bottom: { style: "thin", color: "#CAD6E2" },
    },
  };
}

function money(range) {
  range.format.numberFormat = '"¥"#,##0';
  range.format.horizontalAlignment = "right";
}

// Assumptions
title(
  assumptions,
  "A1:H1",
  "DPV 海外自动获客系统成本假设",
  "口径：内部技术实施，外部实施服务费按 0 处理；金额为人民币估算，未税；黄色单元格是可调整输入。"
);
setWidths(assumptions, [23, 15, 16, 15, 16, 52, 30, 24]);
assumptions.getRange("A4:H4").values = [[
  "Driver",
  "Demo Low",
  "Demo High",
  "Landing Low",
  "Landing High",
  "说明",
  "为什么需要",
  "备注",
]];
styleHeader(assumptions.getRange("A4:H4"));

const assumptionRows = [
  ["汇率 USD/CNY", 7.2, 7.2, 7.2, 7.2, "用于把美元计费服务折算成人民币。", "OpenAI API、AWS SES 等通常以美元计价。", "可按付款日实际汇率调整"],
  ["两周 demo 线索数", 50, 150, 0, 0, "demo 只跑小样本，验证流程和结果质量。", "控制 API、邮箱验证和数据成本。", "建议先选 50-100 条"],
  ["正式月处理线索数", 0, 0, 500, 2000, "落地后每月搜索、筛选、评分和跟进的线索量。", "决定数据源、API、邮箱验证、发信服务用量。", "可按市场数量扩展"],
  ["模型调用次数/线索", 3, 5, 4, 8, "公司分类、网页摘要、产品匹配、邮件文案、回复意图识别。", "用于完成判断、匹配和文本生成等自动化处理。", "回复识别上线后次数增加"],
  ["平均 API 成本/线索", 0.5, 2.0, 0.6, 3.0, "按轻量模型、缓存、重试和规则调优缓冲估算。", "直接对应大模型按量费用。", "实际取决于模型和 token 量"],
  ["邮箱验证成本/条", 0.05, 0.30, 0.05, 0.50, "批量验证邮箱有效性，降低退信。", "保护发信域名信誉。", "可先少量验证"],
  ["发信成本/千封", 1, 3, 1, 5, "AWS SES 等服务按量发信费用很低。", "支持自动首触达、跟进、退信处理。", "不含邮箱账号订阅"],
  ["每条线索平均邮件数", 1, 2, 2, 4, "demo 通常只演示首封或一次跟进；落地后有序列跟进。", "影响发信量和域名信誉管理。", "需设置每日上限"],
];
assumptions.getRange(`A5:H${4 + assumptionRows.length}`).values = assumptionRows;
styleBody(assumptions.getRange(`A5:H${4 + assumptionRows.length}`));
assumptions.getRange("B5:E12").format.fill = "#FFF7CC";
assumptions.getRange("B5:E12").format.numberFormat = "0.00";

// Detail table
title(
  detail,
  "A1:J1",
  "DPV 海外自动获客系统成本明细",
  "按“内部实施、先 demo、后落地”的现金支出口径拆解。外部实施服务费不作为现金预算列入。"
);
setWidths(detail, [20, 14, 12, 13, 13, 16, 16, 18, 50, 38]);
detail.getRange("A4:J4").values = [[
  "费用项",
  "性质",
  "是否必须",
  "两周 demo 低",
  "两周 demo 高",
  "落地一次性低",
  "落地一次性高",
  "落地月费区间",
  "为什么要花这笔钱",
  "省钱/延后策略",
]];
styleHeader(detail.getRange("A4:J4"));

const rows = [
  ["内部开发工具", "开发工具", "已有则否", 0, 0, 0, 0, "已有工具则新增 ¥0；无订阅按实际套餐", "用于内部技术实施阶段的代码开发、流程配置、脚本编写和规则调试。它不是系统上线后的运行 API。", "已有工具就先不新增；预算里可标注为“现有工具，不新增现金成本”。"],
  ["云服务器", "基础设施", "是", 100, 500, 0, 0, "¥300-1,000/月", "运行 n8n、数据库、后台任务、日志。demo 低配即可，正式落地再按访问量升级。", "一开始不需要买很贵，选可扩容 2C4G/2C8G + 快照即可。"],
  ["PostgreSQL 数据库", "基础设施", "是", 0, 200, 0, 0, "¥0-1,500/月", "存客户线索、产品库、评分、邮件记录、跟进状态。", "demo 和早期可放同一台服务器；数据稳定后再换托管数据库。"],
  ["n8n 自动化引擎", "软件", "是", 0, 0, 0, 0, "自托管 ¥0；云版按套餐", "负责把公开数据采集、模型分析、入库、邮件草稿、跟进任务串成流程。", "先自托管社区版，落地后再考虑云版或企业版。"],
  ["NocoDB/后台管理界面", "软件", "建议", 0, 0, 0, 0, "自托管 ¥0；云版按席位", "让你和销售能查看线索、评分、产品匹配、邮件草稿和处理状态。", "先自托管；如果后续多人协作再买云版。"],
  ["大模型 API", "按量", "建议", 50, 300, 0, 0, "¥300-3,000/月", "用于公司分类、网页摘要、产品匹配、开发信生成、回复意图识别。", "demo 只跑 50-100 条并缓存结果；正式后按线索量放大。"],
  ["公开数据采集/搜索接口", "按量/可选", "先公开数据", 0, 200, 0, 3000, "¥0-3,000/月；付费数据源暂不默认购买", "优先用 Google/Bing、海关公开信息、行业目录、展会名录、公司官网等公开数据筛选线索。", "只有公开数据质量不够、联系人缺失严重或效率太低时，再评估 Apollo 等付费数据服务。"],
  ["域名和邮箱账号", "基础设施", "是", 50, 300, 300, 1500, "¥100-800/月", "正式发开发信需要专用域名、邮箱账号和基础 DNS 配置。", "demo 可以先内部测试；正式前再配置发信域名和 SPF/DKIM/DMARC。"],
  ["发信服务", "按量", "落地必须", 0, 50, 0, 0, "¥20-300/月", "支持批量发送、退信处理、投递记录，成本本身很低。", "先小批量；正式后设置每日上限，避免域名信誉受损。"],
  ["邮箱验证", "按量", "建议", 20, 200, 0, 0, "¥100-1,000/月", "验证客户邮箱是否有效，降低退信率。", "demo 少量验证；正式发信前再批量验证。"],
  ["备份/对象存储/日志", "运维", "建议", 20, 100, 0, 0, "¥100-500/月", "保存导入数据、运行日志、导出文件和数据库备份。", "demo 只做基础快照；正式后加自动备份策略。"],
  ["监控和告警", "运维", "后期需要", 0, 100, 0, 0, "¥100-500/月", "发现流程失败、API 调用失败、邮件异常、服务器资源不足。", "demo 阶段可用简单日志；落地后加告警。"],
  ["合规/退订/异常停止机制", "落地建设", "落地必须", 0, 0, 1000, 5000, "通常含在维护中", "自动化发信必须支持退订、退信、频控、人工审批和异常停止。", "demo 可以只展示规则；正式落地前必须做。"],
  ["外部实施服务", "人工", "否", 0, 0, 0, 0, "¥0", "本项目按内部技术实施口径测算，现金预算不列外部实施服务费。", "内部时间成本可单独管理，不放入本现金预算。"],
];
detail.getRange(`A5:J${4 + rows.length}`).values = rows;
styleBody(detail.getRange(`A5:J${4 + rows.length}`));
money(detail.getRange(`D5:G${4 + rows.length}`));
detail.getRange(`A5:J${4 + rows.length}`).format.rowHeight = 54;
detail.getRange("A4:J4").format.rowHeight = 34;

// Rollout view
title(
  rollout,
  "A1:H1",
  "Rollout Budget View",
  "管理层版本：先用低现金成本验证，两周 demo 通过后再进入项目落地。"
);
setWidths(rollout, [20, 18, 18, 18, 18, 43, 36, 24]);
rollout.getRange("A4:H4").values = [[
  "阶段",
  "一次性低",
  "一次性高",
  "月费低",
  "月费高",
  "阶段目标",
  "为什么不是一开始就全买",
  "建议决策",
]];
styleHeader(rollout.getRange("A4:H4"));
const rolloutRows = [
  ["两周 demo", 240, 1950, 100, 500, "跑通线索入库、线索评分、产品匹配、邮件草稿、人工确认流程。", "只验证流程，不需要大规模发信、付费数据源和重型数据库。", "先用小服务器+少量 API+公开数据"],
  ["首期 MVP/落地准备", 1300, 9500, 900, 4200, "接入公开数据采集、发信域名、看板、退订/退信/频控、基础备份。", "等 demo 结果确认后再配置邮箱体系；付费数据源先不买。", "公开数据优先，重点市场逐步开通"],
  ["正式落地运行", 0, 5000, 1020, 11600, "每月稳定处理 500-2000 条公开数据线索，自动首触达、跟进、回复分流。", "实际月费随线索量、市场数、邮箱验证和是否购买付费数据增长。", "月度复盘后扩容；付费数据作为备选"],
];
rollout.getRange("A5:H7").values = rolloutRows;
styleBody(rollout.getRange("A5:H7"));
money(rollout.getRange("B5:E7"));
rollout.getRange("A5:H7").format.rowHeight = 64;

// Summary
title(
  summary,
  "A1:H1",
  "DPV 海外自动获客系统成本预算摘要",
  "版本日期 2026-08-20；口径：内部技术实施，外部实施服务费为 0，预算只看真实现金支出。"
);
setWidths(summary, [24, 34, 18, 18, 18, 62, 46, 30]);
summary.getRange("A4:H4").values = [[
  "阶段",
  "一次性低",
  "一次性高",
  "月费低",
  "月费高",
  "管理层说明",
  "主要费用花在哪里",
  "是否现在就要订阅好一点",
]];
styleHeader(summary.getRange("A4:H4"));
summary.getRange("A5:H7").values = [
  ["两周 demo", 240, 1950, 100, 500, "先用小钱验证系统能不能产生有价值线索。", "服务器、少量 API、少量邮箱/公开数据验证。", "不用，高配延后。"],
  ["首期 MVP/落地准备", 1300, 9500, 900, 4200, "demo 通过后再投入真实市场和发信体系。", "公开数据采集、发信域名、邮箱验证、看板和频控。", "服务器可中配，数据库仍可先同机。"],
  ["正式落地运行", 0, 5000, 1020, 11600, "落地后费用随线索量增长，付费数据源暂时不是默认项。", "公开数据采集、邮箱体系、监控维护、API 按量。", "按负载扩容，必要时托管数据库。"],
];
styleBody(summary.getRange("A5:H7"));
money(summary.getRange("B5:E7"));
summary.getRange("A5:H7").format.rowHeight = 66;

summary.getRange("A10:B10").values = [["关键结论", "金额/说明"]];
styleHeader(summary.getRange("A10:B10"));
summary.getRange("A11:B15").values = [
  ["两周 demo 现金支出", "约 ¥240-1,950 + 服务器月费 ¥100-500"],
  ["首期 MVP/落地准备", "约 ¥1,300-9,500 一次性 + ¥900-4,200/月"],
  ["正式落地运行", "约 ¥1,020-11,600/月，取决于线索量和是否启用付费数据"],
  ["API 费用是否很高", "通常不是最大头；demo 只跑小样本，API 多数在几十到几百元"],
  ["服务器是否一开始买好", "不建议一开始重配；选可扩容服务器，数据稳定后再升级数据库/队列/监控"],
];
styleBody(summary.getRange("A11:B15"));
summary.getRange("A11:B15").format.rowHeight = 50;

summary.getRange("D10:H10").merge();
summary.getRange("D10:H10").values = [["管理层说明"]];
styleHeader(summary.getRange("D10:H10"));
summary.getRange("D11:H15").merge();
summary.getRange("D11:H15").values = [[
  "本项目不需要一开始采购完整生产级配置。第一阶段只做低成本验证：小服务器、自托管 n8n/NocoDB、少量 API、公开数据线索。后续成本升高主要来自正式发信域名配置、邮箱验证、退订/退信/频控、备份和监控。付费数据源不是默认采购项，只有公开数据筛选效果不够时再评估。项目按内部技术实施口径测算，因此不列外部实施服务费。"
]];
summary.getRange("D11:H15").format = {
  fill: "#F7FAFC",
  font: { color: "#1F2933" },
  wrapText: true,
  verticalAlignment: "top",
  borders: { preset: "outside", style: "thin", color: "#CAD6E2" },
};

// Sources
title(sources, "A1:F1", "Sources And Notes", "外部单价为公开价格口径，实际以付款页面和采购合同为准。");
setWidths(sources, [22, 48, 32, 28, 20, 48]);
sources.getRange("A4:F4").values = [["项目", "来源/URL", "用于估算", "口径", "日期", "备注"]];
styleHeader(sources.getRange("A4:F4"));
const sourceRows = [
  ["大模型 API 价格", "https://openai.com/api/pricing/", "大模型按 token 计费", "按轻量/中等模型估算", today, "工作簿用人民币缓冲区间，不直接绑定单一模型"],
  ["AWS SES pricing", "https://aws.amazon.com/ses/pricing/", "发信与邮箱验证", "按千封/按地址验证", today, "发信成本低，域名信誉和验证更关键"],
  ["n8n pricing", "https://n8n.io/pricing/", "自动化引擎", "自托管社区版可先用", today, "云版/企业版后续再评估"],
  ["NocoDB pricing", "https://www.nocodb.com/pricing", "后台管理界面", "自托管社区版可先用", today, "多人协作再考虑云版"],
  ["项目方案", "E:/AI Automatic Lead Generation System/final_updated_v3/DPV International AI海外自动获客系统建设方案（中文版）.docx", "阶段范围", "两周 demo/首期/后续自动化", today, "预算按方案中的分阶段落地逻辑拆解"],
];
sources.getRange(`A5:F${4 + sourceRows.length}`).values = sourceRows;
styleBody(sources.getRange(`A5:F${4 + sourceRows.length}`));
sources.getRange(`A5:F${4 + sourceRows.length}`).format.rowHeight = 44;

for (const ws of [summary, detail, assumptions, rollout, sources]) {
  ws.freezePanes.freezeRows(4);
  ws.getUsedRange().format.font.name = "Microsoft YaHei";
}

await fs.mkdir(outputDir, { recursive: true });

for (const [sheetName, fileName] of [
  ["Summary", "preview_summary.png"],
  ["Cost_Detail", "preview_detail.png"],
  ["Rollout_View", "preview_rollout.png"],
]) {
  const preview = await wb.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(path.join(outputDir, fileName), new Uint8Array(await preview.arrayBuffer()));
}

const formulaErrors = await wb.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log(formulaErrors.ndjson);

const check = await wb.inspect({
  kind: "table",
  sheetId: "Summary",
  range: "A4:H15",
  include: "values,formulas",
  tableMaxRows: 15,
  tableMaxCols: 8,
});
console.log(check.ndjson);

const output = await SpreadsheetFile.exportXlsx(wb);
await output.save(path.join(outputDir, "DPV_Overseas_LeadGen_Cost_Budget_CN.xlsx"));
console.log(path.join(outputDir, "DPV_Overseas_LeadGen_Cost_Budget_CN.xlsx"));
