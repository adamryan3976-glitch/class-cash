import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, orderBy, limit, where,
  onSnapshot, writeBatch, increment, arrayUnion, arrayRemove, getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, ALLOWED_DOMAIN } from "./firebase-config.js";
import {
  newToken, shortId, toCents, formatMoney, formatSigned, formatDateTime, esc, parseStudentLines,
} from "./util.js";
import { parseFormResponses, suggestMatch } from "./sheet-import.js";
import { SKILLS, skillName, skillTags, schoolYearStart } from "./skills.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const DEFAULT_SETTINGS = {
  className: "My Class",
  currencyName: "Class Cash",
  symbol: "$",
  quickAmounts: [1, 2, 5, 10, 20],
  allowNegative: false,
  useSkills: true,              // tag deposits/withdrawals with Ontario Learning Skills
  showSkillsToStudents: true,   // show those tags on student pages
};

// ---------- state ----------
let me = null;              // { uid, email }
let classes = [];           // classes I teach: [{ id, className, ownerUid, ownerEmail, memberEmails, ... }]
let classId = null;         // currently open class
let settings = { ...DEFAULT_SETTINGS };
let students = [];          // [{ id, displayName, email, token, balance }]
let transactions = [];      // recent, newest first
let logo = "";              // current class's currency logo (small data: URL) or ""
const selected = new Set();
const selectedSkills = new Set();   // learning skill codes chosen for the next deposit/withdrawal
let classesUnsub = null;
let dataUnsubs = [];
let pendingClassId = null;  // a class we just created, to open once it appears

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const classRef = (id = classId) => doc(db, "classes", id);
const studentRef = (id) => doc(db, "classes", classId, "students", id);
const studentsCol = () => collection(db, "classes", classId, "students");
const txCol = () => collection(db, "classes", classId, "transactions");
const shareRef = (token) => doc(db, "shares", token);
const logoRef = (id = classId) => doc(db, "logos", id);
const byId = (id) => students.find((s) => s.id === id);
const money = (c) => formatMoney(c, settings.symbol);
const currentClass = () => classes.find((c) => c.id === classId);
const isOwner = () => currentClass()?.ownerUid === me?.uid;
const shortEmail = (e) => (e || "").split("@")[0];
const allowedEmail = (e) => !ALLOWED_DOMAIN || (e || "").toLowerCase().endsWith("@" + ALLOWED_DOMAIN.toLowerCase());

function studentLink(token) {
  return new URL(`student.html?k=${encodeURIComponent(token)}`, location.href).href;
}
function appLink() {
  return new URL("index.html", location.href).href;
}

// ---------- UI helpers ----------
let toastTimer;
function toast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), isError ? 6000 : 3000);
}

function busy(on) {
  document.body.classList.toggle("busy", on);
}

async function run(fn, okMsg) {
  busy(true);
  try {
    await fn();
    if (okMsg) toast(typeof okMsg === "function" ? okMsg() : okMsg);
  } catch (err) {
    console.error(err);
    const msg = err.code === "permission-denied"
      ? "You don't have permission to do that in this class."
      : "Something went wrong: " + (err.message || err);
    toast(msg, true);
  } finally {
    busy(false);
  }
}

/** Commit a list of batch operations in chunks (Firestore allows 500 writes per batch). */
async function commitOps(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach((op) => op(batch));
    await batch.commit();
  }
}

function showTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".panel").forEach((p) => p.hidden = p.id !== `panel-${name}`);
  document.body.dataset.tab = name;
}

// ---------- auth ----------
$("#signin").addEventListener("click", async () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters(ALLOWED_DOMAIN ? { prompt: "select_account", hd: ALLOWED_DOMAIN } : { prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
    } else if (err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") {
      toast("Sign-in failed: " + err.message, true);
    }
  }
});
$("#signout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (classesUnsub) classesUnsub();
  classesUnsub = null;
  closeClass();
  classes = [];
  if (!user) {
    me = null;
    $("#signed-out").hidden = false;
    $("#app").hidden = true;
    return;
  }
  if (!allowedEmail(user.email)) {
    me = null;
    $("#signed-out").hidden = false;
    $("#app").hidden = true;
    $("#signin-error").hidden = false;
    $("#signin-error").textContent = `${user.email || "That account"} can't be used. Please sign in with your @${ALLOWED_DOMAIN} account.`;
    signOut(auth);
    return;
  }
  $("#signin-error").hidden = true;
  me = { uid: user.uid, email: (user.email || "").toLowerCase() };
  $("#signed-out").hidden = true;
  $("#app").hidden = false;
  $$(".my-email").forEach((el) => (el.textContent = me.email));

  classesUnsub = onSnapshot(
    query(collection(db, "classes"), where("memberEmails", "array-contains", me.email)),
    { includeMetadataChanges: true },
    (snap) => {
      // Skip a just-created class until the server has saved it; listening to its students
      // before then would be refused by the security rules.
      classes = snap.docs.filter((d) => !d.metadata.hasPendingWrites)
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.className || "").localeCompare(b.className || "", "en", { sensitivity: "base" }));
      onClassesChanged();
    },
    (err) => toast("Couldn't load your classes. Check the Firebase setup (see README). " + err.message, true),
  );
});

// ---------- classes ----------
function onClassesChanged() {
  renderClassPicker();
  if (!classes.length) {
    closeClass();
    $("#no-class").hidden = false;
    $("#class-ui").hidden = true;
    return;
  }
  $("#no-class").hidden = true;
  $("#class-ui").hidden = false;

  const saved = localStorage.getItem(`classcash-class-${me.uid}`);
  const has = (id) => id && classes.some((c) => c.id === id);
  const want = has(pendingClassId) ? pendingClassId : has(classId) ? classId : has(saved) ? saved : classes[0].id;
  if (has(pendingClassId)) pendingClassId = null;

  if (classId && !has(classId)) toast("You're no longer a teacher in that class.", true);
  if (want !== classId) openClass(want);
  else {
    settings = { ...DEFAULT_SETTINGS, ...currentClass() };
    renderSettings();
    renderTeachers();
    renderAll();
  }
}

function renderClassPicker() {
  const sel = $("#class-picker");
  sel.innerHTML = classes.map((c) =>
    `<option value="${esc(c.id)}">${esc(c.className)}${c.ownerUid === me.uid ? "" : " (co-teacher)"}</option>`).join("") +
    `<option value="__new">+ New class…</option>`;
  sel.value = classId && classes.some((c) => c.id === classId) ? classId : (classes[0]?.id || "__new");
  sel.hidden = !classes.length;
}

$("#class-picker").addEventListener("change", (e) => {
  const v = e.target.value;
  if (v === "__new") {
    e.target.value = classId || "";
    createClass();
  } else openClass(v);
});
$("#create-first-class").addEventListener("click", () => createClass());

async function createClass() {
  const name = prompt("Name for the new class (e.g. Room 12 or Grade 5 French):", "");
  if (name === null) return;
  const className = name.trim().slice(0, 40) || DEFAULT_SETTINGS.className;
  await run(async () => {
    const ref = doc(collection(db, "classes"));
    pendingClassId = ref.id;
    await setDoc(ref, {
      ...DEFAULT_SETTINGS, className,
      ownerUid: me.uid, ownerEmail: me.email, memberEmails: [me.email], createdAt: Date.now(),
    });
    showTab("students");
  }, `Created ${className}. Add your students to get started.`);
}

function closeClass() {
  dataUnsubs.forEach((u) => u());
  dataUnsubs = [];
  classId = null;
  students = [];
  transactions = [];
  logo = "";
  selected.clear();
  importData = null;
  renderLogo();
}

function openClass(id) {
  closeClass();
  classId = id;
  localStorage.setItem(`classcash-class-${me.uid}`, id);
  settings = { ...DEFAULT_SETTINGS, ...currentClass() };
  renderClassPicker();
  renderSettings();
  renderTeachers();
  renderAll();

  const thisClass = id;
  listen(thisClass, "students", () => studentsCol(), (snap) => {
    students = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "en", { sensitivity: "base" }));
    for (const sid of [...selected]) if (!byId(sid)) selected.delete(sid);
    renderAll();
  });
  listen(thisClass, "logo", () => logoRef(), (snap) => {
    logo = snap.exists() ? snap.data().image || "" : "";
    renderLogo();
    renderBank();
  });
  listen(thisClass, "history", () => query(txCol(), orderBy("t", "desc"), limit(100)), (snap) => {
    transactions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderHistory();
    renderNoteSuggestions();
  });
}

/** Keep a live listener open for the current class, reconnecting automatically if it's refused or drops. */
function listen(forClass, label, makeQuery, onData, attempt = 0) {
  let unsub = () => {};
  const stop = () => unsub();
  dataUnsubs.push(stop);
  unsub = onSnapshot(makeQuery(), (snap) => {
    if (classId !== forClass) return;
    attempt = 0;
    onData(snap);
  }, (err) => {
    console.warn(`Class Cash: ${label} listener stopped`, err);
    if (classId !== forClass) return;
    dataUnsubs = dataUnsubs.filter((u) => u !== stop);
    if (attempt < 5) {
      setTimeout(() => { if (classId === forClass) listen(forClass, label, makeQuery, onData, attempt + 1); },
        1000 * (attempt + 1));
    } else {
      toast(`Lost connection to ${label}. Refresh the page to reconnect.`, true);
    }
  });
}

// ---------- tabs ----------
$$(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

function renderAll() {
  renderBank();
  renderStudents();
  renderHistoryFilter();
  renderHistory();
  renderImportMapping();
  renderReportStudentPicker();
}

// ---------- BANK ----------
$("#bank-search").addEventListener("input", renderBank);
$("#select-all").addEventListener("click", () => {
  visibleStudents().forEach((s) => selected.add(s.id));
  renderBank();
});
$("#select-none").addEventListener("click", () => { selected.clear(); renderBank(); });

function visibleStudents() {
  const q = $("#bank-search").value.trim().toLowerCase();
  return q ? students.filter((s) => s.displayName.toLowerCase().includes(q)) : students;
}

function renderBank() {
  const grid = $("#bank-grid");
  if (!students.length) {
    grid.innerHTML = `<p class="empty">No students yet. Add them on the <button class="link" data-goto="students">Students</button> tab.</p>`;
  } else {
    grid.innerHTML = visibleStudents().map((s) => `
      <button class="card ${selected.has(s.id) ? "selected" : ""} ${s.balance < 0 ? "neg" : ""}" data-id="${esc(s.id)}" aria-pressed="${selected.has(s.id)}">
        <span class="card-name">${esc(s.displayName)}</span>
        <span class="card-bal">${logo ? `<img class="coin" src="${esc(logo)}" alt="">` : ""}${esc(money(s.balance || 0))}</span>
      </button>`).join("");
  }
  const n = selected.size;
  $("#sel-count").textContent = n === 0 ? "Tap students to select"
    : n === students.length ? `Whole class (${n})` : `${n} selected`;
  $("#action-bar").classList.toggle("ready", n > 0);
}

$("#bank-grid").addEventListener("click", (e) => {
  const go = e.target.closest("[data-goto]");
  if (go) return showTab(go.dataset.goto);
  const card = e.target.closest(".card");
  if (!card) return;
  const id = card.dataset.id;
  selected.has(id) ? selected.delete(id) : selected.add(id);
  renderBank();
});

function renderQuickAmounts() {
  $("#quick-amounts").innerHTML = settings.quickAmounts
    .map((a) => `<button type="button" class="chip" data-amt="${a}">${esc(settings.symbol)}${a}</button>`).join("");
}
$("#quick-amounts").addEventListener("click", (e) => {
  const b = e.target.closest("[data-amt]");
  if (b) { $("#amount").value = b.dataset.amt; }
});

function renderSkillChips() {
  const on = settings.useSkills !== false;
  $("#skill-row").hidden = !on;
  $$('.tab[data-tab="skills"]').forEach((t) => (t.hidden = !on));
  if (!on) { selectedSkills.clear(); if (document.body.dataset.tab === "skills") showTab("bank"); }
  $("#skill-chips").innerHTML = SKILLS.map((k) => `
    <button type="button" class="skill-chip ${selectedSkills.has(k.code) ? "on" : ""}" data-skill="${k.code}"
      style="--sk:${k.color}" aria-pressed="${selectedSkills.has(k.code)}" title="${esc(k.behaviours.join("\n"))}">${esc(k.name)}</button>`).join("");
}
$("#skill-chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-skill]");
  if (!b) return;
  const c = b.dataset.skill;
  selectedSkills.has(c) ? selectedSkills.delete(c) : selectedSkills.add(c);
  renderSkillChips();
});

function renderNoteSuggestions() {
  const seen = new Set();
  for (const t of transactions) {
    if (t.note && !t.note.startsWith("Imported")) seen.add(t.note);
    if (seen.size >= 30) break;
  }
  $("#note-list").innerHTML = [...seen].map((n) => `<option value="${esc(n)}">`).join("");
}

$("#deposit").addEventListener("click", () => moveMoney(+1));
$("#withdraw").addEventListener("click", () => moveMoney(-1));

async function moveMoney(sign) {
  const ids = [...selected];
  if (!ids.length) return toast("Select at least one student first.", true);
  const cents = toCents($("#amount").value);
  if (!cents || cents <= 0) return toast("Enter an amount greater than zero.", true);
  const amount = sign * cents;
  const note = $("#note").value.trim().slice(0, 80);

  if (sign < 0 && !settings.allowNegative) {
    const short = ids.map(byId).filter((s) => (s.balance || 0) < cents);
    if (short.length) {
      return toast(`Not enough ${settings.currencyName}: ${short.map((s) => s.displayName).join(", ")}`, true);
    }
  }
  const group = ids.length === students.length && ids.length > 1 ? "whole" : ids.length > 1 ? "group" : "individual";
  const who = ids.length > 1 ? `for ${ids.length} students` : `for ${byId(ids[0]).displayName}`;
  const skills = settings.useSkills !== false ? SKILLS.map((k) => k.code).filter((c) => selectedSkills.has(c)) : [];
  const forSkills = skills.length ? ` (${skills.map(skillName).join(", ")})` : "";
  await run(async () => {
    await applyTransactions(ids.map((id) => ({ studentId: id, amount, note, skills, t: Date.now(), group })));
    selected.clear();
    selectedSkills.clear();
    $("#amount").value = "";
    $("#note").value = "";
    renderBank();
    renderSkillChips();
  }, `${sign > 0 ? "Added" : "Took away"} ${money(cents)} ${who}${forSkills}`);
}

/**
 * Record transactions. Each one writes:
 *   - a private transaction record (teachers of this class only), including who made it
 *   - the student's private balance
 *   - the student's public share page (balance + history), found only by its secret link code
 * Updates to the same student are combined.
 */
async function applyTransactions(list) {
  const batchId = shortId();
  const ops = [];
  const perStudent = new Map();
  for (const tx of list) {
    const s = byId(tx.studentId);
    if (!s) continue;
    const ref = doc(txCol());
    const skills = tx.skills || [];
    const pub = { id: ref.id, a: tx.amount, n: tx.note || "", t: tx.t };
    if (skills.length) pub.s = skills;
    ops.push((b) => b.set(ref, {
      studentId: s.id, amount: tx.amount, note: tx.note || "", skills, t: tx.t, group: tx.group || "individual",
      batchId, pub, by: me.email,
    }));
    const agg = perStudent.get(s.id) || { total: 0, pubs: [] };
    agg.total += tx.amount;
    agg.pubs.push(pub);
    perStudent.set(s.id, agg);
  }
  for (const [sid, agg] of perStudent) {
    const s = byId(sid);
    ops.push((b) => b.update(studentRef(sid), { balance: increment(agg.total) }));
    for (let i = 0; i < agg.pubs.length; i += 200) {
      const chunk = agg.pubs.slice(i, i + 200);
      const total = chunk.reduce((sum, p) => sum + p.a, 0);
      ops.push((b) => b.update(shareRef(s.token), {
        balance: increment(total), history: arrayUnion(...chunk), updatedAt: Date.now(),
      }));
    }
  }
  await commitOps(ops);
}

// ---------- STUDENTS ----------
$("#add-students").addEventListener("click", async () => {
  const rows = parseStudentLines($("#new-students").value);
  if (!rows.length) return toast("Type at least one name.", true);
  const existing = new Set(students.map((s) => s.displayName.toLowerCase()));
  const dupes = rows.filter((r) => existing.has(r.displayName.toLowerCase()));
  if (dupes.length && !confirm(`These names are already in this class:\n${dupes.map((d) => d.displayName).join(", ")}\n\nAdd them again anyway?`)) return;
  await run(async () => {
    await createStudents(rows);
    $("#new-students").value = "";
  }, `Added ${rows.length} student${rows.length === 1 ? "" : "s"}`);
});

async function createStudents(rows) {
  const created = [];
  const ops = [];
  for (const r of rows) {
    const ref = doc(studentsCol());
    const token = newToken();
    const now = Date.now();
    ops.push((b) => b.set(ref, { displayName: r.displayName, email: r.email || "", token, balance: 0, createdAt: now }));
    ops.push((b) => b.set(shareRef(token), {
      classId, displayName: r.displayName, balance: 0, history: [],
      className: settings.className, currencyName: settings.currencyName, symbol: settings.symbol,
      showSkills: settings.useSkills !== false && settings.showSkillsToStudents !== false, updatedAt: now,
    }));
    created.push({ id: ref.id, displayName: r.displayName, email: r.email || "", token, balance: 0 });
  }
  await commitOps(ops);
  // Make new students available right away (the live listener will catch up too).
  for (const c of created) if (!byId(c.id)) students.push(c);
  students.sort((a, b) => a.displayName.localeCompare(b.displayName, "en", { sensitivity: "base" }));
  renderAll();
  return created;
}

function renderStudents() {
  $("#student-count").textContent = students.length ? `(${students.length})` : "";
  const tbody = $("#student-rows");
  if (!students.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty">No students yet.</td></tr>`;
    return;
  }
  const owner = isOwner();
  tbody.innerHTML = students.map((s) => `
    <tr data-id="${esc(s.id)}">
      <td><strong>${esc(s.displayName)}</strong><div class="muted small">${s.email ? esc(s.email) : ""}</div></td>
      <td class="num">${esc(money(s.balance || 0))}</td>
      <td class="actions">
        <button class="small" data-act="copy">Copy link</button>
        <button class="small" data-act="open">Preview</button>
        <details class="more"><summary class="small">More</summary>
          <div class="menu">
            <button class="small" data-act="edit">Edit name / email</button>
            <button class="small" data-act="reset">Reset link</button>
            ${owner ? `<button class="small danger" data-act="delete">Delete student</button>` : ""}
          </div>
        </details>
      </td>
    </tr>`).join("");
}

$("#student-rows").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const s = byId(btn.closest("tr").dataset.id);
  if (!s) return;
  const act = btn.dataset.act;
  if (act === "copy") return copyText(studentLink(s.token), `Copied ${s.displayName}'s link`);
  if (act === "open") return window.open(studentLink(s.token), "_blank", "noopener");
  if (act === "edit") return editStudent(s);
  if (act === "reset") return resetLink(s);
  if (act === "delete") return deleteStudent(s);
});

async function copyText(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    prompt("Copy this:", text);
  }
}

async function editStudent(s) {
  const name = prompt("Display name (what the student sees):", s.displayName);
  if (name === null) return;
  const email = prompt("Student email (optional, only teachers see this):", s.email || "");
  if (email === null) return;
  const displayName = name.trim();
  if (!displayName) return toast("Name can't be blank.", true);
  await run(async () => {
    const b = writeBatch(db);
    b.update(studentRef(s.id), { displayName, email: email.trim() });
    b.update(shareRef(s.token), { displayName });
    await b.commit();
  }, "Saved");
}

async function resetLink(s) {
  if (!confirm(`Reset ${s.displayName}'s link?\n\nTheir old link will stop working right away. You'll need to send them the new one.`)) return;
  await run(async () => {
    const old = await getDoc(shareRef(s.token));
    const token = newToken();
    const b = writeBatch(db);
    b.set(shareRef(token), { ...(old.exists() ? old.data() : {}), classId, displayName: s.displayName,
      balance: s.balance || 0, className: settings.className, currencyName: settings.currencyName, symbol: settings.symbol,
      showSkills: settings.useSkills !== false && settings.showSkillsToStudents !== false,
      history: old.exists() ? old.data().history || [] : [], updatedAt: Date.now() });
    if (old.exists()) b.delete(shareRef(s.token));
    b.update(studentRef(s.id), { token });
    await b.commit();
    s.token = token;
  }, `New link made for ${s.displayName}. Copy it and share it with them.`);
}

async function deleteStudent(s) {
  if (!confirm(`Delete ${s.displayName}?\n\nThis removes their balance, history and link. It can't be undone.`)) return;
  await run(async () => {
    const txSnap = await getDocs(query(txCol(), where("studentId", "==", s.id)));
    const ops = txSnap.docs.map((d) => (b) => b.delete(d.ref));
    ops.push((b) => b.delete(shareRef(s.token)));
    ops.push((b) => b.delete(studentRef(s.id)));
    await commitOps(ops);
    selected.delete(s.id);
  }, `Deleted ${s.displayName}`);
}

$("#copy-all-links").addEventListener("click", () => {
  if (!students.length) return;
  const text = ["Name\tEmail\tLink", ...students.map((s) => `${s.displayName}\t${s.email || ""}\t${studentLink(s.token)}`)].join("\n");
  copyText(text, "Copied all links. Paste into a spreadsheet, keep it private.");
});

// ---------- HISTORY ----------
$("#history-filter").addEventListener("change", renderHistory);

function renderHistoryFilter() {
  const sel = $("#history-filter");
  const cur = sel.value;
  sel.innerHTML = `<option value="">All students</option>` +
    students.map((s) => `<option value="${esc(s.id)}">${esc(s.displayName)}</option>`).join("");
  sel.value = byId(cur) ? cur : "";
}

function renderHistory() {
  const f = $("#history-filter").value;
  const list = f ? transactions.filter((t) => t.studentId === f) : transactions;
  const tbody = $("#history-rows");
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">No transactions yet.</td></tr>`;
    return;
  }
  const label = { whole: "Whole class", group: "Group" };
  tbody.innerHTML = list.map((t) => {
    const s = byId(t.studentId);
    return `<tr data-id="${esc(t.id)}">
      <td class="small">${esc(formatDateTime(t.t))}</td>
      <td>${s ? esc(s.displayName) : "<em>deleted</em>"}</td>
      <td class="num ${t.amount < 0 ? "minus" : "plus"}">${esc(formatSigned(t.amount, settings.symbol))}</td>
      <td class="small">${esc(t.note)} ${skillTags(t.skills, esc)}${label[t.group] ? ` <span class="tag">${label[t.group]}</span>` : ""}</td>
      <td class="small muted" title="${esc(t.by || "")}">${esc(t.by === me.email ? "you" : shortEmail(t.by))}</td>
      <td><button class="small" data-act="undo" title="Delete this transaction">Undo</button></td>
    </tr>`;
  }).join("");
}

$("#history-rows").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act='undo']");
  if (!btn) return;
  const tx = transactions.find((t) => t.id === btn.closest("tr").dataset.id);
  if (!tx) return;
  const s = byId(tx.studentId);
  if (!confirm(`Undo ${formatSigned(tx.amount, settings.symbol)} for ${s ? s.displayName : "this student"}?`)) return;
  await run(async () => {
    const b = writeBatch(db);
    b.delete(doc(txCol(), tx.id));
    if (s) {
      b.update(studentRef(s.id), { balance: increment(-tx.amount) });
      b.update(shareRef(s.token), { balance: increment(-tx.amount), history: arrayRemove(tx.pub), updatedAt: Date.now() });
    }
    await b.commit();
  }, "Transaction removed");
});

// ---------- SETTINGS ----------
function renderSettings() {
  const owner = isOwner();
  $("#set-class").value = settings.className;
  $("#set-currency").value = settings.currencyName;
  $("#set-symbol").value = settings.symbol;
  $("#set-quick").value = settings.quickAmounts.join(", ");
  $("#set-negative").checked = !!settings.allowNegative;
  $("#set-skills").checked = settings.useSkills !== false;
  $("#set-skills-students").checked = settings.showSkillsToStudents !== false;
  $("#set-skills-students").closest("label").hidden = settings.useSkills === false;
  $$("#settings-form input, #settings-form button, #logo-box input, #logo-box button").forEach((el) => (el.disabled = !owner));
  $("#settings-owner-note").hidden = owner;
  $("#delete-class-box").hidden = !owner;
  $("#class-title").textContent = settings.className;
  renderQuickAmounts();
  renderSkillChips();
}

$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isOwner()) return;
  const next = {
    className: $("#set-class").value.trim().slice(0, 40) || DEFAULT_SETTINGS.className,
    currencyName: $("#set-currency").value.trim() || DEFAULT_SETTINGS.currencyName,
    symbol: $("#set-symbol").value.trim().slice(0, 4) || "$",
    quickAmounts: $("#set-quick").value.split(/[,\s]+/).map(Number).filter((n) => n > 0).slice(0, 8),
    allowNegative: $("#set-negative").checked,
    useSkills: $("#set-skills").checked,
    showSkillsToStudents: $("#set-skills-students").checked,
  };
  if (!next.quickAmounts.length) next.quickAmounts = DEFAULT_SETTINGS.quickAmounts;
  await run(async () => {
    const ops = [(b) => b.update(classRef(), next)];
    const shared = ["className", "currencyName", "symbol", "useSkills", "showSkillsToStudents"];
    if (shared.some((k) => next[k] !== settings[k])) {
      for (const s of students) {
        ops.push((b) => b.update(shareRef(s.token), {
          className: next.className, currencyName: next.currencyName, symbol: next.symbol,
          showSkills: next.useSkills && next.showSkillsToStudents,
        }));
      }
    }
    await commitOps(ops);
    settings = { ...settings, ...next };
    renderSettings();
    renderAll();
  }, "Settings saved");
});

// ---------- TEACHERS (sharing a class) ----------
function renderTeachers() {
  const c = currentClass();
  if (!c) return;
  const owner = isOwner();
  const emails = [...(c.memberEmails || [])].sort((a, b) =>
    (a === c.ownerEmail ? -1 : b === c.ownerEmail ? 1 : a.localeCompare(b)));
  $("#teacher-rows").innerHTML = emails.map((e) => {
    const tags = [e === c.ownerEmail ? "owner" : "", e === me.email ? "you" : ""].filter(Boolean).join(", ");
    const canRemove = owner && e !== c.ownerEmail;
    return `<li data-email="${esc(e)}">
      <span>${esc(e)} ${tags ? `<span class="tag">${tags}</span>` : ""}</span>
      <span class="actions">
        ${canRemove ? `<button class="small" data-act="invite">Copy invite</button>
                       <button class="small danger" data-act="remove">Remove</button>` : ""}
      </span></li>`;
  }).join("");
  $("#add-teacher-form").hidden = !owner;
  $("#leave-class").hidden = owner;
}

$("#add-teacher-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isOwner()) return;
  const email = $("#teacher-email").value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast("Enter a full email address.", true);
  if (!allowedEmail(email)) return toast(`Teachers need an @${ALLOWED_DOMAIN} email address.`, true);
  if ((currentClass().memberEmails || []).includes(email)) return toast("That teacher is already in this class.", true);
  await run(async () => {
    await updateDoc(classRef(), { memberEmails: arrayUnion(email) });
    $("#teacher-email").value = "";
  }, `Added ${email}. Use "Copy invite" to send them a message.`);
});

$("#teacher-rows").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const email = btn.closest("li").dataset.email;
  if (btn.dataset.act === "invite") {
    copyText(`Hi,\n\nI've added you as a teacher for ${settings.className} on Class Cash, so you can add and take away ${settings.currencyName}.\n\nOpen ${appLink()} and sign in with this Google account (${email}). The class will be in the class menu at the top.\n`, `Copied an invite for ${email}. Paste it into a message to them.`);
  } else if (btn.dataset.act === "remove") {
    if (!confirm(`Remove ${email} from ${settings.className}?\n\nThey will no longer be able to see or change this class. Transactions they made stay in the history.`)) return;
    await run(() => updateDoc(classRef(), { memberEmails: arrayRemove(email) }), `Removed ${email}`);
  }
});

$("#leave-class").addEventListener("click", async () => {
  if (!confirm(`Leave ${settings.className}?\n\nYou won't be able to see it any more unless the owner adds you again.`)) return;
  const name = settings.className;
  await run(async () => {
    await updateDoc(classRef(), { memberEmails: arrayRemove(me.email) });
    closeClass();
  }, `You left ${name}`);
});

$("#delete-class").addEventListener("click", async () => {
  if (!isOwner()) return;
  const name = prompt(`This permanently deletes ${settings.className}: every student, balance, link and transaction, for all teachers.\n\nType the class name to confirm:`);
  if (name === null) return;
  if (name.trim() !== settings.className) return toast("The name didn't match, so nothing was deleted.", true);
  const id = classId;
  await run(async () => {
    const [stuSnap, txSnap] = await Promise.all([getDocs(studentsCol()), getDocs(txCol())]);
    const ops = [];
    txSnap.docs.forEach((d) => ops.push((b) => b.delete(d.ref)));
    stuSnap.docs.forEach((d) => {
      ops.push((b) => b.delete(shareRef(d.data().token)));
      ops.push((b) => b.delete(d.ref));
    });
    await commitOps(ops);
    closeClass();
    await commitOps([(b) => b.delete(logoRef(id)), (b) => b.delete(classRef(id))]);
    showTab("bank");
  }, "Class deleted");
});

// ---------- SKILLS REPORT ----------
// Reads the full transaction log for the chosen dates (the History tab only keeps the latest 100).
const dateInput = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function parseDateInput(v, endOfDay) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
  if (!m) return null;
  return endOfDay ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999).getTime() : new Date(+m[1], +m[2] - 1, +m[3]).getTime();
}
$("#report-from").value = dateInput(schoolYearStart());
$("#report-to").value = dateInput(new Date());

function renderReportStudentPicker() {
  const sel = $("#report-student");
  const cur = sel.value;
  sel.innerHTML = `<option value="">Whole class overview</option>` +
    students.map((s) => `<option value="${esc(s.id)}">${esc(s.displayName)}</option>`).join("");
  sel.value = byId(cur) ? cur : "";
}

["#report-student", "#report-from", "#report-to"].forEach((id) => $(id).addEventListener("change", loadReport));
$$('.tab[data-tab="skills"]').forEach((t) => t.addEventListener("click", loadReport));
$("#report-print").addEventListener("click", () => window.print());
$("#skills-report").addEventListener("click", (e) => {
  const b = e.target.closest("[data-student]");
  if (b) { $("#report-student").value = b.dataset.student; loadReport(); }
});

let reportSeq = 0;
async function loadReport() {
  if (!classId) return;
  const seq = ++reportSeq;
  const from = parseDateInput($("#report-from").value, false) ?? 0;
  const to = parseDateInput($("#report-to").value, true) ?? Date.now();
  const sid = $("#report-student").value;
  const out = $("#skills-report");
  out.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const q = sid ? query(txCol(), where("studentId", "==", sid)) : query(txCol(), where("t", ">=", from), where("t", "<=", to));
    const snap = await getDocs(q);
    if (seq !== reportSeq) return;
    const txs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((t) => t.t >= from && t.t <= to)
      .sort((a, b) => a.t - b.t);
    out.innerHTML = sid ? studentReportHtml(byId(sid), txs, from, to) : classReportHtml(txs, from, to);
  } catch (err) {
    console.error(err);
    if (seq === reportSeq) out.innerHTML = `<p class="error-text">Couldn't load the report: ${esc(err.message)}</p>`;
  }
}

const rangeText = (from, to) => `${formatDateOnly(from)} – ${formatDateOnly(to)}`;
function formatDateOnly(ms) {
  return new Date(ms).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function studentReportHtml(s, txs, from, to) {
  if (!s) return "";
  const rows = SKILLS.map((k) => {
    const list = txs.filter((t) => (t.skills || []).includes(k.code));
    const plus = list.filter((t) => t.amount > 0), minus = list.filter((t) => t.amount < 0);
    return { k, list, plus, minus, net: list.reduce((n, t) => n + t.amount, 0) };
  });
  const untagged = txs.filter((t) => !(t.skills || []).length && !String(t.note).startsWith("Imported"));
  const summary = `
    <table class="report-summary">
      <thead><tr><th>Learning skill</th><th class="num">Deposits</th><th class="num">Withdrawals</th><th class="num">Net</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><span class="skill-dot" style="--sk:${r.k.color}"></span>${esc(r.k.name)}</td>
        <td class="num plus">${r.plus.length ? `${r.plus.length} <span class="muted small">(${esc(money(r.plus.reduce((n, t) => n + t.amount, 0)))})</span>` : "–"}</td>
        <td class="num minus">${r.minus.length ? `${r.minus.length} <span class="muted small">(${esc(money(-r.minus.reduce((n, t) => n + t.amount, 0)))})</span>` : "–"}</td>
        <td class="num">${r.list.length ? esc(formatSigned(r.net, settings.symbol)) : "–"}</td></tr>`).join("")}
      </tbody></table>`;
  const entry = (t, here) => `<li><span class="when">${esc(formatDateOnly(t.t))}</span>
      <span class="num ${t.amount < 0 ? "minus" : "plus"}">${esc(formatSigned(t.amount, settings.symbol))}</span>
      <span class="what">${t.note ? esc(t.note) : `<span class="muted">${t.amount < 0 ? "Withdrawal" : "Deposit"}</span>`}
      ${(t.skills || []).some((c) => c !== here) ? `<span class="muted small">· ${here ? "also " : ""}${esc(t.skills.filter((c) => c !== here).map(skillName).join(", "))}</span>` : ""}</span>
      <span class="muted small by">${esc(shortEmail(t.by))}</span></li>`;
  const sections = rows.filter((r) => r.list.length).map((r) => `
    <section class="skill-section" style="--sk:${r.k.color}">
      <h3>${esc(r.k.name)} <span class="muted small">${r.plus.length} deposit${r.plus.length === 1 ? "" : "s"}, ${r.minus.length} withdrawal${r.minus.length === 1 ? "" : "s"}</span></h3>
      <ul class="report-list">${[...r.list].reverse().map((t) => entry(t, r.k.code)).join("")}</ul>
    </section>`).join("");
  return `
    <div class="report-head">
      <h2>${esc(s.displayName)}: learning skills</h2>
      <p class="muted small">${esc(settings.className)} · ${esc(rangeText(from, to))} · ${txs.length} transaction${txs.length === 1 ? "" : "s"}, current balance ${esc(money(s.balance || 0))}</p>
    </div>
    ${summary}
    ${sections || `<p class="empty">No learning skills recorded for ${esc(s.displayName)} in these dates.</p>`}
    ${untagged.length ? `<details class="untagged"><summary>${untagged.length} transaction${untagged.length === 1 ? "" : "s"} with no learning skill</summary>
      <ul class="report-list">${[...untagged].reverse().map((t) => entry(t, "")).join("")}</ul></details>` : ""}`;
}

function classReportHtml(txs, from, to) {
  if (!students.length) return `<p class="empty">No students yet.</p>`;
  const cell = (sid, code) => {
    const list = txs.filter((t) => t.studentId === sid && (t.skills || []).includes(code));
    const p = list.filter((t) => t.amount > 0).length, m = list.filter((t) => t.amount < 0).length;
    if (!p && !m) return `<td class="num muted">–</td>`;
    return `<td class="num">${p ? `<span class="plus">▲${p}</span>` : ""} ${m ? `<span class="minus">▼${m}</span>` : ""}</td>`;
  };
  return `
    <div class="report-head">
      <h2>${esc(settings.className)}: learning skills overview</h2>
      <p class="muted small">${esc(rangeText(from, to))} · ▲ deposits, ▼ withdrawals tagged with each skill. Tap a name for details.</p>
    </div>
    <div class="table-wrap"><table class="overview">
      <thead><tr><th>Student</th>${SKILLS.map((k) => `<th class="num" title="${esc(k.name)}"><span class="skill-dot" style="--sk:${k.color}"></span>${esc(k.short)}</th>`).join("")}</tr></thead>
      <tbody>${students.map((s) => `<tr><td><button class="link" data-student="${esc(s.id)}">${esc(s.displayName)}</button></td>${SKILLS.map((k) => cell(s.id, k.code)).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
}

$("#skills-reference").innerHTML = SKILLS.map((k) => `
  <div class="ref-skill" style="--sk:${k.color}"><h4>${esc(k.name)}</h4>
  <ul>${k.behaviours.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>`).join("");

// ---------- CURRENCY LOGO ----------
function renderLogo() {
  const has = !!logo;
  $("#logo-preview").hidden = !has;
  $("#logo-empty").hidden = has;
  $("#logo-remove").hidden = !has;
  if (has) $("#logo-preview").src = logo;
  const top = $("#top-logo");
  top.hidden = !has;
  if (has) top.src = logo;
}

/** Shrink an image file to a small square-ish logo and return it as a data: URL (well under 150 KB). */
async function makeLogo(file) {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file (PNG, JPG, GIF, WebP or SVG).");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That image couldn't be opened. Try saving it as a PNG or JPG."));
      i.src = url;
    });
    for (const size of [256, 192, 128, 96]) {
      const w0 = img.naturalWidth || size, h0 = img.naturalHeight || size;
      const scale = Math.min(1, size / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      let data = canvas.toDataURL("image/webp", 0.85);
      if (!data.startsWith("data:image/webp")) data = canvas.toDataURL("image/png");
      if (data.length < 150000) return data;
    }
    throw new Error("That image is too detailed to use as a logo. Try a simpler or smaller image.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

$("#logo-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !isOwner()) return;
  await run(async () => {
    const image = await makeLogo(file);
    await setDoc(logoRef(), { image, updatedAt: Date.now() });
    logo = image;
    renderLogo();
    renderBank();
  }, "Logo saved. Students will see it on their balance page.");
});

$("#logo-remove").addEventListener("click", async () => {
  if (!isOwner() || !confirm("Remove this class's logo?")) return;
  await run(async () => {
    await commitOps([(b) => b.delete(logoRef())]);
    logo = "";
    renderLogo();
    renderBank();
  }, "Logo removed");
});

// ---------- IMPORT ----------
let importData = null;

$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    importData = parseFormResponses(await file.text());
    renderImportMapping();
  } catch (err) {
    importData = null;
    renderImportMapping();
    toast(err.message, true);
  }
});

function renderImportMapping() {
  const box = $("#import-preview");
  if (!importData) { box.hidden = true; $("#import-file").value = ""; return; }
  box.hidden = false;
  const whole = importData.entries.filter((e) => e.kind === "whole");
  const wholeTotal = whole.reduce((s, e) => s + e.cents, 0);
  $("#import-summary").innerHTML = `
    Found <strong>${importData.entries.length}</strong> transactions for <strong>${importData.names.length}</strong> names,
    including <strong>${whole.length}</strong> whole-class entries (${esc(formatSigned(wholeTotal, settings.symbol))} for every student in total).
    ${importData.skipped ? `${importData.skipped} blank rows were skipped.` : ""}`;

  const prev = Object.fromEntries($$("#import-rows select").map((s) => [s.dataset.name, s.value]));
  const options = (chosen) => `<option value="">— skip —</option><option value="__new" ${chosen === "__new" ? "selected" : ""}>+ Add as a new student</option>` +
    students.map((s) => `<option value="${esc(s.id)}" ${chosen === s.id ? "selected" : ""}>${esc(s.displayName)}</option>`).join("");
  $("#import-rows").innerHTML = importData.names.map((name) => {
    const count = importData.entries.filter((e) => e.name === name).length;
    const chosen = prev[name] ?? (suggestMatch(name, students) || (students.length ? "" : "__new"));
    return `<tr><td>${esc(name)} <span class="muted small">(${count})</span></td>
      <td><select data-name="${esc(name)}">${options(chosen)}</select></td></tr>`;
  }).join("");
}

$("#run-import").addEventListener("click", async () => {
  if (!importData) return;
  const mapping = Object.fromEntries($$("#import-rows select").map((s) => [s.dataset.name, s.value]));
  const skipped = Object.values(mapping).filter((v) => !v).length;
  const used = Object.values(mapping).filter((v) => v && v !== "__new");
  if (new Set(used).size !== used.length && !confirm("Two sheet names are matched to the same student. Their transactions will be combined. Continue?")) return;
  const hasWhole = importData.entries.some((e) => e.kind === "whole");
  let msg = `Import into ${settings.className} now?`;
  if (hasWhole) msg += "\n\nWhole-class entries go to EVERY student in this class, including anyone added as new below. Make sure your whole class has been added first.";
  if (skipped) msg += `\n\n${skipped} name(s) are set to "skip" and won't be imported.`;
  if (transactions.length) msg += "\n\nThis class already has transactions. Importing the same sheet twice will double the amounts.";
  if (!confirm(msg)) return;

  await run(async () => {
    const newNames = Object.keys(mapping).filter((n) => mapping[n] === "__new");
    if (newNames.length) {
      const created = await createStudents(newNames.map((n) => ({ displayName: n, email: "" })));
      newNames.forEach((n, i) => (mapping[n] = created[i].id));
    }
    const everyone = students.map((s) => s.id);
    const list = [];
    for (const e of importData.entries) {
      if (e.kind === "whole") {
        for (const id of everyone) list.push({ studentId: id, amount: e.cents, note: "Imported (whole class)", t: e.t, group: "whole" });
      } else if (mapping[e.name]) {
        list.push({ studentId: mapping[e.name], amount: e.cents, note: "Imported", t: e.t, group: "individual" });
      }
    }
    await applyTransactions(list);
    importData = null;
    renderImportMapping();
    showTab("bank");
  }, "Import finished. Check a few balances against your old sheet.");
});

showTab("bank");
