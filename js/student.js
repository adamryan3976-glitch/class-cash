import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, onSnapshot, getDoc, collection, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { formatMoney, formatSigned, formatDate, formatDateTime, esc, toCents } from "./util.js";
import { skillTags } from "./skills.js";
import { setAppIcons } from "./app-icons.js";

const $ = (sel) => document.querySelector(sel);
const code = new URLSearchParams(location.search).get("k") || "";

function showError() {
  $("#loading").hidden = true;
  $("#balance-view").hidden = true;
  $("#error").hidden = false;
}

let db = null;
let logoFor = null;   // classId whose logo we've loaded
let logo = "";
let iconName = "Class Cash";
// The home-screen icon must open this student's own private link, so start_url = this exact address.
const updateIcons = () => setAppIcons({ logo, name: iconName, startUrl: location.href });

if (code.length < 20) {
  showError();
} else {
  db = getFirestore(initializeApp(firebaseConfig));
  onSnapshot(doc(db, "shares", code), (snap) => {
    if (!snap.exists()) return showError();
    const d = snap.data();
    render(d);
    renderMinister(d);
    iconName = d.currencyName || "Class Cash";
    updateIcons();
    if (d.classId && d.classId !== logoFor) loadLogo(d.classId);
  }, showError);
}

async function loadLogo(classId) {
  logoFor = classId;
  try {
    const snap = await getDoc(doc(db, "logos", classId));
    const img = $("#logo");
    if (snap.exists() && snap.data().image) {
      logo = snap.data().image;
      img.src = logo;
      img.hidden = false;
    } else {
      logo = "";
      img.hidden = true;
    }
    updateIcons();
  } catch (err) {
    console.warn("Couldn't load class logo", err);
  }
}

function render(d) {
  const symbol = d.symbol || "$";
  $("#loading").hidden = true;
  $("#error").hidden = true;
  $("#balance-view").hidden = false;

  document.title = `${d.displayName} · ${d.currencyName || "Class Cash"}`;
  $("#class-name").textContent = d.className || "";
  $("#student-name").textContent = d.displayName;
  $("#currency").textContent = d.currencyName || "Class Cash";
  const bal = $("#balance");
  bal.textContent = formatMoney(d.balance || 0, symbol);
  bal.classList.toggle("neg", (d.balance || 0) < 0);
  $("#updated").textContent = d.updatedAt ? `Last updated ${formatDateTime(d.updatedAt)}` : "";

  const list = $("#history");
  list.replaceChildren();
  const history = [...(d.history || [])].sort((a, b) => b.t - a.t);
  if (!history.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nothing yet.";
    list.append(li);
    return;
  }
  for (const h of history) {
    const li = document.createElement("li");
    const left = document.createElement("div");
    const note = document.createElement("div");
    const plain = h.a >= 0 ? "Deposit" : "Withdrawal";
    note.textContent = h.n === "Imported (whole class)" ? "Whole class" : h.n && h.n !== "Imported" ? h.n : plain;
    const when = document.createElement("div");
    when.className = "muted small";
    when.textContent = formatDate(h.t);
    if (h.fm) when.textContent += " · 👑 Finance Minister";
    left.append(note, when);
    if (d.showSkills !== false && h.s && h.s.length) {
      const tags = document.createElement("div");
      tags.className = "tags";
      tags.innerHTML = skillTags(h.s, esc);
      left.append(tags);
    }
    const amt = document.createElement("div");
    amt.className = "amt " + (h.a < 0 ? "minus" : "plus");
    amt.textContent = formatSigned(h.a, symbol);
    li.append(left, amt);
    list.append(li);
  }
}

// ---------- FINANCE MINISTER PANEL ----------
// Shown only on the current minister's own page. Names only, never balances. Each entry is sent to the teacher as a
// request; the security rules accept it only with the current minister key and within the teacher's limit.
let share = null;
let rosterKey = "";
const fmSelected = new Set();
const sent = [];

function renderMinister(d) {
  share = d;
  const panel = $("#fm-panel");
  const fm = d.fm;
  if (!fm || !fm.key || !d.classId) {
    panel.hidden = true;
    fmSelected.clear();
    return;
  }
  panel.hidden = false;
  const symbol = d.symbol || "$";
  $("#fm-limit").textContent = `Up to ${formatMoney(fm.max || 0, symbol)} per student each time. Your teacher approves every entry.`;
  const roster = fm.roster || [];
  for (const id of [...fmSelected]) if (!roster.some((r) => r.id === id)) fmSelected.delete(id);
  const key = JSON.stringify(roster);
  if (key !== rosterKey) {
    rosterKey = key;
    drawRoster();
  }
}

function drawRoster() {
  const roster = (share?.fm?.roster || []);
  $("#fm-roster").innerHTML = roster.map((r) => `<button type="button" class="fm-name ${fmSelected.has(r.id) ? "on" : ""}"
    data-id="${esc(r.id)}" aria-pressed="${fmSelected.has(r.id)}">${esc(r.n)}${r.id === share.fm.me ? " (you)" : ""}</button>`).join("");
  $("#fm-picked").textContent = fmSelected.size ? `${fmSelected.size} selected` : "Tap names to choose who";
}

$("#fm-roster").addEventListener("click", (e) => {
  const b = e.target.closest("[data-id]");
  if (!b) return;
  fmSelected.has(b.dataset.id) ? fmSelected.delete(b.dataset.id) : fmSelected.add(b.dataset.id);
  drawRoster();
});
$("#fm-all").addEventListener("click", () => { (share?.fm?.roster || []).forEach((r) => fmSelected.add(r.id)); drawRoster(); });
$("#fm-none").addEventListener("click", () => { fmSelected.clear(); drawRoster(); });
$("#fm-deposit").addEventListener("click", () => sendRequests(+1));
$("#fm-withdraw").addEventListener("click", () => sendRequests(-1));

function fmMessage(text, isError = false) {
  const el = $("#fm-msg");
  el.textContent = text;
  el.className = "small " + (isError ? "error-text" : "fm-ok");
}

async function sendRequests(sign) {
  const fm = share?.fm;
  if (!fm) return;
  const ids = [...fmSelected];
  const cents = toCents($("#fm-amount").value);
  const note = $("#fm-note").value.trim().slice(0, 80);
  if (!ids.length) return fmMessage("Tap at least one name first.", true);
  if (!cents || cents <= 0) return fmMessage("Type an amount.", true);
  if (cents > (fm.max || 0)) return fmMessage(`The most you can enter is ${formatMoney(fm.max, share.symbol || "$")}.`, true);
  const buttons = [$("#fm-deposit"), $("#fm-withdraw")];
  buttons.forEach((b) => (b.disabled = true));
  try {
    const batch = writeBatch(db);
    const col = collection(db, "classes", share.classId, "fmRequests");
    const t = Date.now();
    for (const id of ids) {
      batch.set(doc(col), {
        key: fm.key, studentId: id, amount: sign * cents, note, t,
        ministerId: fm.me, ministerName: String(share.displayName || "").slice(0, 60),
      });
    }
    await batch.commit();
    const names = ids.map((id) => fm.roster.find((r) => r.id === id)?.n || "?");
    sent.unshift({ t, sign, cents, note, names });
    fmSelected.clear();
    $("#fm-amount").value = "";
    $("#fm-note").value = "";
    drawRoster();
    drawSent();
    fmMessage(`Sent to your teacher for approval ✓`);
  } catch (err) {
    console.warn(err);
    fmMessage("That didn't go through. You may not be the Finance Minister any more. Check with your teacher.", true);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

function drawSent() {
  const symbol = share?.symbol || "$";
  $("#fm-sent").innerHTML = sent.length ? `<h3>Sent today</h3><ul>${sent.slice(0, 10).map((x) => `<li>
    <span class="${x.sign < 0 ? "minus" : "plus"}">${esc(formatSigned(x.sign * x.cents, symbol))}</span>
    ${esc(x.names.join(", "))}${x.note ? ` <span class="muted">· ${esc(x.note)}</span>` : ""}
    <span class="muted small">${esc(formatDateTime(x.t))}</span></li>`).join("")}</ul>` : "";
}
