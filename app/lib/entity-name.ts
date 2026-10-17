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
