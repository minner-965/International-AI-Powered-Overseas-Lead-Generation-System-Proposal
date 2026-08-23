import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const TMP_DIR = "E:/AI Automatic Lead Generation System/n8n_edit_build";
const FINAL_PPTX = "E:/AI Automatic Lead Generation System/management_demo/DPV International n8n Overseas B2B Lead Generation Workflow Demo (English).pptx";
const LOGO = "E:/AI Automatic Lead Generation System/doc_assets/dpv-logo.jpeg";
const W = 1280;
const H = 720;

const C = {
  navy: "#18344D",
  navy2: "#245C82",
  red: "#C92B2B",
  redSoft: "#FBECEC",
  blue: "#3377A3",
  blueSoft: "#EAF3F9",
  green: "#27845C",
  greenSoft: "#EAF5EF",
  amber: "#D18A13",
  amberSoft: "#FFF3D7",
  purple: "#7659A7",
  purpleSoft: "#F1ECF8",
  text: "#1F2933",
  gray: "#66727F",
  gray2: "#8793A0",
  line: "#D7DEE5",
  light: "#F6F8FA",
  white: "#FFFFFF",
};

function addText(slide, text, left, top, width, height, opts = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    name: opts.name,
    position: { left, top, width, height },
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  shape.text = text;
  shape.text.style = {
    fontSize: opts.size ?? 22,
    bold: opts.bold ?? false,
    color: opts.color ?? C.text,
    alignment: opts.align ?? "left",
    verticalAlignment: opts.valign ?? "top",
    autoFit: opts.autoFit ?? "shrinkText",
    wrap: "square",
    typeface: "Aptos",
    insets: opts.insets ?? { top: 2, right: 4, bottom: 2, left: 4 },
  };
  return shape;
}

function addBox(slide, text, left, top, width, height, opts = {}) {
  const shape = slide.shapes.add({
    geometry: opts.geometry ?? "roundRect",
    name: opts.name,
    position: { left, top, width, height },
    fill: opts.fill ?? C.white,
    line: { style: "solid", fill: opts.line ?? C.line, width: opts.lineWidth ?? 1.4 },
    borderRadius: opts.radius ?? "rounded-xl",
    shadow: opts.shadow ?? "shadow-none",
  });
  shape.text = text;
  shape.text.style = {
    fontSize: opts.size ?? 20,
    bold: opts.bold ?? true,
    color: opts.color ?? C.navy,
    alignment: opts.align ?? "center",
    verticalAlignment: opts.valign ?? "middle",
    autoFit: "shrinkText",
    wrap: "square",
    typeface: "Aptos",
    insets: opts.insets ?? { top: 8, right: 10, bottom: 8, left: 10 },
  };
  return shape;
}

function addRule(slide, left, top, width, color = C.red, height = 4) {
  return slide.shapes.add({
    geometry: "rect",
    position: { left, top, width, height },
    fill: color,
    line: { style: "solid", fill: color, width: 0 },
  });
}

function addHeader(slide, number, title) {
  addText(slide, "DPV INTERNATIONAL  |  n8n WORKFLOW DEMO", 66, 28, 600, 26, {
    size: 14, bold: true, color: C.gray, valign: "middle",
  });
  addText(slide, String(number).padStart(2, "0"), 1170, 28, 42, 24, {
    size: 14, bold: true, color: C.red, align: "right", valign: "middle",
  });
  addRule(slide, 66, 62, 1148, C.line, 1);
  addText(slide, title, 66, 82, 1148, 60, {
    size: 42, bold: true, color: C.navy, valign: "middle",
  });
  addRule(slide, 66, 144, 116, C.red, 4);
}

function notes(slide, items) {
  slide.speakerNotes.textFrame.setText(`[Sources]\n${items.map((x) => `- ${x}`).join("\n")}`);
}

function addArrow(slide, left, top, width, height, color = C.gray2, direction = "rightArrow") {
  return slide.shapes.add({
    geometry: direction,
    position: { left, top, width, height },
    fill: color,
    line: { style: "solid", fill: color, width: 0 },
  });
}

function addNode(slide, title, detail, left, top, width, height, opts = {}) {
  const fill = opts.fill ?? C.white;
  const line = opts.line ?? C.line;
  addBox(slide, title, left, top, width, height * 0.55, {
    fill,
    line,
    color: opts.color ?? C.navy,
    size: opts.titleSize ?? 19,
    radius: "rounded-xl",
  });
  addText(slide, detail, left + 8, top + height * 0.57, width - 16, height * 0.38, {
    size: opts.detailSize ?? 16,
    color: opts.detailColor ?? C.gray,
    align: "center",
    valign: "middle",
  });
}

async function main() {
  await fs.mkdir(path.dirname(FINAL_PPTX), { recursive: true });
  await fs.mkdir(path.join(TMP_DIR, "final-renders"), { recursive: true });
  const presentation = Presentation.create({ slideSize: { width: W, height: H } });

  // 1. Opening
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addRule(slide, 0, 0, 18, C.red, H);
    const logoBytes = await fs.readFile(LOGO);
    slide.images.add({
      blob: logoBytes.buffer.slice(logoBytes.byteOffset, logoBytes.byteOffset + logoBytes.byteLength),
      contentType: "image/jpeg",
      alt: "DPV International corporate logo",
      fit: "contain",
      position: { left: 82, top: 68, width: 112, height: 112 },
    });
    addText(slide, "DPV INTERNATIONAL", 220, 92, 420, 46, { size: 26, bold: true, color: C.red, valign: "middle" });
    addText(slide, "n8n-Powered Overseas\nB2B Lead Generation", 82, 225, 1060, 170, {
      size: 60, bold: true, color: C.navy, valign: "middle",
    });
    addText(slide, "How the workflow finds, filters, enriches and contacts overseas importer-wholesalers", 86, 414, 1060, 78, {
      size: 27, color: C.gray, valign: "middle",
    });
    addRule(slide, 86, 528, 1080, C.line, 1);
    addText(slide, "MANAGEMENT WORKFLOW DEMONSTRATION", 86, 555, 450, 34, { size: 17, bold: true, color: C.red, valign: "middle" });
    addText(slide, "B2B scope only  •  Human-approved outreach  •  Traceable workflow execution", 86, 596, 1020, 40, {
      size: 20, color: C.text, valign: "middle",
    });
    notes(slide, [
      "DPV International corporate website: https://dpvinternational.com/",
      "n8n official documentation: https://docs.n8n.io/",
    ]);
  }

  // 2. Target buyer
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, 2, "The target is a B2B distributor—not the end consumer");
    addArrow(slide, 360, 281, 92, 36, C.gray2);
    addArrow(slide, 820, 281, 92, 36, C.gray2);
    addBox(slide, "DPV EXPORT\nSUPPLY", 82, 222, 278, 154, { fill: C.blueSoft, line: C.navy2, size: 27 });
    addBox(slide, "IMPORTER / WHOLESALER", 452, 202, 368, 194, { fill: C.amberSoft, line: C.amber, size: 28, color: C.navy });
    addBox(slide, "CHAIN STORES &\nRETAIL NETWORKS", 912, 222, 286, 154, { fill: C.greenSoft, line: C.green, size: 26 });
    addText(slide, "Exports products, catalogues,\nMOQ and trade terms", 92, 405, 258, 74, { size: 19, color: C.gray, align: "center" });
    addText(slide, "Must import, hold stock, distribute\nand supply organized retail", 476, 416, 320, 76, { size: 20, color: C.text, align: "center", bold: true });
    addText(slide, "Provides recurring purchase demand\nand downstream retail coverage", 928, 405, 254, 74, { size: 19, color: C.gray, align: "center" });
    addBox(slide, "CURRENT PHASE: B2B ONLY  |  B2C CUSTOMER ACQUISITION IS OUTSIDE SCOPE", 82, 558, 1116, 68, {
      fill: C.redSoft, line: C.red, color: C.red, size: 21,
    });
    notes(slide, [
      "Internal management requirement: target overseas importer-wholesalers that supply chain stores.",
      "DPV International corporate website: https://dpvinternational.com/",
    ]);
  }

  // 3. What n8n does
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, 3, "n8n connects the workflow; APIs, rules and AI do specialist work");
    const xs = [74, 372, 670, 968];
    for (let i = 0; i < 3; i++) addArrow(slide, xs[i] + 244, 283, 54, 30, C.gray2);
    addNode(slide, "1  TRIGGER & PARAMETERS", "Schedule Trigger\nEdit Fields: country, product, ICP", xs[0], 220, 244, 180, { fill: C.light, line: C.gray2 });
    addNode(slide, "2  ACQUIRE DATA", "HTTP Request\nSearch APIs, directories, trade data", xs[1], 220, 244, 180, { fill: C.blueSoft, line: C.blue });
    addNode(slide, "3  PROCESS & DECIDE", "Code + LLM\nIF, Switch, Merge and scoring", xs[2], 220, 244, 180, { fill: C.purpleSoft, line: C.purple, color: C.purple });
    addNode(slide, "4  ACT & RECORD", "Postgres + CRM\nApproval, email and sales tasks", xs[3], 220, 244, 180, { fill: C.greenSoft, line: C.green, color: C.green });
    addRule(slide, 90, 450, 1100, C.line, 1);
    addText(slide, "n8n", 90, 482, 170, 74, { size: 46, bold: true, color: C.red, align: "center", valign: "middle" });
    addText(slide, "Schedules runs, moves JSON between nodes, applies routing rules and records execution status.", 270, 482, 900, 74, { size: 22, color: C.text, valign: "middle" });
    addBox(slide, "n8n is the conductor—not the customer-data source and not the language model.", 138, 594, 1004, 60, {
      fill: C.amberSoft, line: C.amber, color: C.text, size: 21,
    });
    notes(slide, [
      "n8n official documentation: https://docs.n8n.io/",
      "n8n connects applications and APIs and manipulates data with workflow nodes.",
    ]);
  }

  // 4. Acquisition workflow
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, 4, "Customer acquisition: search to stored company record");
    const topX = [58, 300, 542, 784, 1026];
    const bottomX = [58, 300, 542, 784, 1026];
    for (let i = 0; i < 4; i++) addArrow(slide, topX[i] + 198, 247, 44, 26, C.gray2);
    addArrow(slide, 1100, 336, 28, 56, C.gray2, "downArrow");
    for (let i = 4; i > 0; i--) addArrow(slide, bottomX[i] - 44, 443, 44, 26, C.gray2, "leftArrow");
    const topNodes = [
      ["Schedule Trigger", "Run daily or on demand", C.light, C.gray2],
      ["Edit Fields", "Country • product • buyer ICP", C.light, C.gray2],
      ["LLM Keywords", "Generate multilingual search terms", C.purpleSoft, C.purple],
      ["HTTP Request", "Search API / directory query", C.blueSoft, C.blue],
      ["Split Out", "Create one item per company", C.blueSoft, C.blue],
    ];
    topNodes.forEach(([title, detail, fill, line], i) => addNode(slide, title, detail, topX[i], 196, 198, 120, { fill, line, titleSize: 18, detailSize: 15 }));
    const bottomNodes = [
      ["Postgres Upsert", "Insert or update by domain", C.greenSoft, C.green],
      ["Code: Normalize", "Map fields and source URL", C.purpleSoft, C.purple],
      ["HTML Extract / API", "Company name, description, contacts", C.blueSoft, C.blue],
      ["HTTP Request", "Open public company page", C.blueSoft, C.blue],
      ["Loop Over Items", "Process each candidate", C.light, C.gray2],
    ];
    bottomNodes.forEach(([title, detail, fill, line], i) => addNode(slide, title, detail, bottomX[i], 392, 198, 120, { fill, line, titleSize: 18, detailSize: 15 }));
    addBox(slide, "OUTPUT FIELDS", 68, 563, 188, 54, { fill: C.navy, line: C.navy, color: C.white, size: 19 });
    addBox(slide, "company  |  website  |  country  |  source_url  |  description  |  captured_at", 256, 563, 956, 54, {
      fill: C.blueSoft, line: C.navy2, color: C.navy, size: 18,
    });
    addText(slide, "The source URL is retained so every company can be reviewed and traced.", 68, 635, 1144, 28, { size: 17, color: C.gray, align: "center" });
    notes(slide, [
      "n8n official documentation: https://docs.n8n.io/",
      "Illustrative workflow using common n8n trigger, HTTP request, item processing, code and database operations.",
    ]);
  }

  // 5. Filtering and contact enrichment
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, 5, "Filtering: raw companies become verified, contact-ready sales leads");
    addText(slide, "Illustrative UAE apparel scenario", 66, 157, 420, 28, { size: 17, bold: true, color: C.red });
    const rows = [
      ["Raw company records", 100, C.navy],
      ["Unique domains", 88, C.navy2],
      ["B2B companies", 70, "#3E789E"],
      ["Importer / wholesaler fit", 59, "#5489A9"],
      ["Chain-store supply evidence", 50, C.amber],
      ["Verified decision-makers", 28, C.purple],
      ["Tier A contact-ready leads", 12, C.red],
    ];
    const startY = 198;
    rows.forEach(([label, value, color], i) => {
      const y = startY + i * 54;
      addText(slide, label, 72, y, 300, 30, { size: 18, bold: i === rows.length - 1, color: i === rows.length - 1 ? C.red : C.text, valign: "middle" });
      slide.shapes.add({ geometry: "roundRect", position: { left: 374, top: y + 4, width: 590, height: 24 }, fill: C.light, line: { style: "solid", fill: C.line, width: 0.7 }, borderRadius: "rounded-full" });
      slide.shapes.add({ geometry: "roundRect", position: { left: 374, top: y + 4, width: Math.max(42, 590 * value / 100), height: 24 }, fill: color, line: { style: "solid", fill: color, width: 0 }, borderRadius: "rounded-full" });
      addText(slide, String(value), 975, y - 1, 58, 34, { size: 20, bold: true, color, align: "right", valign: "middle" });
    });
    addBox(slide, "IF / SWITCH\nROUTING", 1056, 232, 166, 116, { fill: C.redSoft, line: C.red, color: C.red, size: 23 });
    addText(slide, "Reject\nEnrich\nScore\nSend to review", 1068, 372, 142, 126, { size: 19, color: C.text, align: "center" });
    addBox(slide, "AI extracts evidence  •  n8n IF/Switch nodes route each item  •  verification services validate business contacts", 72, 600, 1150, 54, {
      fill: C.amberSoft, line: C.amber, color: C.text, size: 18,
    });
    addText(slide, "Illustrative demonstration data—not actual campaign results", 72, 662, 620, 24, { size: 15, color: C.gray2 });
    notes(slide, [
      "Illustrative demonstration counts only; not actual campaign results.",
      "n8n official documentation: https://docs.n8n.io/",
    ]);
  }

  // 6. Contact and reply loop
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, 6, "Contact workflow: approve, send and update CRM");
    const topX = [70, 360, 650, 940];
    const bottomX = [70, 360, 650, 940];
    for (let i = 0; i < 3; i++) addArrow(slide, topX[i] + 230, 250, 60, 28, C.gray2);
    addArrow(slide, 1040, 342, 28, 54, C.gray2, "downArrow");
    for (let i = 3; i > 0; i--) addArrow(slide, bottomX[i] - 60, 446, 60, 28, C.gray2, "leftArrow");
    const top = [
      ["Postgres Query", "Tier A lead + verified contact", C.greenSoft, C.green],
      ["Product Match", "Select relevant DPV categories", C.blueSoft, C.blue],
      ["LLM Draft", "Personalized email / LinkedIn copy", C.purpleSoft, C.purple],
      ["Human Approval", "Approve, edit or reject", C.redSoft, C.red],
    ];
    top.forEach(([title, detail, fill, line], i) => addNode(slide, title, detail, topX[i], 198, 230, 126, { fill, line, color: line, titleSize: 20, detailSize: 16 }));
    const bottom = [
      ["Switch + CRM Update", "Intent, owner, next action, stop status", C.greenSoft, C.green],
      ["Wait + Reply Webhook", "Monitor reply, bounce and opt-out", C.light, C.gray2],
      ["Email / Sales Task", "Send email or create LinkedIn task", C.blueSoft, C.blue],
      ["IF Approved?", "No = stop  •  Yes = continue", C.redSoft, C.red],
    ];
    bottom.forEach(([title, detail, fill, line], i) => addNode(slide, title, detail, bottomX[i], 394, 230, 126, { fill, line, color: line, titleSize: 19, detailSize: 16 }));
    addBox(slide, "STOP", 82, 563, 154, 54, { fill: C.redSoft, line: C.red, color: C.red, size: 20 });
    addText(slide, "Reply • Opt-out • Hard bounce • Rejected approval", 248, 563, 424, 54, { size: 18, color: C.text, valign: "middle" });
    addBox(slide, "SALES HANDOFF", 700, 563, 220, 54, { fill: C.greenSoft, line: C.green, color: C.green, size: 20 });
    addText(slide, "Catalogue • Sample • Quotation • Meeting", 932, 563, 290, 54, { size: 18, color: C.text, valign: "middle" });
    addBox(slide, "Every action keeps the lead ID, source URL, message version and n8n execution log.", 142, 636, 998, 48, {
      fill: C.amberSoft, line: C.amber, color: C.text, size: 19,
    });
    notes(slide, [
      "n8n official documentation: https://docs.n8n.io/",
      "n8n Gmail message operations and approval documentation: https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.gmail/message-operations/",
      "Internal control requirement: human approval before initial outreach; stop on reply, opt-out or hard bounce.",
    ]);
  }

  for (const [index, slide] of presentation.slides.items.entries()) {
    const stem = `slide-${String(index + 1).padStart(2, "0")}`;
    const png = await presentation.export({ slide, format: "png", scale: 1.5 });
    await fs.writeFile(path.join(TMP_DIR, "final-renders", `${stem}.png`), new Uint8Array(await png.arrayBuffer()));
    const layout = await slide.export({ format: "layout" });
    await fs.writeFile(path.join(TMP_DIR, "final-renders", `${stem}.layout.json`), await layout.text());
  }
  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(FINAL_PPTX);
  console.log(FINAL_PPTX);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
