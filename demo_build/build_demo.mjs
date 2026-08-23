import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const TMP_DIR = "E:/AI Automatic Lead Generation System/demo_build";
const FINAL_PPTX = "E:/AI Automatic Lead Generation System/management_demo/DPV International AI Overseas B2B Lead Generation Management Demo (English).pptx";
const LOGO = "E:/AI Automatic Lead Generation System/doc_assets/dpv-logo.jpeg";

const W = 1280;
const H = 720;
const C = {
  navy: "#18344D",
  navy2: "#245C82",
  red: "#C92B2B",
  redSoft: "#FBECEC",
  blueSoft: "#EAF3F9",
  green: "#27845C",
  greenSoft: "#EAF5EF",
  amber: "#D18A13",
  amberSoft: "#FFF3D7",
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
  addText(slide, "DPV INTERNATIONAL  |  MANAGEMENT DEMO", 66, 28, 560, 26, {
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

function addArrow(slide, left, top, width, height, color = C.red) {
  return slide.shapes.add({
    geometry: "rightArrow",
    position: { left, top, width, height },
    fill: color,
    line: { style: "solid", fill: color, width: 0 },
  });
}

async function main() {
  await fs.mkdir(path.dirname(FINAL_PPTX), { recursive: true });
  await fs.mkdir(path.join(TMP_DIR, "renders"), { recursive: true });
  const presentation = Presentation.create({ slideSize: { width: W, height: H } });

  // Slide 1
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
    addText(slide, "AI-Powered Overseas\nB2B Lead Generation", 82, 225, 1020, 170, {
      size: 62, bold: true, color: C.navy, valign: "middle", name: "deck-title",
    });
    addText(slide, "Management demo: how DPV identifies importer-wholesalers that supply chain stores", 86, 414, 1020, 78, {
      size: 28, color: C.gray, valign: "middle",
    });
    addRule(slide, 86, 528, 1080, C.line, 1);
    addText(slide, "ILLUSTRATIVE UAE SCENARIO", 86, 555, 340, 34, { size: 17, bold: true, color: C.red, valign: "middle" });
    addText(slide, "B2B scope only  •  Human-approved outreach  •  Eight-week initial delivery", 86, 596, 990, 40, {
      size: 20, color: C.text, valign: "middle",
    });
    notes(slide, [
      "DPV International corporate website and product catalogue: https://dpvinternational.com/",
      "Illustrative demonstration scenario; not actual campaign results.",
    ]);
  }

  // Slide 2
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, 2, "The target is a B2B distributor—not the end consumer");
    // Arrows are placed before nodes so they remain visually behind them.
    addArrow(slide, 360, 281, 92, 36, C.gray2);
    addArrow(slide, 820, 281, 92, 36, C.gray2);
    addBox(slide, "DPV EXPORT\nSUPPLY", 82, 222, 278, 154, { fill: C.blueSoft, line: C.navy2, size: 27 });
    addBox(slide, "IMPORTER / WHOLESALER", 452, 202, 368, 194, { fill: C.amberSoft, line: C.amber, size: 28, color: C.navy });
    addBox(slide, "CHAIN STORES &\nRETAIL NETWORKS", 912, 222, 286, 154, { fill: C.greenSoft, line: C.green, size: 26 });
    addText(slide, "Exports products, catalogues,\nMOQ and trade terms", 92, 405, 258, 74, { size: 19, color: C.gray, align: "center" });
    addText(slide, "Must import, hold stock, distribute\nand supply organized retail", 476, 416, 320, 76, { size: 20, color: C.text, align: "center", bold: true });
    addText(slide, "Provides recurring purchase demand\nand downstream retail coverage", 928, 405, 254, 74, { size: 19, color: C.gray, align: "center" });
    addBox(slide, "CURRENT PHASE: B2B ONLY  |  B2C CUSTOMER ACQUISITION IS OUTSIDE SCOPE", 82, 558, 1116, 68, {
      fill: C.redSoft, line: C.red, color: C.red, size: 21, bold: true,
    });
    notes(slide, [
      "Internal management requirement: current phase targets overseas wholesalers/importers that supply chain stores.",
      "DPV International corporate website: https://dpvinternational.com/",
    ]);
  }

  // Slide 3
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, 3, "Multiple sources become one qualified buyer record");
    const sourceY = [188, 267, 346, 425, 504];
    // Input lines behind all nodes.
    for (const y of sourceY) {
      const sourceCenter = y + 29;
      const dbCenter = 335;
      slide.shapes.add({
        geometry: "line",
        position: {
          left: 352,
          top: Math.min(sourceCenter, dbCenter),
          width: 136,
          height: Math.abs(sourceCenter - dbCenter),
          verticalFlip: sourceCenter > dbCenter,
        },
        fill: "none",
        line: { style: "solid", fill: C.gray2, width: 2 },
      });
    }
    addArrow(slide, 747, 318, 86, 34, C.red);
    addArrow(slide, 1000, 318, 78, 34, C.green);
    const sources = ["Google & Maps", "LinkedIn", "Trade data", "B2B marketplaces", "Exhibitor & supplier lists"];
    sources.forEach((label, i) => addBox(slide, label, 78, sourceY[i], 274, 58, { fill: i % 2 ? C.white : C.blueSoft, line: C.navy2, size: 19 }));
    addBox(slide, "UNIFIED\nLEAD DATABASE", 488, 250, 258, 170, { fill: C.amberSoft, line: C.amber, size: 28, shadow: "shadow-sm" });
    addBox(slide, "AI REVIEW", 833, 250, 168, 170, { fill: C.redSoft, line: C.red, size: 24, color: C.red });
    addBox(slide, "QUALIFIED\nLEAD", 1078, 250, 140, 170, { fill: C.greenSoft, line: C.green, size: 20, color: C.green });
    addText(slide, "Clean • Deduplicate • Verify source", 468, 450, 298, 36, { size: 18, bold: true, color: C.gray, align: "center" });
    addText(slide, "Importer fit\nChain-supply evidence\nProduct match\nDecision-maker quality", 826, 450, 188, 120, { size: 18, color: C.text, align: "center" });
    addText(slide, "Score\nEvidence\nRecommended action", 1068, 450, 160, 104, { size: 18, color: C.text, align: "center" });
    addText(slide, "n8n schedules the workflow; data services and public business sources supply the records; AI interprets and scores them.", 78, 624, 1138, 42, { size: 19, color: C.gray, align: "center", valign: "middle" });
    notes(slide, [
      "n8n documentation: https://docs.n8n.io/",
      "Internal project proposal: multi-platform lead acquisition, verification, scoring and sales routing.",
    ]);
  }

  // Slide 4
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, 4, "In the demo, 100 candidates narrow to 12 sales priorities");
    addText(slide, "Illustrative UAE apparel scenario", 66, 157, 420, 28, { size: 17, bold: true, color: C.red });
    const rows = [
      ["Candidates discovered", 100, C.navy],
      ["Unique companies", 88, C.navy2],
      ["B2B businesses", 70, "#3E789E"],
      ["Verified importer-wholesalers", 59, "#5489A9"],
      ["Chain-store supply fit", 50, C.amber],
      ["Tier A sales priorities", 12, C.red],
    ];
    const startY = 207;
    rows.forEach(([label, value, color], i) => {
      const y = startY + i * 65;
      addText(slide, label, 76, y, 292, 34, { size: 19, bold: i === 5, color: i === 5 ? C.red : C.text, valign: "middle" });
      slide.shapes.add({ geometry: "roundRect", position: { left: 370, top: y + 3, width: 610, height: 28 }, fill: C.light, line: { style: "solid", fill: C.line, width: 0.7 }, borderRadius: "rounded-full" });
      slide.shapes.add({ geometry: "roundRect", position: { left: 370, top: y + 3, width: Math.max(46, 610 * value / 100), height: 28 }, fill: color, line: { style: "solid", fill: color, width: 0 }, borderRadius: "rounded-full" });
      addText(slide, String(value), 994, y - 1, 72, 36, { size: 22, bold: true, color, align: "right", valign: "middle" });
    });
    addBox(slide, "QUALITY\nOVER\nVOLUME", 1068, 238, 154, 168, { fill: C.redSoft, line: C.red, color: C.red, size: 24 });
    addText(slide, "Each removal is traceable: duplicate, non-B2B, weak import evidence, no chain-supply fit, or low priority.", 1054, 434, 180, 130, { size: 17, color: C.gray, align: "center" });
    addText(slide, "Illustrative demonstration data—not actual campaign results", 76, 632, 620, 28, { size: 16, color: C.gray2 });
    notes(slide, [
      "Illustrative demonstration data only; counts are not actual campaign performance.",
      "Internal qualification rules from the DPV overseas B2B lead generation proposal.",
    ]);
  }

  // Slide 5
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, 5, "A qualified lead is evidence-backed and ready for sales");
    addText(slide, "ILLUSTRATIVE BUYER PROFILE", 78, 176, 380, 28, { size: 16, bold: true, color: C.red });
    addText(slide, "Gulf Retail Distribution Co.", 78, 210, 570, 54, { size: 32, bold: true, color: C.navy, valign: "middle" });
    addText(slide, "UAE  |  Dubai  |  Importer / Wholesaler", 78, 268, 550, 36, { size: 21, bold: true, color: C.gray, valign: "middle" });
    addRule(slide, 78, 318, 540, C.line, 1);
    const fields = [
      ["CHAIN-SUPPLY EVIDENCE", "Supplies 80+ supermarkets and department stores"],
      ["DECISION-MAKER", "Category Manager"],
      ["CONTACT", "Verified business email"],
      ["SOURCES", "Corporate website + trade data + LinkedIn"],
    ];
    fields.forEach(([label, value], i) => {
      const y = 340 + i * 67;
      addText(slide, label, 78, y, 222, 24, { size: 15, bold: true, color: C.gray2 });
      addText(slide, value, 286, y - 2, 340, 45, { size: 19, bold: i === 0, color: C.text });
    });
    slide.shapes.add({ geometry: "ellipse", position: { left: 770, top: 190, width: 174, height: 174 }, fill: C.greenSoft, line: { style: "solid", fill: C.green, width: 3 } });
    addText(slide, "93", 786, 218, 142, 74, { size: 54, bold: true, color: C.green, align: "center", valign: "middle" });
    addText(slide, "/100", 812, 288, 90, 34, { size: 20, bold: true, color: C.green, align: "center", valign: "middle" });
    addBox(slide, "TIER A\nPRIORITIZE", 996, 216, 190, 122, { fill: C.redSoft, line: C.red, color: C.red, size: 25 });
    const scores = [
      ["Importer / wholesaler fit", "15 / 15"],
      ["Chain-supply evidence", "15 / 15"],
      ["Product fit", "18 / 20"],
      ["Market, contact and scale", "45 / 50"],
    ];
    scores.forEach(([label, value], i) => {
      const y = 394 + i * 48;
      addText(slide, label, 738, y, 300, 32, { size: 18, color: C.text, valign: "middle" });
      addText(slide, value, 1044, y, 130, 32, { size: 19, bold: true, color: C.navy, align: "right", valign: "middle" });
      addRule(slide, 738, y + 36, 438, C.line, 1);
    });
    addBox(slide, "PRODUCT MATCH  •  Women's apparel 94%  •  Bags 88%", 78, 628, 1108, 48, { fill: C.blueSoft, line: C.navy2, color: C.navy, size: 19 });
    notes(slide, [
      "Illustrative buyer record and score; company name and metrics are demonstration data only.",
      "Internal lead-scoring model: importer-wholesaler fit, chain-supply evidence, product fit, market fit, scale and contact validity.",
    ]);
  }

  // Slide 6
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, 6, "Automation prepares the work; sales retains control");
    const xs = [64, 235, 406, 577, 748, 919, 1090];
    for (let i = 0; i < xs.length - 1; i++) addArrow(slide, xs[i] + 138, 275, 34, 24, C.gray2);
    const steps = [
      ["1", "DISCOVER", "Multiple sources"],
      ["2", "VERIFY", "Clean and deduplicate"],
      ["3", "QUALIFY", "Importer + chain fit"],
      ["4", "MATCH", "Products and market"],
      ["5", "DRAFT", "Email and LinkedIn"],
      ["6", "APPROVE", "Human review"],
      ["7", "MONITOR", "Replies and CRM"],
    ];
    steps.forEach(([n, label, detail], i) => {
      const isGate = i === 5;
      slide.shapes.add({ geometry: "ellipse", position: { left: xs[i] + 48, top: 204, width: 48, height: 48 }, fill: isGate ? C.red : C.navy, line: { style: "solid", fill: isGate ? C.red : C.navy, width: 0 } });
      addText(slide, n, xs[i] + 50, 209, 44, 36, { size: 21, bold: true, color: C.white, align: "center", valign: "middle" });
      addBox(slide, `${label}\n${detail}`, xs[i], 260, 144, 112, { fill: isGate ? C.redSoft : C.white, line: isGate ? C.red : C.line, color: isGate ? C.red : C.navy, size: 18, bold: true });
    });
    addRule(slide, 116, 440, 1048, C.line, 1);
    addBox(slide, "STOP AUTOMATION", 124, 478, 248, 66, { fill: C.redSoft, line: C.red, color: C.red, size: 20 });
    addText(slide, "Reply • Opt-out • Hard bounce • Manual takeover", 392, 480, 330, 62, { size: 19, color: C.text, valign: "middle" });
    addBox(slide, "SALES HANDOFF", 770, 478, 224, 66, { fill: C.greenSoft, line: C.green, color: C.green, size: 20 });
    addText(slide, "High intent • Catalogue • Sample • Quotation", 1006, 480, 218, 62, { size: 18, color: C.text, valign: "middle" });
    addBox(slide, "The system never commits price, payment, contracts or delivery terms without business confirmation.", 124, 594, 1100, 64, { fill: C.amberSoft, line: C.amber, color: C.text, size: 20, bold: true });
    notes(slide, [
      "Internal project proposal: human approval is mandatory in the initial phase; stop rules apply on reply, opt-out, hard bounce or manual takeover.",
      "n8n documentation: https://docs.n8n.io/",
    ]);
  }

  // Slide 7
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, 7, "Eight weeks to a controlled live pilot");
    addText(slide, "Start small. Validate quality. Scale only after evidence.", 66, 158, 840, 36, { size: 22, color: C.gray, valign: "middle" });
    addRule(slide, 126, 323, 1018, C.line, 6);
    const milestones = [
      [2, "WEEK 2", "PROTOTYPE DEMO", "50 sample importer-wholesalers"],
      [4, "WEEK 4", "MVP COMPLETE", "200–500 verified candidates"],
      [5, "WEEK 5", "LIVE PILOT", "~100 approved contacts"],
      [8, "WEEK 8", "ACCEPTANCE", "System, training and handover"],
    ];
    const xPos = [150, 460, 710, 1020];
    milestones.forEach(([week, wlabel, title, detail], i) => {
      slide.shapes.add({ geometry: "ellipse", position: { left: xPos[i], top: 298, width: 56, height: 56 }, fill: i === 2 ? C.red : C.navy, line: { style: "solid", fill: C.white, width: 4 } });
      addText(slide, String(week), xPos[i] + 4, 305, 48, 40, { size: 23, bold: true, color: C.white, align: "center", valign: "middle" });
      addText(slide, wlabel, xPos[i] - 46, 232, 148, 30, { size: 16, bold: true, color: i === 2 ? C.red : C.gray, align: "center" });
      addText(slide, title, xPos[i] - 84, 382, 224, 34, { size: 21, bold: true, color: i === 2 ? C.red : C.navy, align: "center", valign: "middle" });
      addText(slide, detail, xPos[i] - 90, 426, 236, 72, { size: 18, color: C.text, align: "center" });
    });
    addBox(slide, "MANAGEMENT DECISION REQUESTED", 92, 555, 344, 66, { fill: C.red, line: C.red, color: C.white, size: 21 });
    addBox(slide, "Approve Week 1 data access and name one sales owner for review and follow-up.", 436, 555, 752, 66, { fill: C.redSoft, line: C.red, color: C.red, size: 21, bold: true });
    notes(slide, [
      "Internal eight-week implementation plan and milestones from the DPV overseas B2B lead generation proposal.",
      "Illustrative sample volumes for management demonstration and pilot planning.",
    ]);
  }

  // Export slide previews and layout snapshots for QA.
  for (const [index, slide] of presentation.slides.items.entries()) {
    const stem = `slide-${String(index + 1).padStart(2, "0")}`;
    const png = await presentation.export({ slide, format: "png", scale: 1.5 });
    await fs.writeFile(path.join(TMP_DIR, "renders", `${stem}.png`), new Uint8Array(await png.arrayBuffer()));
    const layout = await slide.export({ format: "layout" });
    await fs.writeFile(path.join(TMP_DIR, "renders", `${stem}.layout.json`), await layout.text());
  }
  const montage = await presentation.export({ format: "webp", montage: true, scale: 1 });
  await fs.writeFile(path.join(TMP_DIR, "renders", "deck-montage.webp"), new Uint8Array(await montage.arrayBuffer()));
  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(FINAL_PPTX);
  console.log(FINAL_PPTX);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
