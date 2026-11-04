// Import from the old Google Form / Sheet system ("Form Responses 1" tab, downloaded as CSV).
// Pure functions only, so they can be tested without Firebase.

import { toCents } from "./util.js";

/** Minimal RFC 4180 CSV parser (handles quotes, commas and newlines inside quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** "10/13/2026 12:35:33" (Google Sheets, M/D/YYYY) → epoch ms. */
export function parseSheetDate(value) {
  const m = String(value).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, mo, d, y, h = "0", mi = "0", sec = "0"] = m;
    return new Date(+y, +mo - 1, +d, +h, +mi, +sec).getTime();
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

const isDeposit = (h) => /deposit|\badd\b|^add/.test(h);
const isWithdraw = (h) => /withdraw|subtract/.test(h);

/**
 * Parse the Form Responses CSV.
 * Layout in the existing template: Timestamp, Student, Deposit, Withdraw, Whole Class or Individual?,
 * Deposit (whole class), Withdraw (whole class), ... (later columns are ignored).
 * Returns { entries: [{ t, kind: "whole"|"individual", name, cents }], names: [...], skipped: n }
 */
export function parseFormResponses(text) {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (!rows.length) throw new Error("The file is empty.");
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, " "));

  const tsCol = header.findIndex((h) => h.startsWith("timestamp"));
  const studentCol = header.findIndex((h) => h.startsWith("student"));
  const wholeCol = header.findIndex((h) => h.includes("whole class"));
  if (tsCol < 0 || studentCol < 0) {
    throw new Error('Couldn\'t find the "Timestamp" and "Student" columns. Make sure you downloaded the "Form Responses 1" tab as a CSV.');
  }
  const indEnd = wholeCol >= 0 ? wholeCol : header.length;
  const findCol = (from, to, test) => {
    for (let i = from; i < to; i++) if (test(header[i])) return i;
    return -1;
  };
  const indDep = findCol(studentCol + 1, indEnd, isDeposit);
  const indWd = findCol(studentCol + 1, indEnd, isWithdraw);
  // Whole-class amounts: the deposit/withdraw columns right after the "Whole Class or Individual?" question,
  // stopping at the next "Student" question (which starts a different section, e.g. Pesos).
  let wholeEnd = header.length;
  if (wholeCol >= 0) {
    const nextStudent = header.findIndex((h, i) => i > wholeCol && h.startsWith("student"));
    if (nextStudent > 0) wholeEnd = nextStudent;
  }
  const wDep = wholeCol >= 0 ? findCol(wholeCol + 1, wholeEnd, isDeposit) : -1;
  const wWd = wholeCol >= 0 ? findCol(wholeCol + 1, wholeEnd, isWithdraw) : -1;

  const amount = (row, dep, wd) => {
    const d = dep >= 0 ? toCents(row[dep]) : NaN;
    const w = wd >= 0 ? toCents(row[wd]) : NaN;
    return (Number.isNaN(d) ? 0 : d) - (Number.isNaN(w) ? 0 : w);
  };

  const entries = [];
  const names = new Set();
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const t = parseSheetDate(row[tsCol] ?? "");
    const whole = wholeCol >= 0 && /whole/i.test(row[wholeCol] ?? "");
    if (t === null) { skipped++; continue; }
    if (whole) {
      const cents = amount(row, wDep, wWd);
      if (cents) entries.push({ t, kind: "whole", name: "", cents });
      else skipped++;
    } else {
      const name = (row[studentCol] ?? "").trim();
      const cents = amount(row, indDep, indWd);
      if (name && cents) { entries.push({ t, kind: "individual", name, cents }); names.add(name); }
      else skipped++;
    }
  }
  entries.sort((a, b) => a.t - b.t);
  return { entries, names: [...names].sort((a, b) => a.localeCompare(b)), skipped };
}

const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/**
 * Guess which Class Cash student a sheet name ("Lee, Jordan") belongs to.
 * Matches full name, "Jordan Lee", "Jordan", "Jordan L", "JL". Returns a student id only if exactly one matches.
 */
export function suggestMatch(sheetName, students) {
  let first = sheetName, last = "";
  if (sheetName.includes(",")) {
    const [l, f] = sheetName.split(",");
    first = f.trim(); last = l.trim();
  } else {
    const parts = sheetName.trim().split(/\s+/);
    first = parts[0]; last = parts.slice(1).join(" ");
  }
  const strong = new Set([norm(sheetName), norm(`${first} ${last}`), norm(`${last} ${first}`)]);
  const weak = new Set([norm(first)]);
  if (last) {
    weak.add(norm(`${first} ${last[0]}`));
    weak.add(norm(`${first[0]}${last[0]}`));
  }
  const strongHits = students.filter((s) => strong.has(norm(s.displayName)));
  if (strongHits.length === 1) return strongHits[0].id;
  const weakHits = students.filter((s) => weak.has(norm(s.displayName)));
  if (weakHits.length === 1) return weakHits[0].id;
  return "";
}
