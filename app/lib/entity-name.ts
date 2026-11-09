/** Normalize canonical entity names without discarding scripts such as Japanese or Korean. */
export function normalizeEntityName(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** True for unfilled names copied from an editable JSON sample. */
export function isTemplateEntityName(value: unknown) {
  const clean = String(value ?? "").trim();
  if (!clean || /^[\[<{(][\s\S]*[\]>})]$/.test(clean)) return true;
  const normalized = normalizeEntityName(clean);
  return /^(?:ten nhan vat|ten boi canh|ten dia diem|character name|canonical character name|canonical location name|sample character|sample location|placeholder|replace with|replace me)\b/.test(normalized)
    || /\b(?:character bible name|location bible name)\b/.test(normalized);
}
