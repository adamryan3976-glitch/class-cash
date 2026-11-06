import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, onSnapshot, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { formatMoney, formatSigned, formatDate, formatDateTime, esc } from "./util.js";
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
