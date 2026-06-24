const STORAGE_KEY = "gestion_boutique_v1";
const API_STATE_URL = "/api/state";
const API_LOGIN_URL = "/api/login";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "1234@dmin100%";

const demoData = {
  session: null,
  users: [
    { username: ADMIN_USERNAME, password: ADMIN_PASSWORD, role: "Administrateur", name: "Administrateur", email: "" }
  ],
  products: [
    { code: "PUMP_075HP", name: "Pump interdab 0.75HP", sellPrice: 30000 },
    { code: "PUMP_1HP", name: "Pump interdab 1HP", sellPrice: 52200 }
  ],
  warehouse: {
    PUMP_075HP: 191,
    PUMP_1HP: 48
  },
  shop: {
    PUMP_075HP: 0,
    PUMP_1HP: 0
  },
  transferDraft: [],
  transfers: [],
  hiddenInvoiceTickets: [],
  sales: [],
  cart: [],
  journal: []
};

let state = loadState();
let serverSaveQueue = Promise.resolve();

const views = {
  dashboard: ["Tableau de bord", "Vue globale du magasin, de la boutique et des ventes."],
  products: ["Produits", "Création et suivi des articles vendus."],
  warehouse: ["Stock magasin", "Entrées de stock dans le magasin central."],
  transfer: ["Transfert", "Envoi des produits du magasin vers la boutique."],
  shop: ["Stock boutique", "Articles disponibles pour la vente directe."],
  cashier: ["Caisse", "Panier, paiement et validation des ventes."],
  sales: ["Ventes", "Historique des ventes et factures."],
  users: ["Utilisateurs", "Création des comptes et attribution des rôles."],
  backup: ["Sauvegarde", "Export, restauration et fichiers compatibles Excel."]
};

const roleAccess = {
  Administrateur: ["dashboard", "products", "warehouse", "transfer", "shop", "cashier", "sales", "users", "backup"],
  Magasinier: ["dashboard", "products", "warehouse", "transfer", "backup"],
  Caissier: ["dashboard", "shop", "cashier", "sales", "backup"]
};

const backupActionAccess = {
  downloadBackup: ["Administrateur"],
  restoreBackup: ["Administrateur"],
  exportProducts: ["Administrateur", "Magasinier", "Caissier"],
  exportStocks: ["Administrateur", "Magasinier", "Caissier"],
  exportSales: ["Administrateur", "Caissier"]
};

document.addEventListener("DOMContentLoaded", () => {
  bindLogin();
  bindNavigation();
  bindForms();
  renderAll();
  updateAuth();
  refreshStateFromServer().catch((error) => {
    console.warn("Base serveur indisponible :", error.message);
  });
});

function bindLogin() {
  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const username = document.getElementById("loginUser").value.trim();
    const password = document.getElementById("loginPassword").value;
    const user = await authenticateUser(username, password);

    if (!user) {
      alert("Utilisateur ou mot de passe incorrect.");
      return;
    }

    state.session = {
      username: user.username,
      role: user.role,
      name: user.name,
      connectedAt: todayText()
    };

    event.target.reset();
    commit({ sync: false });
    updateAuth();
    refreshStateFromServer().catch((error) => {
      console.warn("Actualisation serveur impossible :", error.message);
    });
  });

  document.getElementById("logout").addEventListener("click", () => {
    state.session = null;
    commit({ sync: false });
    updateAuth();
  });
}

function updateAuth() {
  document.body.classList.toggle("locked", !state.session);
  document.body.classList.toggle("is-admin", isAdmin());

  if (!state.session) return;

  document.querySelectorAll(".nav[data-view]").forEach((button) => {
    const allowed = canAccessView(button.dataset.view);
    button.style.display = allowed ? "" : "none";
  });

  updateBackupActions();

  const activeView = document.querySelector(".view.active")?.id || "dashboard";
  if (!canAccessView(activeView)) showView(firstAllowedView());
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return structuredClone(demoData);

  try {
    return normalizeState(JSON.parse(saved));
  } catch {
    return structuredClone(demoData);
  }
}

function normalizeState(data) {
  const source = data && typeof data === "object" ? data : {};
  const users = Array.isArray(source.users) && source.users.length ? source.users : structuredClone(demoData.users);
  const normalizedUsers = users.map((user) => ({
    name: String(user.name || user.username || ""),
    email: String(user.email || ""),
    username: String(user.username || ""),
    password: user.username === ADMIN_USERNAME ? ADMIN_PASSWORD : String(user.password || ""),
    role: normalizeRole(user.role)
  })).filter((user) => user.username);
  const normalizedSession = source.session ? {
    ...source.session,
    role: normalizeRole(source.session.role)
  } : null;

  return {
    ...structuredClone(demoData),
    ...source,
    session: normalizedSession,
    users: normalizedUsers,
    products: Array.isArray(source.products) ? source.products : [],
    warehouse: source.warehouse || {},
    shop: source.shop || {},
    transferDraft: Array.isArray(source.transferDraft) ? source.transferDraft : [],
    transfers: Array.isArray(source.transfers) ? source.transfers : [],
    hiddenInvoiceTickets: Array.isArray(source.hiddenInvoiceTickets) ? source.hiddenInvoiceTickets : [],
    sales: Array.isArray(source.sales) ? source.sales : [],
    cart: Array.isArray(source.cart) ? source.cart : [],
    journal: Array.isArray(source.journal) ? source.journal : []
  };
}

function normalizeRole(role) {
  if (role === "Admin") return "Administrateur";
  if (role === "Administrateur" || role === "Magasinier" || role === "Caissier") return role;
  return "Caissier";
}

function isAdmin() {
  return state.session?.role === "Administrateur";
}

function canAccessView(viewName) {
  if (!state.session) return false;
  return (roleAccess[state.session.role] || []).includes(viewName);
}

function firstAllowedView() {
  return (roleAccess[state.session?.role] || ["dashboard"])[0];
}

function canUseBackupAction(actionName) {
  if (!state.session) return false;
  return (backupActionAccess[actionName] || []).includes(state.session.role);
}

function requireBackupAction(actionName) {
  if (canUseBackupAction(actionName)) return true;

  alert("Action non autorisée pour ce rôle.");
  return false;
}

function updateBackupActions() {
  const actions = {
    downloadBackup: document.getElementById("downloadBackup"),
    restoreBackup: document.getElementById("restoreBackupButton"),
    exportProducts: document.getElementById("exportProducts"),
    exportStocks: document.getElementById("exportStocks"),
    exportSales: document.getElementById("exportSales")
  };

  Object.entries(actions).forEach(([actionName, element]) => {
    if (element) element.classList.toggle("hidden", !canUseBackupAction(actionName));
  });

  const localPanel = document.getElementById("localBackupPanel");
  const exportPanel = document.getElementById("exportBackupPanel");

  if (localPanel) {
    localPanel.classList.toggle("hidden", !canUseBackupAction("downloadBackup") && !canUseBackupAction("restoreBackup"));
  }

  if (exportPanel) {
    exportPanel.classList.toggle("hidden", !canUseBackupAction("exportProducts") && !canUseBackupAction("exportStocks") && !canUseBackupAction("exportSales"));
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function canUseServerApi() {
  return window.location.protocol === "http:" || window.location.protocol === "https:";
}

async function authenticateUser(username, password) {
  if (canUseServerApi()) {
    try {
      const response = await fetch(API_LOGIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      if (response.status === 401) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      if (data && data.user) return data.user;
    } catch (error) {
      console.warn("Connexion serveur impossible, essai local :", error.message);
    }
  }

  return state.users.find((item) => item.username === username && item.password === password) || null;
}

async function refreshStateFromServer() {
  if (!canUseServerApi()) return false;

  const currentSession = state.session;
  const response = await fetch(API_STATE_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const remoteState = normalizeState(await response.json());
  state = {
    ...remoteState,
    session: reconcileSession(currentSession, remoteState.users)
  };

  saveState();
  renderAll();
  updateAuth();
  return true;
}

function reconcileSession(session, users) {
  if (!session) return null;

  const user = users.find((item) => item.username === session.username);
  if (!user) return null;

  return {
    ...session,
    name: user.name,
    role: normalizeRole(user.role)
  };
}

function saveStateToServer(action = "mise_a_jour", details = {}) {
  if (!canUseServerApi()) return Promise.resolve(true);

  serverSaveQueue = serverSaveQueue
    .catch(() => true)
    .then(async () => {
      const response = await fetch(API_STATE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, action, details })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${response.status}`);
      }

      return true;
    })
    .catch((error) => {
      console.warn("Sauvegarde serveur impossible :", error.message);
      return false;
    });

  return serverSaveQueue;
}

function money(value) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F CFA`;
}

function todayText() {
  return new Date().toLocaleString("fr-FR");
}

function dateKey(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function saleDayKey(sale) {
  if (sale.dayKey) return sale.dayKey;

  const ticketMatch = String(sale.ticket || "").match(/^TCK-(\d{2})(\d{2})(\d{4})/);
  if (ticketMatch) {
    return `${ticketMatch[3]}-${ticketMatch[2]}-${ticketMatch[1]}`;
  }

  const dateMatch = String(sale.date || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dateMatch) {
    return `${dateMatch[3]}-${String(dateMatch[2]).padStart(2, "0")}-${String(dateMatch[1]).padStart(2, "0")}`;
  }

  return dateKey(sale.date);
}

function ticketId() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String(now.getFullYear());
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");

  return `TCK-${day}${month}${year}${hour}${minute}${second}`;
}

function getProduct(code) {
  return state.products.find((product) => product.code === code);
}

function bindNavigation() {
  document.querySelectorAll(".nav[data-view]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });

}

function showView(viewName) {
  if (!canAccessView(viewName)) {
    alert("Accès non autorisé pour ce rôle.");
    viewName = firstAllowedView();
  }

  document.querySelectorAll(".nav").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });

  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === viewName);
  });

  document.getElementById("viewTitle").textContent = views[viewName][0];
  document.getElementById("viewSubtitle").textContent = views[viewName][1];
}

function bindForms() {
  document.getElementById("productForm").addEventListener("submit", addProduct);
  document.getElementById("userForm").addEventListener("submit", addUser);
  document.getElementById("newUserName").addEventListener("input", updateGeneratedUsername);
  document.getElementById("productName").addEventListener("input", updateGeneratedProductCode);
  document.getElementById("warehouseForm").addEventListener("submit", addWarehouseStock);
  document.getElementById("transferForm").addEventListener("submit", transferToShop);
  document.getElementById("sendTransfer").addEventListener("click", sendTransferToShop);
  document.getElementById("clearTransferDraft").addEventListener("click", clearTransferDraft);
  document.getElementById("cartForm").addEventListener("submit", addToCart);
  document.getElementById("cartProduct").addEventListener("change", renderCartProductInfo);
  document.getElementById("paymentMode").addEventListener("change", updatePaymentFields);
  document.getElementById("paidAmount").addEventListener("input", renderChangeDue);
  document.getElementById("clearCart").addEventListener("click", clearCart);
  document.getElementById("saleForm").addEventListener("submit", validateSale);
  document.getElementById("downloadBackup").addEventListener("click", downloadBackup);
  document.getElementById("restoreBackup").addEventListener("change", restoreBackup);
  document.getElementById("exportProducts").addEventListener("click", exportProductsCsv);
  document.getElementById("exportStocks").addEventListener("click", exportStocksCsv);
  document.getElementById("exportSales").addEventListener("click", exportSalesCsv);
}

function updateGeneratedUsername() {
  const name = document.getElementById("newUserName").value;
  document.getElementById("newUsername").value = generateUsername(name);
}

function updateGeneratedProductCode() {
  const name = document.getElementById("productName").value;
  document.getElementById("productCode").value = generateProductCode(name);
}

function addProduct(event) {
  event.preventDefault();

  if (!["Administrateur", "Magasinier"].includes(state.session?.role)) {
    alert("Accès réservé à l'administrateur ou au magasinier.");
    return;
  }

  updateGeneratedProductCode();

  const product = {
    code: document.getElementById("productCode").value.trim(),
    name: document.getElementById("productName").value.trim(),
    sellPrice: Number(document.getElementById("productSell").value)
  };

  if (!product.code || !product.name) {
    alert("Code et nom obligatoires.");
    return;
  }

  if (getProduct(product.code)) {
    alert("Ce code produit existe déjà.");
    return;
  }

  state.products.push(product);
  state.warehouse[product.code] = 0;
  state.shop[product.code] = 0;
  event.target.reset();
  commit();
}

async function addUser(event) {
  event.preventDefault();

  if (!isAdmin()) {
    alert("Seul l'administrateur peut créer un utilisateur.");
    return;
  }

  updateGeneratedUsername();

  const user = {
    name: document.getElementById("newUserName").value.trim(),
    email: document.getElementById("newUserEmail").value.trim(),
    username: document.getElementById("newUsername").value.trim(),
    password: document.getElementById("newUserPassword").value,
    role: normalizeRole(document.getElementById("newUserRole").value)
  };

  if (!user.name || !user.email || !user.username || !user.password || !user.role) {
    alert("Tous les champs utilisateur sont obligatoires.");
    return;
  }

  if (state.users.some((item) => item.username.toLowerCase() === user.username.toLowerCase())) {
    alert("Cet identifiant existe déjà.");
    return;
  }

  state.users.push(user);
  event.target.reset();
  const saved = await commit({
    action: "creation_utilisateur",
    details: { username: user.username, role: user.role }
  });
  if (!saved) return alert("Utilisateur cree localement, mais la sauvegarde serveur a echoue.");
  alert("Utilisateur créé.");
}

function generateUsername(name) {
  const parts = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "";

  const base = parts.length === 1 ? parts[0] : `${parts[0]}.${parts[parts.length - 1]}`;
  let username = base;
  let counter = 2;

  while (state.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    username = `${base}${counter}`;
    counter += 1;
  }

  return username;
}

function generateProductCode(name) {
  const words = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "";

  const prefix = words
    .slice(0, 3)
    .map((word) => word.slice(0, 4).toUpperCase())
    .join("-");

  let code = prefix;
  let counter = 2;

  while (getProduct(code)) {
    code = `${prefix}-${counter}`;
    counter += 1;
  }

  return code;
}

function addWarehouseStock(event) {
  event.preventDefault();

  if (!["Administrateur", "Magasinier"].includes(state.session?.role)) {
    alert("Accès réservé à l'administrateur ou au magasinier.");
    return;
  }

  const code = document.getElementById("warehouseProduct").value;
  const qty = Number(document.getElementById("warehouseQty").value);

  if (!code || qty <= 0) {
    alert("Quantité invalide.");
    return;
  }

  state.warehouse[code] = Number(state.warehouse[code] || 0) + qty;
  event.target.reset();
  commit();
}

function transferToShop(event) {
  event.preventDefault();

  if (!["Administrateur", "Magasinier"].includes(state.session?.role)) {
    alert("Accès réservé à l'administrateur ou au magasinier.");
    return;
  }

  const code = document.getElementById("transferProduct").value;
  const qty = Number(document.getElementById("transferQty").value);
  const available = Number(state.warehouse[code] || 0);
  const product = getProduct(code);

  if (!product || qty <= 0) {
    alert("Quantité invalide.");
    return;
  }

  const existing = state.transferDraft.find((item) => item.code === code);
  const currentQty = existing ? existing.qty : 0;
  const newQty = currentQty + qty;

  if (newQty > available) {
    alert(`Stock magasin insuffisant. Disponible : ${available}`);
    return;
  }

  if (existing) {
    existing.qty = newQty;
  } else {
    state.transferDraft.push({ code, product: product.name, qty });
  }

  event.target.reset();
  commit();
}

function sendTransferToShop() {
  if (!["Administrateur", "Magasinier"].includes(state.session?.role)) {
    alert("Accès réservé à l'administrateur ou au magasinier.");
    return;
  }

  if (state.transferDraft.length === 0) {
    alert("Aucun produit dans l'envoi.");
    return;
  }

  for (const item of state.transferDraft) {
    const available = Number(state.warehouse[item.code] || 0);
    if (item.qty > available) {
      alert(`Stock magasin insuffisant pour ${item.product}. Disponible : ${available}`);
      return;
    }
  }

  if (!confirm("Envoyer ce stock à la boutique ?")) return;

  const transfer = {
    id: `TRF-${Date.now()}`,
    sentAt: todayText(),
    receivedAt: "",
    status: "En attente",
    items: state.transferDraft.map((item) => ({ ...item }))
  };

  transfer.items.forEach((item) => {
    state.warehouse[item.code] = Number(state.warehouse[item.code] || 0) - item.qty;
  });

  state.transfers.unshift(transfer);
  state.transferDraft = [];
  commit();
  alert("Stock envoyé. La boutique doit maintenant le recevoir.");
}

function clearTransferDraft() {
  if (!["Administrateur", "Magasinier"].includes(state.session?.role)) {
    alert("Accès réservé à l'administrateur ou au magasinier.");
    return;
  }

  if (state.transferDraft.length === 0) return;
  if (!confirm("Vider la liste des produits à envoyer ?")) return;
  state.transferDraft = [];
  commit();
}

function receiveTransfer(id) {
  if (!["Administrateur", "Caissier"].includes(state.session?.role)) {
    alert("Accès réservé à l'administrateur ou au caissier.");
    return;
  }

  const transfer = state.transfers.find((item) => item.id === id);
  if (!transfer || transfer.status !== "En attente") return;

  if (!confirm("Confirmer la réception de ce stock en boutique ?")) return;

  transfer.items.forEach((item) => {
    state.shop[item.code] = Number(state.shop[item.code] || 0) + item.qty;
  });

  transfer.status = "Reçu";
  transfer.receivedAt = todayText();
  commit();
}

function addToCart(event) {
  event.preventDefault();

  if (!["Administrateur", "Caissier"].includes(state.session?.role)) {
    alert("Accès réservé à l'administrateur ou au caissier.");
    return;
  }

  const code = document.getElementById("cartProduct").value;
  const qty = Number(document.getElementById("cartQty").value);
  const product = getProduct(code);
  const stock = Number(state.shop[code] || 0);

  if (!product || qty <= 0) {
    alert("Produit ou quantité invalide.");
    return;
  }

  const existing = state.cart.find((item) => item.code === code);
  const currentQty = existing ? existing.qty : 0;
  const newQty = currentQty + qty;

  if (newQty > stock) {
    alert(`Stock boutique insuffisant. Déjà au panier : ${currentQty}. Disponible : ${stock}`);
    return;
  }

  if (existing) {
    existing.qty = newQty;
    existing.total = existing.qty * existing.price;
  } else {
    state.cart.push({
      code,
      name: product.name,
      price: product.sellPrice,
      qty,
      total: product.sellPrice * qty
    });
  }

  document.getElementById("cartQty").value = "";
  commit();
}

function removeCartItem(code) {
  state.cart = state.cart.filter((item) => item.code !== code);
  commit();
}

function clearCart() {
  if (state.cart.length === 0) return;
  if (!confirm("Vider tout le panier ?")) return;
  state.cart = [];
  commit();
}

function validateSale(event) {
  event.preventDefault();

  if (!["Administrateur", "Caissier"].includes(state.session?.role)) {
    alert("Accès réservé à l'administrateur ou au caissier.");
    return;
  }

  if (state.cart.length === 0) {
    alert("Panier vide.");
    return;
  }

  const paymentMode = document.getElementById("paymentMode").value;
  const total = cartTotal();
  let paid = Number(document.getElementById("paidAmount").value);
  let change = 0;
  let momoNumber = "";
  let momoReference = "";

  if (!paymentMode) {
    alert("Choisissez un mode de paiement.");
    return;
  }

  if (paymentMode === "MoMo") {
    momoNumber = document.getElementById("momoNumber").value.trim();
    momoReference = document.getElementById("momoReference").value.trim();

    if (!momoNumber || !momoReference) {
      alert("Pour un paiement MoMo, le numéro de téléphone et la référence sont obligatoires.");
      return;
    }

    paid = total;

    if (!confirm(`Le paiement MoMo de ${money(total)} couvre-t-il le coût total d'achat ?`)) {
      alert("Paiement MoMo non confirmé. Vérifiez le paiement avant de valider.");
      return;
    }
  } else {
    if (paid <= 0 || paid < total) {
      alert("Montant payé insuffisant ou invalide.");
      return;
    }

    change = paid - total;
  }

  if (!confirm("Confirmer la vente ?")) return;

  const ticket = ticketId();
  const items = state.cart.map((item) => ({ ...item }));

  items.forEach((item) => {
    state.shop[item.code] = Number(state.shop[item.code] || 0) - item.qty;
  });

  const sale = {
    ticket,
    date: todayText(),
    dayKey: dateKey(),
    paymentMode,
    paid,
    change,
    total,
    momoNumber,
    momoReference,
    items
  };

  state.sales.unshift(sale);
  state.cart = [];
  document.getElementById("saleForm").reset();
  updatePaymentFields();
  commit();
  showView("sales");
  renderInvoice(sale);
  alert(`Vente enregistrée. Monnaie à rendre : ${money(change)}`);
}

function cartTotal() {
  return state.cart.reduce((sum, item) => sum + Number(item.total || 0), 0);
}

function commit(options = {}) {
  const settings = typeof options === "string" ? { action: options } : options;
  saveState();
  renderAll();
  return settings.sync === false ? Promise.resolve(true) : saveStateToServer(settings.action, settings.details);
}

function renderAll() {
  renderSelects();
  renderDashboard();
  renderProducts();
  renderUsers();
  renderWarehouse();
  renderShop();
  renderTransferDraft();
  renderPendingTransfers();
  renderTransfers();
  renderCart();
  renderCartProductInfo();
  updatePaymentFields();
  renderChangeDue();
  renderSales();
}

function renderSelects() {
  const options = state.products
    .map((product) => `<option value="${escapeHtml(product.code)}">${escapeHtml(product.code)} - ${escapeHtml(product.name)}</option>`)
    .join("");

  ["warehouseProduct", "transferProduct", "cartProduct"].forEach((id) => {
    document.getElementById(id).innerHTML = `<option value="">Choisir un produit</option>${options}`;
  });
}

function renderDashboard() {
  const warehouseQty = Object.values(state.warehouse).reduce((sum, qty) => sum + Number(qty || 0), 0);
  const shopQty = Object.values(state.shop).reduce((sum, qty) => sum + Number(qty || 0), 0);
  const todaySales = state.sales.filter((sale) => saleDayKey(sale) === dateKey());
  const salesTotal = todaySales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);

  document.getElementById("metricWarehouse").textContent = warehouseQty;
  document.getElementById("metricShop").textContent = shopQty;
  document.getElementById("metricSales").textContent = money(salesTotal);
  document.getElementById("metricTickets").textContent = todaySales.length;

  const pendingCount = pendingTransfers().length;
  const notif = document.getElementById("shopNotif");
  notif.textContent = pendingCount;
  notif.classList.toggle("hidden", pendingCount === 0);

  const alerts = state.products
    .filter((product) => Number(state.shop[product.code] || 0) <= 0)
    .map((product) => {
      const qty = Number(state.shop[product.code] || 0);
      const cls = qty === 0 ? "tag-danger" : "tag-warning";
      return `<p><strong>${escapeHtml(product.name)}</strong> : <span class="${cls}">${qty}</span> en boutique</p>`;
    })
    .join("");

  document.getElementById("stockAlerts").innerHTML = alerts || "Aucune alerte pour le moment.";
  renderStockChart("warehouseChart", "warehouse");
  renderStockChart("shopChart", "shop");
}

function renderStockChart(elementId, stockName) {
  const values = state.products.map((product) => ({
    code: product.code,
    name: product.name,
    qty: Number(state[stockName][product.code] || 0)
  }));
  const maxQty = Math.max(...values.map((item) => item.qty), 1);

  const rows = values.map((item) => {
    const width = Math.max(4, Math.round((item.qty / maxQty) * 100));
    return `
      <div class="bar-row">
        <div class="bar-label">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.code)}</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width: ${width}%"></div>
        </div>
        <b>${item.qty}</b>
      </div>
    `;
  }).join("");

  document.getElementById(elementId).innerHTML = rows || `<div class="empty">Aucun produit.</div>`;
}

function renderProducts() {
  const rows = state.products.map((product) => `
    <tr>
      <td>${escapeHtml(product.code)}</td>
      <td>${escapeHtml(product.name)}</td>
      <td class="num">${money(product.sellPrice)}</td>
      <td>${canDeleteProducts() ? `<button type="button" onclick="deleteProduct('${escapeJs(product.code)}')">Supprimer</button>` : ""}</td>
    </tr>
  `).join("");

  document.getElementById("productsTable").innerHTML = table(
    ["Code", "Nom", "Prix vente", ""],
    rows
  );
}

function renderUsers() {
  const rows = state.users.map((user) => `
    <tr>
      <td>${escapeHtml(user.name)}</td>
      <td>${escapeHtml(user.email || "")}</td>
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.role)}</td>
      <td>${canDeleteUsers(user.username) ? `<button type="button" class="button-danger" onclick="deleteUser('${escapeJs(user.username)}')">Supprimer</button>` : ""}</td>
    </tr>
  `).join("");

  document.getElementById("usersTable").innerHTML = table(["Nom", "Email", "Identifiant", "Role", "Actions"], rows);
}

function canDeleteUsers(username) {
  return isAdmin() && username !== ADMIN_USERNAME;
}

function deleteUser(username) {
  if (!isAdmin()) {
    alert("Suppression réservée à l'administrateur.");
    return;
  }

  if (username === ADMIN_USERNAME) {
    alert("Le compte administrateur principal ne peut pas être supprimé.");
    return;
  }

  const user = state.users.find((item) => item.username === username);
  if (!user) return;

  if (!confirm(`Supprimer l'utilisateur "${user.name}" ?`)) return;

  state.users = state.users.filter((item) => item.username !== username);
  commit();
}

function canDeleteProducts() {
  return isAdmin();
}

function deleteProduct(code) {
  if (!canDeleteProducts()) {
    alert("Suppression réservée à l'administrateur.");
    return;
  }

  const product = getProduct(code);
  if (!product) return;

  const warehouseQty = Number(state.warehouse[code] || 0);
  const shopQty = Number(state.shop[code] || 0);
  const isInCart = state.cart.some((item) => item.code === code);
  const isInDraft = state.transferDraft.some((item) => item.code === code);

  if (isInCart || isInDraft) {
    alert("Impossible de supprimer ce produit : il est dans le panier ou dans un envoi en préparation.");
    return;
  }

  let message = `Supprimer définitivement le produit "${product.name}" ?`;

  if (warehouseQty > 0 || shopQty > 0) {
    message += `\n\nAttention : ce produit a encore du stock.`;
    message += `\nStock magasin : ${warehouseQty}`;
    message += `\nStock boutique : ${shopQty}`;
  }

  if (!confirm(message)) return;

  state.products = state.products.filter((item) => item.code !== code);
  delete state.warehouse[code];
  delete state.shop[code];
  commit();
}

function renderWarehouse() {
  const rows = stockRows("warehouse");
  document.getElementById("warehouseTable").innerHTML = table(["Code", "Produit", "Quantité"], rows);
}

function renderShop() {
  const rows = stockRows("shop");
  document.getElementById("shopTable").innerHTML = table(["Code", "Produit", "Quantité"], rows);
}

function renderTransferDraft() {
  const rows = state.transferDraft.map((item) => `
    <tr>
      <td>${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.product)}</td>
      <td class="num">${item.qty}</td>
      <td><button type="button" onclick="removeTransferDraftItem('${escapeJs(item.code)}')">Retirer</button></td>
    </tr>
  `).join("");

  document.getElementById("transferDraftTable").innerHTML = table(["Code", "Produit", "Quantité", ""], rows);
}

function removeTransferDraftItem(code) {
  state.transferDraft = state.transferDraft.filter((item) => item.code !== code);
  commit();
}

function stockRows(stockName) {
  return state.products.map((product) => `
    <tr>
      <td>${escapeHtml(product.code)}</td>
      <td>${escapeHtml(product.name)}</td>
      <td class="num">${Number(state[stockName][product.code] || 0)}</td>
    </tr>
  `).join("");
}

function renderTransfers() {
  const rows = state.transfers.flatMap((transfer) => {
    if (!Array.isArray(transfer.items)) {
      return [`
        <tr>
          <td>${escapeHtml(transfer.date || "")}</td>
          <td>${escapeHtml(transfer.code || "")}</td>
          <td>${escapeHtml(transfer.product || "")}</td>
          <td class="num">${transfer.qty || 0}</td>
          <td>Reçu</td>
        </tr>
      `];
    }

    return transfer.items.map((item) => `
    <tr>
      <td>${escapeHtml(transfer.sentAt)}</td>
      <td>${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.product)}</td>
      <td class="num">${item.qty}</td>
      <td>${escapeHtml(transfer.status)}</td>
    </tr>
  `);
  }).join("");

  document.getElementById("transfersTable").innerHTML = table(["Date envoi", "Code", "Produit", "Quantité", "Statut"], rows);
}

function pendingTransfers() {
  return state.transfers.filter((transfer) => Array.isArray(transfer.items) && transfer.status === "En attente");
}

function renderPendingTransfers() {
  const rows = pendingTransfers().flatMap((transfer) => {
    const itemRows = transfer.items.map((item, index) => `
      <tr>
        <td>${index === 0 ? escapeHtml(transfer.sentAt) : ""}</td>
        <td>${escapeHtml(item.code)}</td>
        <td>${escapeHtml(item.product)}</td>
        <td class="num">${item.qty}</td>
        <td>${index === 0 && ["Administrateur", "Caissier"].includes(state.session?.role) ? `<button type="button" onclick="receiveTransfer('${escapeJs(transfer.id)}')">Recevoir</button>` : ""}</td>
      </tr>
    `);
    return itemRows;
  }).join("");

  document.getElementById("pendingTransfersTable").innerHTML = table(["Date envoi", "Code", "Produit", "Quantité", ""], rows);
}

function renderCart() {
  const rows = state.cart.map((item) => `
    <tr>
      <td>${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td class="num">${money(item.price)}</td>
      <td class="num">${item.qty}</td>
      <td class="num">${money(item.total)}</td>
      <td class="row-actions"><button type="button" class="button-danger" onclick="removeCartItem('${escapeJs(item.code)}')">Retirer</button></td>
    </tr>
  `).join("");

  document.getElementById("cartTable").innerHTML = table(["Code", "Produit", "PU", "Qté", "Total", ""], rows);
  document.getElementById("cartTotal").textContent = money(cartTotal());
  document.getElementById("cartInfo").textContent = "Si le produit existe déjà, la nouvelle quantité est ajoutée à l'ancienne.";
}

function renderCartProductInfo() {
  const code = document.getElementById("cartProduct").value;
  const product = getProduct(code);
  const info = document.getElementById("cartProductInfo");

  if (!product) {
    info.innerHTML = "<span>Sélectionner un produit</span>";
    return;
  }

  const shopQty = Number(state.shop[code] || 0);
  const inCart = state.cart.find((item) => item.code === code)?.qty || 0;

  info.innerHTML = `
    <strong>${escapeHtml(product.name)}</strong>
    <div class="product-info-row"><span>Code</span><b>${escapeHtml(product.code)}</b></div>
    <div class="product-info-row"><span>Prix</span><b>${money(product.sellPrice)}</b></div>
    <div class="product-info-row"><span>Stock boutique</span><b>${shopQty}</b></div>
    <div class="product-info-row"><span>Déjà au panier</span><b>${inCart}</b></div>
  `;
}

function renderChangeDue() {
  if (document.getElementById("paymentMode").value === "MoMo") {
    document.getElementById("changeDue").textContent = money(0);
    return;
  }

  const paid = Number(document.getElementById("paidAmount").value || 0);
  const change = Math.max(0, paid - cartTotal());
  document.getElementById("changeDue").textContent = money(change);
}

function updatePaymentFields() {
  const paymentMode = document.getElementById("paymentMode").value;
  const isMomo = paymentMode === "MoMo";
  const paidInput = document.getElementById("paidAmount");

  document.getElementById("momoBox").classList.toggle("hidden", !isMomo);
  document.getElementById("cashPaidField").classList.toggle("hidden", isMomo);

  document.getElementById("momoNumber").required = isMomo;
  document.getElementById("momoReference").required = isMomo;
  paidInput.required = !isMomo;

  if (isMomo) {
    paidInput.value = cartTotal();
  }
}

function renderSales() {
  const rows = state.sales
    .filter((sale) => !state.hiddenInvoiceTickets.includes(sale.ticket))
    .map((sale) => `
    <tr>
      <td>${escapeHtml(sale.date)}</td>
      <td>${escapeHtml(sale.ticket)}</td>
      <td>${escapeHtml(sale.paymentMode)}</td>
      <td class="num">${money(sale.total)}</td>
      <td class="num">${money(sale.paid)}</td>
      <td class="num">${money(sale.change)}</td>
      <td class="row-actions">
        <button type="button" onclick="showInvoice('${escapeJs(sale.ticket)}')">Facture</button>
        <button type="button" class="button-danger" onclick="deleteInvoice('${escapeJs(sale.ticket)}')">Supprimer facture</button>
      </td>
    </tr>
  `).join("");

  document.getElementById("salesTable").innerHTML = table(["Date", "Ticket", "Paiement", "Total", "Payé", "Monnaie", "Actions"], rows);
}

function showInvoice(ticket) {
  const sale = state.sales.find((item) => item.ticket === ticket);
  if (sale) renderInvoice(sale);
}

function deleteInvoice(ticket) {
  if (!confirm(`Supprimer la facture du ticket ${ticket} de cette liste ?\n\nLa vente restera enregistrée.`)) return;

  if (!state.hiddenInvoiceTickets.includes(ticket)) {
    state.hiddenInvoiceTickets.push(ticket);
  }
  const invoice = document.getElementById("invoicePreview");
  invoice.classList.add("hidden");
  invoice.innerHTML = "";
  commit();
}

function renderInvoice(sale) {
  const rows = sale.items.map((item) => `
    <tr>
      <td>${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td class="num">${item.qty}</td>
      <td class="num">${money(item.price)}</td>
      <td class="num">${money(item.total)}</td>
    </tr>
  `).join("");

  document.getElementById("invoicePreview").classList.remove("hidden");
  document.getElementById("invoicePreview").innerHTML = `
    <div class="invoice-head">
      <div>
        <h2>Facture</h2>
        <p>Ticket : <strong>${escapeHtml(sale.ticket)}</strong></p>
        <p>Date : ${escapeHtml(sale.date)}</p>
      </div>
      <div>
        <p>Paiement : <strong>${escapeHtml(sale.paymentMode)}</strong></p>
        ${sale.paymentMode === "MoMo" ? `
          <p>Numéro MoMo : <strong>${escapeHtml(sale.momoNumber || "")}</strong></p>
          <p>Référence MoMo : <strong>${escapeHtml(sale.momoReference || "")}</strong></p>
        ` : ""}
      </div>
    </div>
    ${table(["Code", "Produit", "Qté", "PU", "Montant"], rows)}
    <div class="total-line"><span>Total</span><strong>${money(sale.total)}</strong></div>
    <div class="total-line"><span>Payé</span><strong>${money(sale.paid)}</strong></div>
    <div class="total-line"><span>Monnaie</span><strong>${money(sale.change)}</strong></div>
    <button type="button" onclick="window.print()">Imprimer / enregistrer PDF</button>
  `;
}

function table(headers, rows) {
  if (!rows) return `<div class="empty">Aucune donnée.</div>`;

  return `
    <table>
      <thead>
        <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeJs(value) {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function downloadBackup() {
  if (!requireBackupAction("downloadBackup")) return;

  downloadFile("sauvegarde-gestion-boutique.json", JSON.stringify(state, null, 2), "application/json");
}

function restoreBackup(event) {
  if (!requireBackupAction("restoreBackup")) {
    event.target.value = "";
    return;
  }

  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.products) || !data.warehouse || !data.shop) {
        alert("Fichier de sauvegarde invalide.");
        return;
      }

      state = normalizeState(data);
      commit();
      alert("Sauvegarde restaurée.");
    } catch {
      alert("Impossible de lire la sauvegarde.");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

function exportProductsCsv() {
  if (!requireBackupAction("exportProducts")) return;

  const rows = [["Code", "Nom", "Prix vente"]];
  state.products.forEach((product) => {
    rows.push([product.code, product.name, product.sellPrice]);
  });
  downloadCsv("produits.csv", rows);
}

function exportStocksCsv() {
  if (!requireBackupAction("exportStocks")) return;

  const rows = [["Code", "Produit", "Stock magasin", "Stock boutique"]];
  state.products.forEach((product) => {
    rows.push([product.code, product.name, state.warehouse[product.code] || 0, state.shop[product.code] || 0]);
  });
  downloadCsv("stocks.csv", rows);
}

function exportSalesCsv() {
  if (!requireBackupAction("exportSales")) return;

  const rows = [["Date", "Ticket", "Paiement", "Numero MoMo", "Reference MoMo", "Code", "Produit", "Quantite", "Prix", "Montant", "Total ticket", "Paye", "Monnaie"]];
  state.sales.forEach((sale) => {
    sale.items.forEach((item) => {
      rows.push([sale.date, sale.ticket, sale.paymentMode, sale.momoNumber || "", sale.momoReference || "", item.code, item.name, item.qty, item.price, item.total, sale.total, sale.paid, sale.change]);
    });
  });
  downloadCsv("ventes.csv", rows);
}

function downloadCsv(filename, rows) {
  const content = rows.map((row) => row.map(csvCell).join(";")).join("\n");
  downloadFile(filename, `\ufeff${content}`, "text/csv;charset=utf-8");
}

function csvCell(value) {
  const text = String(value ?? "").replaceAll('"', '""');
  return `"${text}"`;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
