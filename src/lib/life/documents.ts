import sharp from "sharp";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { AgentError } from "../agent/contracts.ts";

let ocrBusy = false;
/** Local OCR only: packaged language data, no image upload or runtime model download. */
export async function localOCR(images: Uint8Array[]) {
  if (ocrBusy) throw new AgentError("另一个本机 OCR 正在运行，请稍后重试", 409);
  ocrBusy = true;
  let worker: import("tesseract.js").Worker | undefined;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const langPath = path.join(process.cwd(), ".runtime", "ocr-languages");
    mkdirSync(langPath, { recursive: true });
    for (const lang of ["eng", "chi_sim"]) {
      const file = path.join(langPath, `${lang}.traineddata.gz`);
      if (!existsSync(file))
        copyFileSync(
          path.join(
            process.cwd(),
            "node_modules",
            "@tesseract.js-data",
            lang,
            "4.0.0_best_int",
            `${lang}.traineddata.gz`,
          ),
          file,
        );
    }
    const { createWorker } = await import("tesseract.js");
    const work = (async () => {
      worker = await createWorker(["eng", "chi_sim"], 1, {
        langPath,
        cacheMethod: "none",
        logger: () => {},
        errorHandler: () => {},
      });
      if (cancelled) {
        await worker.terminate();
        throw new AgentError("OCR 已取消");
      }
      const texts: string[] = [];
      for (const bytes of images) {
        const cleaned = await sharp(bytes, { limitInputPixels: 16_000_000 })
          .rotate()
          .flatten({ background: "#fff" })
          .resize({ width: 2000, withoutEnlargement: true })
          .png()
          .toBuffer();
        const { data } = await worker.recognize(cleaned);
        texts.push(data.text);
      }
      return texts.join("\n\n").slice(0, 40000);
    })();
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new AgentError("本机 OCR 超时，请仅上传相关页或手动补充文字"),
            ),
          60000,
        );
      }),
    ]);
  } catch (e) {
    if (e instanceof AgentError) throw e;
    throw new AgentError(
      "本机 OCR 未完成，请使用清晰单页图片、安装完整依赖，或人工补充文字",
    );
  } finally {
    cancelled = true;
    if (timer) clearTimeout(timer);
    if (worker) await worker.terminate().catch(() => {});
    ocrBusy = false;
  }
}
export async function extractManual(
  bytes: Uint8Array,
  name: string,
  ocr = false,
  maxBytes = 8_000_000,
  official = false,
) {
  if (bytes.length > maxBytes) throw new AgentError("说明书需要小于 8MB");
  let text = "",
    usedOCR = false;
  if (/\.pdf$/i.test(name)) {
    if (Buffer.from(bytes).subarray(0, 5).toString() !== "%PDF-")
      throw new AgentError("PDF 文件内容无效");
    const { PDFParse } = await import("pdf-parse"),
      parser = new PDFParse({ data: bytes });
    try {
      // Official text manuals often place charging/maintenance after a long contents section.
      // Keep ingestion bounded, but let retrieval select the relevant later pages.
      text = (await parser.getText({ first: official ? 80 : 20 })).text.slice(
        0,
        official ? 160000 : 40000,
      );
      // PDF page markers are not extracted content.
      if (
        text.replace(/--\s*\d+\s*of\s*\d+\s*--/g, "").trim().length < 10 &&
        ocr
      ) {
        const rendered = await parser.getScreenshot({
          first: official ? 4 : 3,
          desiredWidth: 1600,
          imageDataUrl: false,
        });
        text = await localOCR(rendered.pages.map((p) => p.data));
        usedOCR = true;
      }
    } finally {
      await parser.destroy();
    }
  } else if (/\.(txt|md)$/i.test(name))
    text = new TextDecoder().decode(bytes).slice(0, 40000);
  else if (/\.(png|jpe?g|webp)$/i.test(name) && ocr) {
    text = await localOCR([bytes]);
    usedOCR = true;
  } else throw new AgentError("支持 PDF/TXT/MD；图片说明书请主动勾选本机 OCR");
  text = text.replace(/--\s*\d+\s*of\s*\d+\s*--/g, "").trim();
  if (text.length < 10)
    throw new AgentError(
      ocr
        ? "OCR 未识别到足够文字，请上传更清晰的相关页或手动补充"
        : "未提取到可用文字，可能是扫描 PDF；可勾选本机 OCR 重试或人工补充",
    );
  return {
    title: name.slice(0, 150),
    text,
    kind: "user-manual",
    method: usedOCR ? "local-ocr" : "text-extraction",
    notice: usedOCR
      ? `本机 OCR 完成（扫描 PDF 最多前${official ? 4 : 3}页）；识别可能出错，请逐字核对型号、数字和警告。原文件不保存，也未上传模型。`
      : `已在本机提取前${official ? 80 : 20}页内文字，请核对型号；原文件不保存。`,
  };
}
