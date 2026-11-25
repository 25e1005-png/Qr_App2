
"use strict";

const STORAGE_KEY = "qrMeishiContacts";
const TRANSFER_KEY = "qrMeishiPendingTransfer";

let contacts = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
let scanner = null;
let pendingDelete = null;
let pendingTimer = null;
let transferPages = [];
let transferPageIndex = 0;
let draggingId = null;

const $ = id => document.getElementById(id);

function saveContacts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function isDuplicateContact(item, list = contacts) {
  return list.some(c => {
    return normalize(c.name) === normalize(item.name) &&
      normalize(c.phone) === normalize(item.phone) &&
      normalize(c.email) === normalize(item.email) &&
      normalize(c.url) === normalize(item.url);
  });
}

function addContact(item) {
  const contact = {
    id: makeId(),
    name: item.name || "名前なし",
    phone: item.phone || "",
    email: item.email || "",
    url: item.url || "",
    group: item.group || "other",
    createdAt: new Date().toISOString(),
    order: contacts.length
  };

  if (isDuplicateContact(contact)) {
    $("status").textContent = "この連絡先はすでに登録されています。";
    return false;
  }

  contacts.push(contact);
  saveContacts();
  refreshApp();
  return true;
}

function parseQRContact(data) {
  data = String(data || "").trim();

  if (data.startsWith("QRMEISHI_PART:") || data.startsWith("QRMEISHI:")) {
    return importTransferData(data);
  }

  if (/^BEGIN:VCARD/i.test(data)) {
    const lines = data.replace(/\r/g, "").split("\n");
    const result = { name: "", phone: "", email: "", url: "" };

    for (const line of lines) {
      const index = line.indexOf(":");
      if (index < 0) continue;

      const key = line.slice(0, index).split(";")[0].toUpperCase();
      const value = line.slice(index + 1).trim();

      if (key === "FN") result.name = value;
      if (key === "TEL") result.phone = value;
      if (key === "EMAIL") result.email = value;
      if (key === "URL") result.url = value;
    }

    if (!result.name) {
      const n = lines.find(line => /^N(?:;[^:]*)?:/i.test(line));
      if (n) {
        result.name = n.substring(n.indexOf(":") + 1)
          .split(";").reverse().filter(Boolean).join(" ");
      }
    }

    return addContact(result);
  }

  if (/^https?:\/\//i.test(data)) {
    return addContact({
      name: data,
      url: data,
      group: "other"
    });
  }

  return addContact({
    name: data,
    group: "other"
  });
}

$("contactForm").addEventListener("submit", event => {
  event.preventDefault();

  const item = {
    name: $("name").value,
    phone: $("phone").value,
    email: $("email").value,
    url: $("url").value,
    group: $("group").value
  };

  if (addContact(item)) {
    event.target.reset();
    $("status").textContent = "連絡先を登録しました。";
  }
});

function refreshApp() {
  renderContacts();
  updateDashboard();
}

function updateDashboard() {
  $("totalCount").textContent = contacts.length;
  $("friendCount").textContent =
    contacts.filter(c => c.group === "friend").length;
  $("teacherCount").textContent =
    contacts.filter(c => c.group === "teacher").length;
  $("otherCount").textContent =
    contacts.filter(c => c.group === "other").length;
}

function renderContacts() {
  const list = $("contactList");
  list.innerHTML = "";

  const search = normalize($("search").value);
  const group = $("filterGroup").value;

  const filtered = [...contacts]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter(c => {
      const matchesSearch = [
        c.name, c.phone, c.email, c.url
      ].some(value => normalize(value).includes(search));

      return matchesSearch &&
        (group === "all" || c.group === group);
    });

  if (!filtered.length) {
    list.textContent = "連絡先がありません。";
    return;
  }

  filtered.forEach(contact => {
    const item = document.createElement("div");
    item.className = "contact-item";
    item.dataset.id = contact.id;
    item.draggable = true;

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";
    handle.title = "ドラッグして並べ替え";
    handle.addEventListener("pointerdown", startTouchDrag);

    const info = document.createElement("div");
    info.className = "contact-info";

    const name = document.createElement("strong");
    name.textContent = contact.name;

    const detail = document.createElement("p");
    detail.textContent =
      `分類: ${groupLabel(contact.group)} | ${contact.phone}`;

    const email = document.createElement("p");
    email.textContent = contact.email;

    info.append(name, detail, email);

    if (contact.url) {
      const link = document.createElement("a");
      link.href = contact.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = contact.url;
      info.append(link);
    }

    const actions = document.createElement("div");
    actions.className = "contact-actions";

    const del = document.createElement("button");
    del.textContent = "削除";
    del.addEventListener("click", () => deleteContact(contact.id));

    actions.append(del);
    item.append(handle, info, actions);

    item.addEventListener("dragstart", () => {
      draggingId = contact.id;
      item.classList.add("dragging");
    });

    item.addEventListener("dragend", () => {
      draggingId = null;
      item.classList.remove("dragging");
    });

    item.addEventListener("dragover", event => event.preventDefault());

    item.addEventListener("drop", event => {
      event.preventDefault();
      reorderContacts(draggingId, contact.id);
    });

    list.append(item);
  });
}

function groupLabel(group) {
  return {
    friend: "友達",
    teacher: "先生",
    other: "その他"
  }[group] || "その他";
}

function reorderContacts(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;

  const from = contacts.findIndex(c => c.id === sourceId);
  const to = contacts.findIndex(c => c.id === targetId);

  if (from < 0 || to < 0) return;

  const [moved] = contacts.splice(from, 1);
  contacts.splice(to, 0, moved);

  contacts.forEach((c, i) => c.order = i);

  saveContacts();
  refreshApp();
}

let touchTarget = null;

function startTouchDrag(event) {
  if (event.pointerType === "mouse") return;

  event.preventDefault();

  const item = event.currentTarget.closest(".contact-item");
  if (!item) return;

  touchTarget = item.dataset.id;
  item.style.opacity = "0.5";

  function finish(ev) {
    if (!touchTarget) return;

    const source = touchTarget;
    const targetElement = document.elementFromPoint(
      ev.clientX, ev.clientY
    );
    const target = targetElement?.closest(".contact-item");

    document.querySelectorAll(".contact-item").forEach(el => {
      el.style.opacity = "1";
    });

    if (target) {
      reorderContacts(source, target.dataset.id);
    }

    touchTarget = null;
    document.removeEventListener("pointerup", finish);
    document.removeEventListener("pointercancel", cancel);
  }

  function cancel() {
    touchTarget = null;
    document.querySelectorAll(".contact-item").forEach(el => {
      el.style.opacity = "1";
    });
    document.removeEventListener("pointerup", finish);
    document.removeEventListener("pointercancel", cancel);
  }

  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", cancel);
}

function deleteContact(id) {
  const index = contacts.findIndex(c => c.id === id);
  if (index < 0) return;

  pendingDelete = {
    contact: contacts[index],
    index
  };

  contacts.splice(index, 1);
  saveContacts();
  refreshApp();

  $("undoButton").disabled = false;
  $("undoMessage").textContent =
    "45秒以内なら削除した連絡先を復元できます。";

  clearTimeout(pendingTimer);

  pendingTimer = setTimeout(() => {
    pendingDelete = null;
    $("undoButton").disabled = true;
    $("undoMessage").textContent = "復元できるデータはありません。";
  }, 45000);
}

$("undoButton").addEventListener("click", () => {
  if (!pendingDelete) return;

  contacts.splice(pendingDelete.index, 0, pendingDelete.contact);
  contacts.forEach((c, i) => c.order = i);

  pendingDelete = null;
  clearTimeout(pendingTimer);

  saveContacts();
  refreshApp();

  $("undoButton").disabled = true;
  $("undoMessage").textContent = "連絡先を復元しました。";
});

async function startScanner() {
  try {
    if (!scanner) {
      scanner = new Html5Qrcode("reader");
    }

    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      async decodedText => {
        await stopScanner();
        parseQRContact(decodedText);
      }
    );

    $("status").textContent = "QRコードを読み込んでいます。";
  } catch (error) {
    $("status").textContent = "カメラを起動できませんでした。HTTPSを確認してください。";
  }
}

async function stopScanner() {
  if (scanner && scanner.isScanning) {
    try {
      await scanner.stop();
      await scanner.clear();
    } catch (error) {
      console.error(error);
    }
  }
}

$("startScan").addEventListener("click", startScanner);
$("stopScan").addEventListener("click", stopScanner);

$("search").addEventListener("input", renderContacts);
$("filterGroup").addEventListener("change", renderContacts);

// Transfer QR: split into small QR pages
function createTransferPages() {
  if (!contacts.length) {
    alert("転送する連絡先がありません。");
    return;
  }

  const transferId = makeId();
  const chunks = [];

  // Small chunks improve QR readability on phones
  for (let i = 0; i < contacts.length; i += 2) {
    chunks.push(contacts.slice(i, i + 2));
  }

  transferPages = chunks.map((chunk, index) => {
    const payload = {
      type: "QRMEISHI_PART",
      version: 2,
      transferId,
      part: index + 1,
      total: chunks.length,
      contacts: chunk.map(c => ({
        name: c.name,
        phone: c.phone,
        email: c.email,
        url: c.url,
        group: c.group
      }))
    };

    return "QRMEISHI_PART:" + JSON.stringify(payload);
  });

  transferPageIndex = 0;
  showTransferPage();
}

function showTransferPage() {
  const container = $("generatedQR");
  container.innerHTML = "";

  const page = document.createElement("div");
  page.className = "qr-page";

  const heading = document.createElement("h3");
  heading.textContent =
    `QR ${transferPageIndex + 1} / ${transferPages.length}`;

  const qr = document.createElement("div");
  qr.id = "transferQRCode";

  const nav = document.createElement("div");

  const prev = document.createElement("button");
  prev.textContent = "前へ";
  prev.disabled = transferPageIndex === 0;
  prev.onclick = () => {
    transferPageIndex--;
    showTransferPage();
  };

  const next = document.createElement("button");
  next.textContent = "次へ";
  next.disabled = transferPageIndex === transferPages.length - 1;
  next.onclick = () => {
    transferPageIndex++;
    showTransferPage();
  };

  const instruction = document.createElement("p");
  instruction.textContent = "すべてのQRコードを順番に読み込んでください。";

  nav.append(prev, next);
  page.append(heading, qr, nav, instruction);
  container.append(page);

  new QRCode(qr, {
    text: transferPages[transferPageIndex],
    width: 240,
    height: 240,
    correctLevel: QRCode.CorrectLevel.L
  });
}

$("exportData").addEventListener("click", createTransferPages);

function importTransferData(data) {
  try {
    let payload;

    if (data.startsWith("QRMEISHI_PART:")) {
      payload = JSON.parse(data.substring("QRMEISHI_PART:".length));
    } else {
      payload = JSON.parse(data.substring("QRMEISHI:".length));
    }

    // New multi-part format
    if (payload.type === "QRMEISHI_PART") {
      const saved = JSON.parse(localStorage.getItem(TRANSFER_KEY) || "{}");

      if (saved.transferId && saved.transferId !== payload.transferId) {
        localStorage.removeItem(TRANSFER_KEY);
      }

      const current = JSON.parse(localStorage.getItem(TRANSFER_KEY) || "{}");

      current.transferId = payload.transferId;
      current.total = payload.total;
      current.parts = current.parts || {};
      current.parts[payload.part] = payload.contacts || [];

      localStorage.setItem(TRANSFER_KEY, JSON.stringify(current));

      const received = Object.keys(current.parts).length;

      if (received < payload.total) {
        $("status").textContent =
          `転送QR ${received}/${payload.total} 件を読み込みました。`;
        return true;
      }

      const all = [];
      for (let i = 1; i <= payload.total; i++) {
        if (!current.parts[i]) {
          $("status").textContent = "QRコードが不足しています。";
          return true;
        }
        all.push(...current.parts[i]);
      }

      const added = importContacts(all);
      localStorage.removeItem(TRANSFER_KEY);

      $("status").textContent =
        `転送完了：${added}件を追加しました。`;
      return true;
    }

    // Old transfer format support
    if (payload.type === "QRMEISHI_BULK" && Array.isArray(payload.contacts)) {
      const added = importContacts(payload.contacts);
      $("status").textContent = `${added}件を追加しました。`;
      return true;
    }

    throw new Error("Invalid transfer");
  } catch (error) {
    $("status").textContent = "転送QRを読み込めませんでした。";
    return false;
  }
}

function importContacts(items) {
  let added = 0;

  items.forEach(item => {
    if (!isDuplicateContact(item)) {
      contacts.push({
        id: makeId(),
        name: item.name || "名前なし",
        phone: item.phone || "",
        email: item.email || "",
        url: item.url || "",
        group: item.group || "other",
        createdAt: new Date().toISOString(),
        order: contacts.length
      });
      added++;
    }
  });

  saveContacts();
  refreshApp();
  return added;
}

$("importData").addEventListener("click", startScanner);

// Initial display
refreshApp();
