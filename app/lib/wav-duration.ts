import { readFile } from "node:fs/promises";

export function wavDurationMsFromBuffer(bytes: Buffer) {
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") return undefined;
  let byteRate = bytes.readUInt32LE(28);
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    if (chunkId === "fmt " && offset + 16 <= bytes.length) byteRate = bytes.readUInt32LE(offset + 16);
    if (chunkId === "data" && byteRate > 0) {
      return Math.max(1, Math.round((Math.min(chunkSize, bytes.length - offset - 8) / byteRate) * 1000));
    }
    const next = offset + 8 + chunkSize + (chunkSize % 2);
    if (next <= offset || next > bytes.length) break;
    offset = next;
  }
  return undefined;
}

export async function wavDurationMs(filePath: string) {
  try { return wavDurationMsFromBuffer(await readFile(filePath)); } catch { return undefined; }
}
