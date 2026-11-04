import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { formatMoney, formatSigned, formatDate, formatDateTime } from "./util.js";

const $ = (sel) => document.querySelector(sel);
const code = new URLSearchParams(location.search).get("k") || "";

function showError() {
  $("#loading").hidden = true;
  $("#balance-view").hidden = true;
  $("#error").hidden = false;
}

if (code.length < 20) {
  showError();
} else {
  const db = getFirestore(initializeApp(firebaseConfig));
  onSnapshot(doc(db, "shares", code), (snap) => {
    if (!snap.exists()) return showError();
    render(snap.data());
  }, showError);
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
    left.append(note, when);
    const amt = document.createElement("div");
    amt.className = "amt " + (h.a < 0 ? "minus" : "plus");
    amt.textContent = formatSigned(h.a, symbol);
    li.append(left, amt);
    list.append(li);
  }
}
