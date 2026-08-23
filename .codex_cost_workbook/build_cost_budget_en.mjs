import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "E:/AI Automatic Lead Generation System/outputs/dpv_leadgen_cost_budget_en";
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

title(
  assumptions,
  "A1:H1",
  "DPV Overseas Lead Generation Cost Assumptions",
  "Basis: in-house development with no external implementation vendor. Outsourced development cost is treated as RMB 0. Amounts are pre-tax estimates. Yellow cells are editable assumptions."
);
setWidths(assumptions, [25, 15, 16, 15, 16, 56, 42, 30]);
assumptions.getRange("A4:H4").values = [[
  "Driver",
  "Demo Low",
  "Demo High",
  "Landing Low",
  "Landing High",
  "Explanation",
  "Why It Is Needed",
  "Notes",
]];
styleHeader(assumptions.getRange("A4:H4"));

const assumptionRows = [
  ["USD/CNY exchange rate", 7.2, 7.2, 7.2, 7.2, "Used to convert USD-priced services into RMB.", "OpenAI API and AWS SES are commonly priced in USD.", "Update using the actual payment-date rate."],
  ["Two-week demo leads", 50, 150, 0, 0, "The demo only runs a small sample to validate workflow and output quality.", "Keeps API, email validation, and data costs low.", "Recommended starting sample: 50-100 leads."],
  ["Monthly production leads", 0, 0, 500, 2000, "Monthly leads to search, qualify, score, and follow up after rollout.", "Drives API usage, email validation, sending volume, and storage.", "Scale by target market and product category."],
  ["Model calls per lead", 3, 5, 4, 8, "Company classification, website summary, product matching, email copy, and reply-intent detection.", "These calls handle the judgement and writing tasks in the workflow.", "Reply-intent detection increases usage after automation is enabled."],
  ["Average API cost per lead", 0.5, 2.0, 0.6, 3.0, "Estimated with lightweight models, caching, retries, and rule-tuning buffer.", "Variable cost for analysis, matching, and copy generation.", "Actual cost depends on model choice and token volume."],
  ["Email validation cost per address", 0.05, 0.30, 0.05, 0.50, "Checks whether recipient emails are valid before outreach.", "Reduces bounce rate and protects sending-domain reputation.", "Use lightly in demo; batch-validate before formal sending."],
  ["Email sending cost per 1,000 emails", 1, 3, 1, 5, "Transactional email services such as AWS SES charge very low sending fees.", "Supports first-touch, follow-up, bounce handling, and delivery records.", "Does not include mailbox subscriptions."],
  ["Average emails per lead", 1, 2, 2, 4, "Demo usually shows first email or one follow-up; rollout uses controlled sequences.", "Affects sending volume and domain-reputation management.", "Daily caps are required for production sending."],
];
assumptions.getRange(`A5:H${4 + assumptionRows.length}`).values = assumptionRows;
styleBody(assumptions.getRange(`A5:H${4 + assumptionRows.length}`));
assumptions.getRange("B5:E12").format.fill = "#FFF7CC";
assumptions.getRange("B5:E12").format.numberFormat = "0.00";

title(
  detail,
  "A1:J1",
  "DPV Overseas Lead Generation Cost Detail",
  "Cash-cost view under the approach: internal development, low-cost demo first, production rollout later, public data first."
);
setWidths(detail, [24, 16, 15, 14, 14, 17, 17, 20, 58, 48]);
detail.getRange("A4:J4").values = [[
  "Cost Item",
  "Type",
  "Required",
  "Demo Low",
  "Demo High",
  "Rollout One-Time Low",
  "Rollout One-Time High",
  "Monthly Run Rate",
  "Why This Cost Exists",
  "Saving / Deferral Strategy",
]];
styleHeader(detail.getRange("A4:J4"));

const rows = [
  ["Internal development tools", "Dev tool", "No if existing", 0, 0, 0, 0, "RMB 0 incremental if already available; otherwise actual plan cost", "Used during internal implementation for coding, workflow setup, scripts, and rule testing. This is separate from the system's runtime API cost.", "If already available, mark as an existing tool with no incremental cash cost."],
  ["Cloud server", "Infrastructure", "Yes", 100, 500, 0, 0, "RMB 300-1,000/month", "Runs n8n, PostgreSQL, background jobs, and logs. A small instance is enough for the demo; production can scale later.", "Do not buy an expensive server upfront. Start with an expandable 2C4G/2C8G server plus snapshots."],
  ["PostgreSQL database", "Infrastructure", "Yes", 0, 200, 0, 0, "RMB 0-1,500/month", "Stores leads, product data, scores, email records, and follow-up status.", "For demo and early rollout, keep it on the same server. Move to managed database after data volume and reliability needs grow."],
  ["n8n automation engine", "Software", "Yes", 0, 0, 0, 0, "Self-hosted RMB 0; cloud plan if needed", "Connects public-source research, model analysis, database writes, email drafts, and follow-up tasks into workflows.", "Start with the self-hosted community version. Consider cloud or enterprise plans only after production needs justify it."],
  ["NocoDB / admin interface", "Software", "Recommended", 0, 0, 0, 0, "Self-hosted RMB 0; cloud plan by seats", "Lets sales and operations review leads, scores, product matches, email drafts, and processing status.", "Start self-hosted. Buy a cloud plan only if multi-user collaboration becomes necessary."],
  ["Model API", "Usage-based", "Recommended", 50, 300, 0, 0, "RMB 300-3,000/month", "Used for company classification, website summary, product matching, outreach email generation, and reply-intent detection.", "Run only 50-100 demo leads and cache results. Usage scales with lead volume after rollout."],
  ["Public data collection / search APIs", "Usage-based / optional", "Public sources first", 0, 200, 0, 3000, "RMB 0-3,000/month; paid data source is not the default", "Prioritize public sources such as Google/Bing, public customs data, industry directories, trade-show lists, and company websites.", "Only evaluate paid data services such as Apollo if public-source quality is poor, contacts are missing, or manual efficiency is too low."],
  ["Domain and mailbox accounts", "Infrastructure", "Yes", 50, 300, 300, 1500, "RMB 100-800/month", "Formal outreach needs a dedicated sending domain, mailbox accounts, and DNS setup.", "Demo can use internal testing first. Configure SPF/DKIM/DMARC before formal outreach."],
  ["Email sending service", "Usage-based", "Required for rollout", 0, 50, 0, 0, "RMB 20-300/month", "Supports batch sending, bounce processing, and delivery logs. The direct sending cost is low.", "Start with low volume. Set daily caps for production to protect domain reputation."],
  ["Email validation", "Usage-based", "Recommended", 20, 200, 0, 0, "RMB 100-1,000/month", "Validates recipient emails and reduces bounce rate.", "Use lightly in the demo; batch-validate before formal sending."],
  ["Backup / object storage / logs", "Operations", "Recommended", 20, 100, 0, 0, "RMB 100-500/month", "Stores imported data, run logs, exports, and database backups.", "For demo, use basic snapshots only. Add automated backup policy after rollout."],
  ["Monitoring and alerts", "Operations", "Later", 0, 100, 0, 0, "RMB 100-500/month", "Detects workflow failures, API failures, email issues, and server resource shortages.", "Simple logs are enough for demo. Add alerts after production rollout."],
  ["Compliance, unsubscribe, bounce, and stop controls", "Rollout build", "Required for rollout", 0, 0, 1000, 5000, "Usually included in maintenance", "Automated outreach must support unsubscribe, bounce handling, sending caps, approval gates, and exception stops.", "Demo can show the rule design. Production should implement these controls before live automation."],
  ["Outsourced development / implementation", "Labor", "No", 0, 0, 0, 0, "RMB 0", "This project will be built in-house, so outsourced implementation is not included as a cash budget item.", "Track internal time separately if needed, but do not include it in the management cash-cost budget."],
];
detail.getRange(`A5:J${4 + rows.length}`).values = rows;
styleBody(detail.getRange(`A5:J${4 + rows.length}`));
money(detail.getRange(`D5:G${4 + rows.length}`));
detail.getRange(`A5:J${4 + rows.length}`).format.rowHeight = 58;
detail.getRange("A4:J4").format.rowHeight = 34;

title(
  rollout,
  "A1:H1",
  "Rollout Budget View",
  "Management view: validate with low cash cost first, then enter production rollout after the two-week demo passes."
);
setWidths(rollout, [22, 18, 18, 18, 18, 50, 48, 34]);
rollout.getRange("A4:H4").values = [[
  "Stage",
  "One-Time Low",
  "One-Time High",
  "Monthly Low",
  "Monthly High",
  "Stage Objective",
  "Why Not Buy Everything Upfront",
  "Recommended Decision",
]];
styleHeader(rollout.getRange("A4:H4"));
const rolloutRows = [
  ["Two-week demo", 240, 1950, 100, 500, "Validate lead intake, lead scoring, product matching, outreach draft generation, and human approval workflow.", "Only validates the workflow. No need for mass sending, paid data source, or heavy database setup.", "Small server + limited API + public sources."],
  ["Initial MVP / rollout preparation", 1300, 9500, 900, 4200, "Add public data collection, sending domain, dashboard, unsubscribe/bounce/frequency controls, and basic backups.", "Configure the mailbox system after demo results are confirmed. Paid data source is not purchased by default.", "Public data first; open target markets step by step."],
  ["Production operation", 0, 5000, 1020, 11600, "Process 500-2,000 leads from public sources per month with automated first-touch, follow-up, and reply routing.", "Monthly cost grows with lead volume, markets, email validation, and whether paid data is later enabled.", "Scale after monthly review. Keep paid data as a backup option."],
];
rollout.getRange("A5:H7").values = rolloutRows;
styleBody(rollout.getRange("A5:H7"));
money(rollout.getRange("B5:E7"));
rollout.getRange("A5:H7").format.rowHeight = 68;

title(
  summary,
  "A1:H1",
  "DPV Overseas Lead Generation System Cost Budget Summary",
  "Version date 2026-08-20. Basis: in-house development with no external implementation vendor. Outsourced development cost is RMB 0. Budget reflects cash costs only."
);
setWidths(summary, [24, 34, 18, 18, 18, 66, 50, 34]);
summary.getRange("A4:H4").values = [[
  "Stage",
  "One-Time Low",
  "One-Time High",
  "Monthly Low",
  "Monthly High",
  "Management Note",
  "Main Spending Areas",
  "Buy Better Infrastructure Now?",
]];
styleHeader(summary.getRange("A4:H4"));
summary.getRange("A5:H7").values = [
  ["Two-week demo", 240, 1950, 100, 500, "Use a small budget to prove the system can generate useful leads.", "Server, limited API usage, small mailbox/public-source validation.", "No. Defer higher specs."],
  ["Initial MVP / rollout preparation", 1300, 9500, 900, 4200, "Invest in real-market workflow and sending infrastructure after the demo passes.", "Public data collection, sending domain, email validation, dashboard, and frequency controls.", "Medium server is enough; database can still start on the same server."],
  ["Production operation", 0, 5000, 1020, 11600, "Monthly cost grows with lead volume. Paid data source is not the default assumption.", "Public data collection, mailbox system, monitoring, maintenance, and API usage.", "Scale by load. Use managed database only when needed."],
];
styleBody(summary.getRange("A5:H7"));
money(summary.getRange("B5:E7"));
summary.getRange("A5:H7").format.rowHeight = 66;

summary.getRange("A10:B10").values = [["Key Takeaway", "Amount / Explanation"]];
styleHeader(summary.getRange("A10:B10"));
summary.getRange("A11:B15").values = [
  ["Two-week demo cash cost", "Approx. RMB 240-1,950 + server monthly cost RMB 100-500"],
  ["Initial MVP / rollout preparation", "Approx. RMB 1,300-9,500 one-time + RMB 900-4,200/month"],
  ["Production operation", "Approx. RMB 1,020-11,600/month, depending on lead volume and whether paid data is enabled"],
  ["Is API cost high?", "Usually not the largest cost. A demo only runs a small sample, so API usage is typically tens to a few hundred RMB."],
  ["Should we buy a high-spec server upfront?", "No. Start with an expandable server, then upgrade database, queues, and monitoring after data volume becomes stable."],
];
styleBody(summary.getRange("A11:B15"));
summary.getRange("A11:B15").format.rowHeight = 52;

summary.getRange("D10:H10").merge();
summary.getRange("D10:H10").values = [["Management Note"]];
styleHeader(summary.getRange("D10:H10"));
summary.getRange("D11:H15").merge();
summary.getRange("D11:H15").values = [[
  "The project can start with a controlled, low-cost validation stage instead of purchasing the full production stack upfront. The first demo uses a small server, self-hosted n8n/NocoDB, limited API usage, and leads gathered from public sources. Later cost increases mainly come from production email-domain setup, email validation, unsubscribe/bounce/frequency controls, backup, and monitoring. Paid data should remain optional and only be considered if public-source screening does not produce enough usable leads. Implementation is handled in-house, so external development cost is excluded."
]];
summary.getRange("D11:H15").format = {
  fill: "#F7FAFC",
  font: { color: "#1F2933" },
  wrapText: true,
  verticalAlignment: "top",
  borders: { preset: "outside", style: "thin", color: "#CAD6E2" },
};

title(sources, "A1:F1", "Sources And Notes", "Public pricing references are directional. Actual costs should follow checkout pages or procurement contracts.");
setWidths(sources, [24, 48, 32, 30, 20, 54]);
sources.getRange("A4:F4").values = [["Item", "Source / URL", "Used For", "Basis", "Date", "Notes"]];
styleHeader(sources.getRange("A4:F4"));
const sourceRows = [
  ["Model API pricing", "https://openai.com/api/pricing/", "Model token-based pricing", "Estimated using light to mid-range model usage", today, "The workbook uses RMB buffer ranges rather than binding to one model."],
  ["AWS SES pricing", "https://aws.amazon.com/ses/pricing/", "Email sending and validation", "Per-thousand emails and per-address validation", today, "Sending cost is low; domain reputation and validation matter more."],
  ["n8n pricing", "https://n8n.io/pricing/", "Automation engine", "Self-hosted community version first", today, "Cloud or enterprise plans can be evaluated later."],
  ["NocoDB pricing", "https://www.nocodb.com/pricing", "Admin interface", "Self-hosted community version first", today, "Cloud plan can be considered if multi-user collaboration grows."],
  ["Project proposal", "E:/AI Automatic Lead Generation System/final_updated_v3/DPV International AI-Powered Overseas Lead Generation System Proposal（English）.docx", "Project stage scope", "Demo / MVP / later automation rollout", today, "Budget follows the staged rollout logic in the proposal."],
];
sources.getRange(`A5:F${4 + sourceRows.length}`).values = sourceRows;
styleBody(sources.getRange(`A5:F${4 + sourceRows.length}`));
sources.getRange(`A5:F${4 + sourceRows.length}`).format.rowHeight = 44;

for (const ws of [summary, detail, assumptions, rollout, sources]) {
  ws.freezePanes.freezeRows(4);
  ws.getUsedRange().format.font.name = "Aptos";
}

await fs.mkdir(outputDir, { recursive: true });

for (const [sheetName, fileName] of [
  ["Summary", "preview_summary_en.png"],
  ["Cost_Detail", "preview_detail_en.png"],
  ["Rollout_View", "preview_rollout_en.png"],
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
await output.save(path.join(outputDir, "DPV_Overseas_LeadGen_Cost_Budget_EN.xlsx"));
console.log(path.join(outputDir, "DPV_Overseas_LeadGen_Cost_Budget_EN.xlsx"));
