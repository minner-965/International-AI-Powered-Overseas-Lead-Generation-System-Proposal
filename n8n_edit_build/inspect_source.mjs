import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const source = "E:/AI Automatic Lead Generation System/n8n_edit_build/source.pptx";
const out = "E:/AI Automatic Lead Generation System/n8n_edit_build/source-inspect";

await fs.mkdir(out, { recursive: true });
const presentation = await PresentationFile.importPptx(await FileBlob.load(source));
const inspection = await presentation.inspect({
  kind: "slide,textbox,shape,image,notes,layout",
  include: "id,slide,name,title,text,textPreview,bbox,bboxUnit,isPlaceholder,placeholders,alt",
  maxChars: 60000,
});
await fs.writeFile(path.join(out, "source-inspect.ndjson"), inspection.ndjson);
for (const [index, slide] of presentation.slides.items.entries()) {
  const stem = `slide-${String(index + 1).padStart(2, "0")}`;
  const png = await presentation.export({ slide, format: "png", scale: 1.5 });
  await fs.writeFile(path.join(out, `${stem}.png`), new Uint8Array(await png.arrayBuffer()));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(path.join(out, `${stem}.layout.json`), await layout.text());
}
console.log(`slides=${presentation.slides.items.length}`);
