
"use strict";

/* =====================================
   QR MEISHI - MAIN JAVASCRIPT
===================================== */

const STORAGE_KEY = "qrMeishiContacts";
const PART_STORAGE_KEY = "qrMeishiTransferParts";

let contacts = loadContacts();
let scanner = null;
let pendingDelete = null;
let deleteTimer = null;
let activeGroup = "all";
let groupChart = null;
let analyticsChart = null;
let draggedId = null;
let touchSourceId = null;

/* =====================================
   ELEMENTS
===================================== */

const $ = (id) => document.getElementById(id);

const scannerModal = $("scannerModal");
const contactModal = $("contactModal");
const contactForm = $("contactForm");
const undoToast = $("undoToast");

const contactName = $("contactName");
const contactPhone = $("contactPhone");
const contactEmail = $("contactEmail");
const contactUrl = $("contactUrl");
const contactGroup = $("contactGroup");

/* =====================================
   DATA STORAGE
===================================== */

function loadContacts() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch (error) {
    console.error("データ読み込みエラー:", error);
    return [];
  }
}

function saveContacts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
}

function createId() {
  return Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8);
}

/* =====================================
   DUPLICATE CHECK
===================================== */

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function contactFingerprint(contact) {
  return [
    String(contact.name || "").trim().toLowerCase(),
    normalizePhone(contact.phone),
    String(contact.email || "").trim().toLowerCase(),
    String(contact.url || "").trim().toLowerCase()
  ].join("|");
}

function isDuplicateContact(contact, list = contacts) {
  const fingerprint = contactFingerprint(contact);

  return list.some(existing =>
    contactFingerprint(existing) === fingerprint
  );
}

/* =====================================
   GROUP SETTINGS
===================================== */

const groupNames = {
  friend: "友達",
  teacher: "先生",
  other: "その他"
};

function getGroupName(group) {
  return groupNames[group] || "その他";
}

/* =====================================
   PAGE NAVIGATION
===================================== */

function showPage(pageId) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.toggle("active", page.id === pageId);
  });

  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.target === pageId
    );
  });

  const titles = {
    dashboard: "Dashboard",
    contacts: "Contacts",
    analytics: "Analytics",
    transfer: "QR Transfer"
  };

  $("pageTitle").textContent = titles[pageId] || "Dashboard";

  if (pageId === "analytics") {
    updateCharts();
  }

  if (pageId === "dashboard") {
    renderRecent();
  }
}

document.querySelectorAll("[data-target]").forEach(button => {
  button.addEventListener("click", () => {
    showPage(button.dataset.target);
  });
});

$("quickContacts").addEventListener("click", () => {
  showPage("contacts");
});

$("quickTransfer").addEventListener("click", () => {
  showPage("transfer");
});

/* =====================================
   QR SCANNER
===================================== */

function openScanner() {
  scannerModal.classList.add("show");
  $("scanStatus").textContent = "カメラを起動しています...";

  if (typeof Html5Qrcode === "undefined") {
    $("scanStatus").textContent =
      "QR読み取りライブラリを読み込めませんでした。";
    return;
  }

  if (scanner) return;

  scanner = new Html5Qrcode("reader");

  scanner.start(
    { facingMode: "environment" },
    {
      fps: 10,
      qrbox: { width: 230, height: 230 }
    },
    decodedText => {
      stopScanner();
      handleQRData(decodedText);
    },
    () => {
      // 読み取り途中のエラーは無視する
    }
  ).then(() => {
    $("scanStatus").textContent =
      "QRコードをカメラに向けてください。";
  }).catch(error => {
    console.error(error);
    scanner = null;
    $("scanStatus").textContent =
      "カメラを起動できません。カメラの使用を許可してください。";
  });
}

function stopScanner() {
  if (!scanner) {
    scannerModal.classList.remove("show");
    return;
  }

  const currentScanner = scanner;
  scanner = null;

  currentScanner.stop()
    .then(() => currentScanner.clear())
    .catch(error => console.warn(error))
    .finally(() => {
      scannerModal.classList.remove("show");
    });
}

$("openScanner").addEventListener("click", openScanner);
$("quickScan").addEventListener("click", openScanner);
$("contactScan").addEventListener("click", openScanner);
$("closeScanner").addEventListener("click", stopScanner);

/* =====================================
   QR DATA READING
===================================== */

function handleQRData(rawText) {
  const text = rawText.trim();

  if (text.startsWith("QRMEISHI_PART:")) {
    importQRPart(text);
    return;
  }

  if (text.startsWith("QRMEISHI:")) {
    importAllContacts(text);
    return;
  }

  const data = parseQRContact(text);

  if (isDuplicateContact(data)) {
    alert("この名刺はすでに登録されています。");
    return;
  }

  contactForm.reset();

  contactName.value = data.name || "";
  contactPhone.value = data.phone || "";
  contactEmail.value = data.email || "";
  contactUrl.value = data.url || "";
  contactGroup.value = "";

  contactModal.classList.add("show");
}

function parseQRContact(text) {
  const result = {
    name: "",
    phone: "",
    email: "",
    url: ""
  };

  const lines = text.replace(/\r/g, "").split("\n");

  // vCard形式
  if (/BEGIN:VCARD/i.test(text)) {
    let fallbackName = "";

    lines.forEach(line => {
      const colon = line.indexOf(":");
      if (colon < 0) return;

      const rawKey = line.slice(0, colon).toUpperCase();
      const key = rawKey.split(";")[0].split(".").pop();
      const value = line.slice(colon + 1).trim();

      if (key === "FN") {
        result.name = value;
      } else if (key === "N" && !fallbackName) {
        fallbackName = value.replace(/;/g, " ").trim();
      }

      if (key === "TEL" && !result.phone) {
        result.phone = value;
      }

      if (key === "EMAIL" && !result.email) {
        result.email = value;
      }

      if (key === "URL" && !result.url) {
        result.url = value;
      }
    });

    if (!result.name) {
      result.name = fallbackName;
    }

    return result;
  }

  // URL形式
  if (/^https?:\/\//i.test(text)) {
    result.url = text;
    result.name = getDomainName(text);
    return result;
  }

  // Text形式
  lines.forEach(line => {
    const match = line.match(
      /^\s*(name|名前|氏名|fn|phone|電話番号|tel|email|メールアドレス|url|website|website link)\s*[:：=]\s*(.*)$/i
    );

    if (match) {
      const key = match[1].toLowerCase();
      const value = match[2].trim();

      if (["name", "名前", "氏名", "fn"].includes(key)) {
        result.name = value;
      } else if (["phone", "電話番号", "tel"].includes(key)) {
        result.phone = value;
      } else if (["email", "メールアドレス"].includes(key)) {
        result.email = value;
      } else if (["url", "website", "website link"].includes(key)) {
        result.url = value;
      }

      return;
    }

    if (!result.url && /^https?:\/\//i.test(line.trim())) {
      result.url = line.trim();
    }
  });

  // QRに電話番号だけが入っている場合
  if (!result.name && !result.phone && !result.email && !result.url) {
    if (/^\+?[\d\s().-]{7,}$/.test(text)) {
      result.phone = text;
    } else {
      result.name = text;
    }
  }

  return result;
}

function getDomainName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Website";
  }
}

/* =====================================
   CONTACT FORM
===================================== */

$("closeContact").addEventListener("click", () => {
  contactModal.classList.remove("show");
});

contactForm.addEventListener("submit", event => {
  event.preventDefault();

  const contact = {
    id: createId(),
    name: contactName.value.trim(),
    phone: contactPhone.value.trim(),
    email: contactEmail.value.trim(),
    url: contactUrl.value.trim(),
    group: contactGroup.value,
    createdAt: new Date().toISOString(),
    order: contacts.length
  };

  if (!contact.name || !contact.group) {
    alert("名前とグループを入力してください。");
    return;
  }

  if (isDuplicateContact(contact)) {
    alert("この名刺はすでに登録されています。");
    return;
  }

  contacts.push(contact);

  saveContacts();
  refreshApp();

  contactModal.classList.remove("show");
  contactForm.reset();

  showPage("contacts");
});

/* =====================================
   DISPLAY CONTACTS
===================================== */

function createContactElement(contact, reorderable = true) {
  const item = document.createElement("div");

  item.className = "contact-item";
  item.dataset.id = contact.id;

  const info = document.createElement("div");
  info.className = "contact-info";

  const name = document.createElement("h4");
  name.textContent = contact.name;

  const group = document.createElement("span");
  group.className = "group-badge " + contact.group;
  group.textContent = getGroupName(contact.group);

  info.append(name, group);

  if (contact.phone) {
    const phone = document.createElement("p");
    phone.textContent = "☎ " + contact.phone;
    info.appendChild(phone);
  }

  if (contact.email) {
    const email = document.createElement("p");
    email.textContent = "✉ " + contact.email;
    info.appendChild(email);
  }

  if (contact.url) {
    const link = document.createElement("a");
    link.href = contact.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "🌐 " + contact.url;
    link.className = "contact-link";
    link.style.color = "#60a5fa";
    link.style.fontSize = "11px";
    link.style.display = "block";
    link.style.marginTop = "5px";
    info.appendChild(link);
  }

  const actions = document.createElement("div");
  actions.className = "contact-actions";

  if (reorderable) {
    const dragHandle = document.createElement("button");

    dragHandle.type = "button";
    dragHandle.className = "mobile-drag-handle";
    dragHandle.textContent = "☷";
    dragHandle.title = "長押しして並び替え";
    dragHandle.setAttribute("aria-label", "並び替え");

    dragHandle.style.cursor = "grab";
    dragHandle.style.touchAction = "none";
    dragHandle.style.marginRight = "8px";

    actions.appendChild(dragHandle);
  }

  const deleteButton = document.createElement("button");
  deleteButton.className = "delete-btn";
  deleteButton.textContent = "削除";

  deleteButton.addEventListener("click", () => {
    deleteContact(contact.id);
  });

  actions.appendChild(deleteButton);

  item.append(info, actions);

  return item;
}

function renderContacts() {
  const list = $("contactList");
  list.replaceChildren();

  const keyword = $("searchInput").value.toLowerCase();
  const selectedGroup = $("groupFilter").value;

  const filtered = contacts.filter(contact => {
    const matchesName =
      String(contact.name || "").toLowerCase().includes(keyword);

    const matchesGroup =
      selectedGroup === "all" ||
      contact.group === selectedGroup;

    const matchesTab =
      activeGroup === "all" ||
      contact.group === activeGroup;

    return matchesName && matchesGroup && matchesTab;
  });

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-message";
    empty.textContent = "名刺情報がありません。";
    list.appendChild(empty);
    return;
  }

  filtered.forEach(contact => {
    list.appendChild(createContactElement(contact, true));
  });
}

function renderRecent() {
  const list = $("recentList");
  list.replaceChildren();

  const recent = [...contacts].slice(-5).reverse();

  if (recent.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-message";
    empty.textContent = "まだ名刺が登録されていません。";
    list.appendChild(empty);
    return;
  }

  recent.forEach(contact => {
    list.appendChild(createContactElement(contact, false));
  });
}

$("searchInput").addEventListener("input", renderContacts);

$("groupFilter").addEventListener("change", () => {
  activeGroup = "all";
  updateGroupTabs();
  renderContacts();
});

document.querySelectorAll(".group-tab").forEach(button => {
  button.addEventListener("click", () => {
    activeGroup = button.dataset.group;
    $("groupFilter").value = "all";
    updateGroupTabs();
    renderContacts();
  });
});

function updateGroupTabs() {
  document.querySelectorAll(".group-tab").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.group === activeGroup
    );
  });
}

/* =====================================
   DELETE & UNDO
===================================== */

function deleteContact(id) {
  if (pendingDelete) {
    finalizeDelete();
  }

  const index = contacts.findIndex(c => c.id === id);
  if (index === -1) return;

  const removed = contacts.splice(index, 1)[0];

  pendingDelete = {
    contact: removed,
    index
  };

  saveContacts();
  refreshApp();

  undoToast.classList.add("show");

  deleteTimer = setTimeout(() => {
    finalizeDelete();
  }, 45000);
}

function finalizeDelete() {
  clearTimeout(deleteTimer);
  pendingDelete = null;
  undoToast.classList.remove("show");
}

$("undoBtn").addEventListener("click", () => {
  if (!pendingDelete) return;

  clearTimeout(deleteTimer);

  const { contact, index } = pendingDelete;

  contacts.splice(index, 0, contact);

  pendingDelete = null;
  undoToast.classList.remove("show");

  saveContacts();
  refreshApp();
});

/* =====================================
   DESKTOP DRAG & DROP
===================================== */

function enableDragAndDrop() {
  const list = $("contactList");

  list.querySelectorAll(".contact-item").forEach(item => {
    item.draggable = true;

    item.addEventListener("dragstart", () => {
      draggedId = item.dataset.id;
      item.style.opacity = "0.4";
    });

    item.addEventListener("dragend", () => {
      item.style.opacity = "1";
      draggedId = null;
    });

    item.addEventListener("dragover", event => {
      event.preventDefault();
    });

    item.addEventListener("drop", event => {
      event.preventDefault();

      const targetId = item.dataset.id;

      if (draggedId && draggedId !== targetId) {
        reorderContacts(draggedId, targetId);
      }
    });
  });
}

/* =====================================
   REORDER CONTACTS
===================================== */

function reorderContacts(sourceId, targetId) {
  const sourceIndex = contacts.findIndex(c => c.id === sourceId);
  const targetIndex = contacts.findIndex(c => c.id === targetId);

  if (sourceIndex < 0 || targetIndex < 0) return;

  const [moved] = contacts.splice(sourceIndex, 1);
  contacts.splice(targetIndex, 0, moved);

  contacts.forEach((contact, index) => {
    contact.order = index;
  });

  saveContacts();
  refreshApp();
}

/* =====================================
   MOBILE TOUCH REORDER
===================================== */

function enableTouchReorder() {
  const list = $("contactList");

  list.querySelectorAll(".mobile-drag-handle").forEach(handle => {
    handle.addEventListener("pointerdown", event => {
      event.preventDefault();

      const item = handle.closest(".contact-item");
      if (!item) return;

      touchSourceId = item.dataset.id;

      try {
        handle.setPointerCapture(event.pointerId);
      } catch (error) {
        console.warn(error);
      }

      item.style.opacity = "0.5";
    });

    handle.addEventListener("pointerup", event => {
      if (!touchSourceId) return;

      const target = document.elementFromPoint(
        event.clientX,
        event.clientY
      );

      const targetItem = target?.closest(".contact-item");

      const sourceItem = Array.from(
        list.querySelectorAll(".contact-item")
      ).find(item => item.dataset.id === touchSourceId);

      if (
        targetItem &&
        targetItem.dataset.id !== touchSourceId
      ) {
        reorderContacts(
          touchSourceId,
          targetItem.dataset.id
        );
      } else if (sourceItem) {
        sourceItem.style.opacity = "1";
      }

      touchSourceId = null;
    });

    handle.addEventListener("pointercancel", () => {
      touchSourceId = null;

      list.querySelectorAll(".contact-item").forEach(item => {
        item.style.opacity = "1";
      });
    });
  });
}

/* =====================================
   DASHBOARD COUNTS
===================================== */

function updateStatistics() {
  const friends = contacts.filter(c => c.group === "friend").length;
  const teachers = contacts.filter(c => c.group === "teacher").length;
  const others = contacts.filter(c => c.group === "other").length;

  $("totalCount").textContent = contacts.length;
  $("friendCount").textContent = friends;
  $("teacherCount").textContent = teachers;
  $("otherCount").textContent = others;
}

/* =====================================
   CHARTS
===================================== */

function getGroupCounts() {
  return [
    contacts.filter(c => c.group === "friend").length,
    contacts.filter(c => c.group === "teacher").length,
    contacts.filter(c => c.group === "other").length
  ];
}

function updateCharts() {
  if (typeof Chart === "undefined") return;

  const counts = getGroupCounts();

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: "#cbd5e1"
        }
      }
    },
    scales: {
      x: {
        ticks: { color: "#94a3b8" },
        grid: { color: "#25334a" }
      },
      y: {
        beginAtZero: true,
        ticks: {
          color: "#94a3b8",
          precision: 0
        },
        grid: { color: "#25334a" }
      }
    }
  };

  if ($("groupChart")) {
    if (groupChart) groupChart.destroy();

    groupChart = new Chart($("groupChart"), {
      type: "doughnut",
      data: {
        labels: ["友達", "先生", "その他"],
        datasets: [{
          data: counts,
          backgroundColor: ["#3b82f6", "#fbbf24", "#a78bfa"],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: "#cbd5e1" }
          }
        }
      }
    });
  }

  if ($("analyticsChart")) {
    if (analyticsChart) analyticsChart.destroy();

    analyticsChart = new Chart($("analyticsChart"), {
      type: "bar",
      data: {
        labels: ["友達", "先生", "その他"],
        datasets: [{
          label: "登録人数",
          data: counts,
          backgroundColor: ["#3b82f6", "#fbbf24", "#a78bfa"],
          borderRadius: 8
        }]
      },
      options
    });
  }
}

/* =====================================
   QR CODE EXPORT - MULTI PART
===================================== */

$("generateQR").addEventListener("click", () => {
  if (contacts.length === 0) {
    alert("転送するデータがありません。");
    return;
  }

  if (typeof QRCode === "undefined") {
    alert("QRコード作成ライブラリを読み込めませんでした。");
    return;
  }

  const exportContacts = contacts.map(c => ({
    name: c.name,
    phone: c.phone,
    email: c.email,
    url: c.url,
    group: c.group,
    createdAt: c.createdAt
  }));

  const transferId = createId();
  const chunks = [];
  let currentChunk = [];

  exportContacts.forEach(contact => {
    const testChunk = [...currentChunk, contact];

    const testText = JSON.stringify({
      type: "QRMEISHI_PART",
      version: 2,
      transferId,
      part: 1,
      total: 1,
      contacts: testChunk
    });

    if (testText.length > 700 && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [contact];
    } else {
      currentChunk = testChunk;
    }
  });

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  const total = chunks.length;
  const container = $("generatedQR");

  container.replaceChildren();

  chunks.forEach((chunk, index) => {
    const wrapper = document.createElement("div");

    wrapper.className = "generated-qr";
    wrapper.style.display = "inline-flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.alignItems = "center";
    wrapper.style.padding = "12px";
    wrapper.style.margin = "8px";
    wrapper.style.background = "#ffffff";
    wrapper.style.borderRadius = "12px";
    wrapper.style.maxWidth = "100%";

    const label = document.createElement("p");
    label.textContent = `Part ${index + 1} / ${total}`;
    label.style.color = "#111827";
    label.style.fontWeight = "bold";

    const qrBox = document.createElement("div");

    wrapper.append(label, qrBox);
    container.appendChild(wrapper);

    const payload = "QRMEISHI_PART:" + JSON.stringify({
      type: "QRMEISHI_PART",
      version: 2,
      transferId,
      part: index + 1,
      total,
      contacts: chunk
    });

    try {
      new QRCode(qrBox, {
        text: payload,
        width: 220,
        height: 220,
        correctLevel: QRCode.CorrectLevel.M
      });
    } catch (error) {
      console.error(error);
      alert("QRコードを作成できませんでした。");
    }
  });

  const message = document.createElement("p");
  message.textContent =
    `全部で ${total} 個のQRコードがあります。すべて読み込んでください。`;

  message.style.color = "#cbd5e1";
  message.style.marginTop = "12px";

  container.appendChild(message);
});

/* =====================================
   BULK QR IMPORT
===================================== */

function importContactList(importedContacts) {
  const seen = new Set(
    contacts.map(contactFingerprint)
  );

  const newContacts = [];

  importedContacts.forEach(c => {
    if (!c || typeof c.name !== "string" || !c.name.trim()) {
      return;
    }

    const contact = {
      name: c.name.trim(),
      phone: typeof c.phone === "string" ? c.phone.trim() : "",
      email: typeof c.email === "string" ? c.email.trim() : "",
      url: typeof c.url === "string" ? c.url.trim() : "",
      group: ["friend", "teacher", "other"].includes(c.group)
        ? c.group
        : "other"
    };

    const fingerprint = contactFingerprint(contact);

    if (seen.has(fingerprint)) return;

    seen.add(fingerprint);

    newContacts.push({
      id: createId(),
      ...contact,
      createdAt: c.createdAt || new Date().toISOString(),
      order: contacts.length + newContacts.length
    });
  });

  const skipped = importedContacts.length - newContacts.length;

  if (newContacts.length === 0) {
    alert("新しい名刺データはありません。重複データは登録されませんでした。");
    return;
  }

  const approved = confirm(
    `${newContacts.length}人分を登録します。\n` +
    `${skipped}件の重複データはスキップします。\n\n` +
    `登録してもよろしいですか？`
  );

  if (!approved) return;

  contacts.push(...newContacts);

  saveContacts();
  refreshApp();
  showPage("contacts");

  alert(
    `${newContacts.length}人分を登録しました。\n` +
    `${skipped}件は重複のためスキップしました。`
  );
}

// पुरानो Single Bulk QR Import
function importAllContacts(rawText) {
  try {
    const jsonText = rawText.slice("QRMEISHI:".length);
    const data = JSON.parse(jsonText);

    if (
      data.type !== "QRMEISHI_BULK" ||
      !Array.isArray(data.contacts)
    ) {
      throw new Error("Invalid QR data");
    }

    importContactList(data.contacts);

  } catch (error) {
    console.error(error);
    alert("QRコードのデータを読み取れませんでした。");
  }
}

// नयाँ Multi Part QR Import
function importQRPart(rawText) {
  try {
    const jsonText = rawText.slice("QRMEISHI_PART:".length);
    const data = JSON.parse(jsonText);

    if (
      data.type !== "QRMEISHI_PART" ||
      !data.transferId ||
      !Array.isArray(data.contacts) ||
      !Number.isInteger(data.part) ||
      !Number.isInteger(data.total) ||
      data.part < 1 ||
      data.part > data.total ||
      data.total < 1
    ) {
      throw new Error("Invalid QR part");
    }

    let transfers = {};

    try {
      transfers = JSON.parse(
        localStorage.getItem(PART_STORAGE_KEY)
      ) || {};
    } catch {
      transfers = {};
    }

    if (!transfers[data.transferId]) {
      transfers[data.transferId] = {
        total: data.total,
        parts: {}
      };
    }

    const transfer = transfers[data.transferId];

    if (transfer.total !== data.total) {
      throw new Error("Transfer data mismatch");
    }

    const partKey = String(data.part);

    if (transfer.parts[partKey]) {
      alert(`Part ${data.part} はすでに読み込み済みです。`);
      return;
    }

    transfer.parts[partKey] = data.contacts;

    localStorage.setItem(
      PART_STORAGE_KEY,
      JSON.stringify(transfers)
    );

    const received = Object.keys(transfer.parts).length;

    if (received < transfer.total) {
      alert(
        `QRコードを読み込みました。\n` +
        `進捗: ${received} / ${transfer.total}\n\n` +
        `次のQRコードを読み込んでください。`
      );
      return;
    }

    const allContacts = [];

    for (let i = 1; i <= transfer.total; i++) {
      const part = transfer.parts[String(i)];

      if (!part) {
        alert("一部のQRコードが不足しています。");
        return;
      }

      allContacts.push(...part);
    }

    delete transfers[data.transferId];

    localStorage.setItem(
      PART_STORAGE_KEY,
      JSON.stringify(transfers)
    );

    importContactList(allContacts);

  } catch (error) {
    console.error(error);
    alert("QRコードのデータを読み取れませんでした。");
  }
}

/* =====================================
   IMPORT QR SCANNER
===================================== */

$("importQR").addEventListener("click", openScanner);

/* =====================================
   APP UPDATE
===================================== */

function refreshApp() {
  updateStatistics();
  renderContacts();
  renderRecent();
  updateCharts();

  enableDragAndDrop();
  enableTouchReorder();
}

/* =====================================
   INITIAL START
===================================== */

function startApp() {
  refreshApp();
  showPage("dashboard");
}

startApp();
