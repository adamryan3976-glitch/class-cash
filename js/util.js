// Shared helpers (no Firebase imports, so this file can be tested in Node).

/** Random, unguessable link code: 16 random bytes → 22 URL-safe characters (~128 bits). */
export function newToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Short random id for grouping transactions. */
export function shortId(n = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/** "5", "$5.50", "1,200" → cents (integer). Returns NaN for junk. */
export function toCents(value) {
  if (value === null || value === undefined) return NaN;
  const s = String(value).replace(/[$,\s]/g, "");
  if (s === "") return NaN;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

/** cents → "$12" or "$12.50" (symbol may be any text, e.g. "₱" or "CC "). */
export function formatMoney(cents, symbol = "$") {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const num = whole.toLocaleString("en-CA") + (frac ? "." + String(frac).padStart(2, "0") : "");
  return (neg ? "−" : "") + symbol + num;
}

export function formatSigned(cents, symbol = "$") {
  return (cents >= 0 ? "+" : "") + formatMoney(cents, symbol);
}

export function formatDate(ms) {
  return new Date(ms).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(ms) {
  return new Date(ms).toLocaleString("en-CA", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

/** Escape text for safe insertion into HTML. */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/**
 * Parse pasted student lines. Accepts:
 *   Jordan L.<TAB>jordan.l@school.ca     (pasted from a spreadsheet)
 *   Jordan L., jordan.l@school.ca
 *   Lee, Jordan, jordan.l@school.ca  (commas inside names are fine)
 *   Jordan                           (email can be added later)
 */
export function parseStudentLines(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let name = line;
    let email = "";
    if (line.includes("\t")) {
      const parts = line.split("\t").map((p) => p.trim()).filter(Boolean);
      const emailIdx = parts.findIndex((p) => p.includes("@"));
      if (emailIdx >= 0) email = parts.splice(emailIdx, 1)[0];
      name = parts.join(" ");
    } else {
      const m = line.match(/[^\s,;<>]+@[^\s,;<>]+/);
      if (m) {
        email = m[0];
        name = line.replace(m[0], "").replace(/[<>]/g, "");
      }
    }
    name = name.replace(/^[\s,;]+|[\s,;]+$/g, "").replace(/\s+/g, " ");
    if (name) out.push({ displayName: name, email: email.toLowerCase() });
  }
  return out;
}
