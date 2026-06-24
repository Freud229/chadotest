const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const DB_XLSX = path.join(DATA_DIR, "GestionBoutique_DB.xlsx");
const DB_JSON = path.join(DATA_DIR, "GestionBoutique_DB.json");
const PORT = Number(process.argv.find((arg) => /^\d+$/.test(arg)) || process.env.PORT || 3721);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "1234@dmin100%";

const defaultState = {
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

let state = loadInitialState();

if (process.argv.includes("--init-db")) {
  saveDatabase(state, "initialisation", { source: "server-init" });
  console.log(`Base Excel prete : ${DB_XLSX}`);
  process.exit(0);
}

const server = http.createServer((req, res) => {
  addCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, database: DB_XLSX });
    return;
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    readJsonBody(req)
      .then((body) => {
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        const user = state.users.find((item) => item.username === username && item.password === password);

        if (!user) {
          sendJson(res, 401, { ok: false, message: "Utilisateur ou mot de passe incorrect." });
          return;
        }

        sendJson(res, 200, { ok: true, user: publicUser(user) });
      })
      .catch((error) => {
        sendJson(res, 400, { ok: false, message: "Requete de connexion invalide.", error: error.message });
      });
    return;
  }

  if (url.pathname === "/api/state" && req.method === "GET") {
    sendJson(res, 200, publicState(state));
    return;
  }

  if (url.pathname === "/api/state" && req.method === "POST") {
    readJsonBody(req)
      .then((body) => {
        const incomingState = body.state || body;
        const nextState = normalizeState({
          ...incomingState,
          users: mergeUserPasswords(incomingState.users, state.users)
        });
        nextState.journal = Array.isArray(state.journal) ? state.journal.slice() : [];

        if (body.action) {
          nextState.journal.push({
            date: new Date().toLocaleString("fr-FR"),
            user: nextState.session?.username || "",
            action: String(body.action),
            details: stringifyDetails(body.details)
          });
        }

        saveDatabase(nextState, body.action || "mise_a_jour", body.details || {});
        state = nextState;
        sendJson(res, 200, { ok: true, savedAt: new Date().toLocaleString("fr-FR") });
      })
      .catch((error) => {
        sendJson(res, 500, {
          ok: false,
          message: "Impossible d'enregistrer dans la base Excel.",
          error: error.message
        });
      });
    return;
  }

  if (url.pathname === "/api/database" && req.method === "GET") {
    sendFile(res, DB_XLSX, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "GestionBoutique_DB.xlsx");
    return;
  }

  serveStatic(url.pathname, res);
});

server.listen(PORT, HOST, () => {
  console.log("Gestion Boutique est lancee.");
  console.log(`Application : http://${HOST}:${PORT}/`);
  console.log(`Base Excel  : ${DB_XLSX}`);
  console.log("Gardez cette fenetre ouverte pendant l'utilisation.");
});

function loadInitialState() {
  ensureDataDir();

  if (fs.existsSync(DB_XLSX)) {
    try {
      return normalizeState(readStateFromWorkbook(DB_XLSX));
    } catch (error) {
      console.warn(`Lecture Excel impossible, tentative JSON : ${error.message}`);
    }
  }

  if (fs.existsSync(DB_JSON)) {
    try {
      return normalizeState(JSON.parse(fs.readFileSync(DB_JSON, "utf8")));
    } catch (error) {
      console.warn(`Lecture JSON impossible : ${error.message}`);
    }
  }

  const seeded = structuredClone(defaultState);
  saveDatabase(seeded, "creation_base", { source: "default-state" });
  return seeded;
}

function saveDatabase(nextState) {
  ensureDataDir();
  const normalized = normalizeState(nextState);
  const workbook = createWorkbookBuffer(normalized);
  const tmpXlsx = `${DB_XLSX}.tmp`;

  fs.writeFileSync(tmpXlsx, workbook);
  fs.renameSync(tmpXlsx, DB_XLSX);
  fs.writeFileSync(DB_JSON, JSON.stringify({ ...normalized, session: null }, null, 2), "utf8");
}

function publicState(value) {
  const normalized = normalizeState(value);

  return {
    ...normalized,
    session: null,
    users: normalized.users.map(publicUser)
  };
}

function publicUser(user) {
  return {
    name: user.name,
    email: user.email || "",
    username: user.username,
    role: normalizeRole(user.role)
  };
}

function mergeUserPasswords(users, existingUsers) {
  if (!Array.isArray(users) || !users.length) return users;

  const existingByUsername = new Map(
    (Array.isArray(existingUsers) ? existingUsers : [])
      .map((user) => [String(user.username || "").toLowerCase(), user])
  );

  return users.map((user) => {
    const username = String(user.username || "");
    const existing = existingByUsername.get(username.toLowerCase());

    return {
      ...user,
      password: username === ADMIN_USERNAME ? ADMIN_PASSWORD : String(user.password || existing?.password || "")
    };
  });
}

function normalizeState(data) {
  const source = data && typeof data === "object" ? data : {};
  const products = Array.isArray(source.products) ? source.products : defaultState.products;
  const users = Array.isArray(source.users) && source.users.length ? source.users : defaultState.users;

  const normalized = {
    ...structuredClone(defaultState),
    ...source,
    session: source.session || null,
    users: users.map((user) => ({
      name: String(user.name || user.username || ""),
      email: String(user.email || ""),
      username: String(user.username || ""),
      password: String(user.username || "") === ADMIN_USERNAME ? ADMIN_PASSWORD : String(user.password || ""),
      role: normalizeRole(user.role)
    })).filter((user) => user.username),
    products: products.map((product) => ({
      code: String(product.code || "").trim(),
      name: String(product.name || "").trim(),
      sellPrice: Number(product.sellPrice || product.price || 0)
    })).filter((product) => product.code && product.name),
    warehouse: normalizeStockMap(source.warehouse),
    shop: normalizeStockMap(source.shop),
    transferDraft: Array.isArray(source.transferDraft) ? source.transferDraft.map(normalizeTransferLine).filter(Boolean) : [],
    transfers: Array.isArray(source.transfers) ? source.transfers.map(normalizeTransfer).filter(Boolean) : [],
    hiddenInvoiceTickets: Array.isArray(source.hiddenInvoiceTickets) ? source.hiddenInvoiceTickets.map(String) : [],
    sales: Array.isArray(source.sales) ? source.sales.map(normalizeSale).filter(Boolean) : [],
    cart: Array.isArray(source.cart) ? source.cart.map(normalizeCartLine).filter(Boolean) : [],
    journal: Array.isArray(source.journal) ? source.journal.map(normalizeJournalLine).filter(Boolean) : []
  };

  normalized.products.forEach((product) => {
    if (!Object.prototype.hasOwnProperty.call(normalized.warehouse, product.code)) normalized.warehouse[product.code] = 0;
    if (!Object.prototype.hasOwnProperty.call(normalized.shop, product.code)) normalized.shop[product.code] = 0;
  });

  return normalized;
}

function normalizeRole(role) {
  if (role === "Admin") return "Administrateur";
  if (["Administrateur", "Magasinier", "Caissier"].includes(role)) return role;
  return "Caissier";
}

function normalizeStockMap(value) {
  const stock = {};
  if (!value || typeof value !== "object") return stock;

  Object.entries(value).forEach(([code, qty]) => {
    stock[String(code)] = Number(qty || 0);
  });

  return stock;
}

function normalizeTransferLine(item) {
  if (!item || !item.code) return null;
  return {
    code: String(item.code),
    product: String(item.product || item.name || ""),
    qty: Number(item.qty || 0)
  };
}

function normalizeTransfer(item) {
  if (!item || !item.id) return null;
  return {
    id: String(item.id),
    sentAt: String(item.sentAt || ""),
    status: String(item.status || "En attente"),
    receivedAt: String(item.receivedAt || ""),
    sentBy: String(item.sentBy || ""),
    receivedBy: String(item.receivedBy || ""),
    items: Array.isArray(item.items) ? item.items.map(normalizeTransferLine).filter(Boolean) : []
  };
}

function normalizeCartLine(item) {
  if (!item || !item.code) return null;
  const price = Number(item.price || item.sellPrice || 0);
  const qty = Number(item.qty || 0);

  return {
    code: String(item.code),
    name: String(item.name || item.product || ""),
    price,
    qty,
    total: Number(item.total || price * qty)
  };
}

function normalizeSale(item) {
  if (!item || !item.ticket) return null;
  return {
    ticket: String(item.ticket),
    date: String(item.date || ""),
    dayKey: String(item.dayKey || ""),
    paymentMode: String(item.paymentMode || ""),
    total: Number(item.total || 0),
    paid: Number(item.paid || 0),
    change: Number(item.change || 0),
    momoNumber: String(item.momoNumber || ""),
    momoReference: String(item.momoReference || ""),
    cashier: String(item.cashier || ""),
    items: Array.isArray(item.items) ? item.items.map(normalizeCartLine).filter(Boolean) : []
  };
}

function normalizeJournalLine(item) {
  if (!item) return null;
  return {
    date: String(item.date || ""),
    user: String(item.user || ""),
    action: String(item.action || ""),
    details: String(item.details || "")
  };
}

function createWorkbookBuffer(value) {
  const sheets = buildSheets(value);
  const files = [
    ["[Content_Types].xml", contentTypesXml(sheets)],
    ["_rels/.rels", rootRelsXml()],
    ["docProps/core.xml", coreXml()],
    ["docProps/app.xml", appXml(sheets)],
    ["xl/workbook.xml", workbookXml(sheets)],
    ["xl/_rels/workbook.xml.rels", workbookRelsXml(sheets)],
    ["xl/styles.xml", stylesXml()],
    ...sheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet)])
  ];

  return zipFiles(files.map(([name, text]) => ({ name, data: Buffer.from(text, "utf8") })));
}

function buildSheets(value) {
  const productName = (code) => value.products.find((item) => item.code === code)?.name || "";

  return [
    {
      name: "Produits",
      headers: ["Code", "Nom", "Prix vente"],
      rows: value.products.map((product) => [product.code, product.name, product.sellPrice])
    },
    {
      name: "Stock_Magasin",
      headers: ["Code", "Produit", "Quantite"],
      rows: value.products.map((product) => [product.code, product.name, Number(value.warehouse[product.code] || 0)])
    },
    {
      name: "Stock_Boutique",
      headers: ["Code", "Produit", "Quantite"],
      rows: value.products.map((product) => [product.code, product.name, Number(value.shop[product.code] || 0)])
    },
    {
      name: "Transferts",
      headers: ["ID", "Date envoi", "Statut", "Date reception", "Envoye par", "Recu par"],
      rows: value.transfers.map((transfer) => [
        transfer.id,
        transfer.sentAt,
        transfer.status,
        transfer.receivedAt || "",
        transfer.sentBy || "",
        transfer.receivedBy || ""
      ])
    },
    {
      name: "Lignes_Transfert",
      headers: ["ID transfert", "Code", "Produit", "Quantite"],
      rows: value.transfers.flatMap((transfer) => transfer.items.map((item) => [
        transfer.id,
        item.code,
        item.product,
        item.qty
      ]))
    },
    {
      name: "Envoi_En_Cours",
      headers: ["Code", "Produit", "Quantite"],
      rows: value.transferDraft.map((item) => [item.code, item.product || productName(item.code), item.qty])
    },
    {
      name: "Ventes",
      headers: ["Ticket", "Date", "Jour", "Paiement", "Total", "Paye", "Monnaie", "Numero MoMo", "Reference MoMo", "Caissier"],
      rows: value.sales.map((sale) => [
        sale.ticket,
        sale.date,
        sale.dayKey || "",
        sale.paymentMode,
        sale.total,
        sale.paid,
        sale.change,
        sale.momoNumber || "",
        sale.momoReference || "",
        sale.cashier || ""
      ])
    },
    {
      name: "Lignes_Vente",
      headers: ["Ticket", "Code", "Produit", "Quantite", "Prix", "Montant"],
      rows: value.sales.flatMap((sale) => sale.items.map((item) => [
        sale.ticket,
        item.code,
        item.name,
        item.qty,
        item.price,
        item.total
      ]))
    },
    {
      name: "Tickets",
      headers: ["Ticket", "Masque"],
      rows: value.hiddenInvoiceTickets.map((ticket) => [ticket, "Oui"])
    },
    {
      name: "Panier_En_Cours",
      headers: ["Code", "Produit", "Prix", "Quantite", "Total"],
      rows: value.cart.map((item) => [item.code, item.name, item.price, item.qty, item.total])
    },
    {
      name: "Utilisateurs",
      headers: ["Nom", "Email", "Identifiant", "Mot de passe", "Role"],
      rows: value.users.map((user) => [user.name, user.email || "", user.username, user.password, user.role])
    },
    {
      name: "Journal",
      headers: ["Date", "Utilisateur", "Action", "Details"],
      rows: value.journal.map((item) => [item.date, item.user, item.action, item.details])
    },
    {
      name: "Meta",
      headers: ["Cle", "Valeur"],
      rows: [
        ["application", "Gestion Boutique"],
        ["schema_version", "1"],
        ["dernier_enregistrement", new Date().toLocaleString("fr-FR")]
      ]
    }
  ];
}

function readStateFromWorkbook(filePath) {
  const files = unzipFiles(fs.readFileSync(filePath));
  const sheets = parseWorkbookSheets(files);
  const products = sheetObjects(sheets.Produits).map((row) => ({
    code: text(row.Code),
    name: text(row.Nom),
    sellPrice: number(row["Prix vente"])
  })).filter((product) => product.code && product.name);

  const warehouse = {};
  sheetObjects(sheets.Stock_Magasin).forEach((row) => {
    if (row.Code) warehouse[text(row.Code)] = number(row.Quantite);
  });

  const shop = {};
  sheetObjects(sheets.Stock_Boutique).forEach((row) => {
    if (row.Code) shop[text(row.Code)] = number(row.Quantite);
  });

  const transferLines = groupBy(sheetObjects(sheets.Lignes_Transfert), (row) => text(row["ID transfert"]));
  const transfers = sheetObjects(sheets.Transferts).map((row) => {
    const id = text(row.ID);
    return {
      id,
      sentAt: text(row["Date envoi"]),
      status: text(row.Statut) || "En attente",
      receivedAt: text(row["Date reception"]),
      sentBy: text(row["Envoye par"]),
      receivedBy: text(row["Recu par"]),
      items: (transferLines[id] || []).map((line) => ({
        code: text(line.Code),
        product: text(line.Produit),
        qty: number(line.Quantite)
      }))
    };
  }).filter((transfer) => transfer.id);

  const saleLines = groupBy(sheetObjects(sheets.Lignes_Vente), (row) => text(row.Ticket));
  const sales = sheetObjects(sheets.Ventes).map((row) => {
    const ticket = text(row.Ticket);
    return {
      ticket,
      date: text(row.Date),
      dayKey: text(row.Jour),
      paymentMode: text(row.Paiement),
      total: number(row.Total),
      paid: number(row.Paye),
      change: number(row.Monnaie),
      momoNumber: text(row["Numero MoMo"]),
      momoReference: text(row["Reference MoMo"]),
      cashier: text(row.Caissier),
      items: (saleLines[ticket] || []).map((line) => ({
        code: text(line.Code),
        name: text(line.Produit),
        qty: number(line.Quantite),
        price: number(line.Prix),
        total: number(line.Montant)
      }))
    };
  }).filter((sale) => sale.ticket);

  return normalizeState({
    session: null,
    products,
    warehouse,
    shop,
    transfers,
    transferDraft: sheetObjects(sheets.Envoi_En_Cours).map((row) => ({
      code: text(row.Code),
      product: text(row.Produit),
      qty: number(row.Quantite)
    })).filter((row) => row.code),
    sales,
    hiddenInvoiceTickets: sheetObjects(sheets.Tickets).map((row) => text(row.Ticket)).filter(Boolean),
    cart: sheetObjects(sheets.Panier_En_Cours).map((row) => ({
      code: text(row.Code),
      name: text(row.Produit),
      price: number(row.Prix),
      qty: number(row.Quantite),
      total: number(row.Total)
    })).filter((row) => row.code),
    users: sheetObjects(sheets.Utilisateurs).map((row) => ({
      name: text(row.Nom),
      email: text(row.Email || row.Mail),
      username: text(row.Identifiant),
      password: text(row["Mot de passe"]),
      role: text(row.Role)
    })).filter((row) => row.username),
    journal: sheetObjects(sheets.Journal).map((row) => ({
      date: text(row.Date),
      user: text(row.Utilisateur),
      action: text(row.Action),
      details: text(row.Details)
    }))
  });
}

function contentTypesXml(sheets) {
  const sheetOverrides = sheets.map((_, index) => (
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )).join("");

  return xmlDoc(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
    <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
    <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
    <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
    ${sheetOverrides}
  </Types>`);
}

function rootRelsXml() {
  return xmlDoc(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
    <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
  </Relationships>`);
}

function workbookXml(sheets) {
  const sheetTags = sheets.map((sheet, index) => (
    `<sheet name="${xmlAttr(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  )).join("");

  return xmlDoc(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <sheets>${sheetTags}</sheets>
  </workbook>`);
}

function workbookRelsXml(sheets) {
  const sheetRels = sheets.map((_, index) => (
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  )).join("");

  return xmlDoc(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    ${sheetRels}
    <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  </Relationships>`);
}

function coreXml() {
  const now = new Date().toISOString();

  return xmlDoc(`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <dc:title>Gestion Boutique DB</dc:title>
    <dc:creator>Gestion Boutique</dc:creator>
    <cp:lastModifiedBy>Gestion Boutique</cp:lastModifiedBy>
    <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
    <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
  </cp:coreProperties>`);
}

function appXml(sheets) {
  return xmlDoc(`<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
    <Application>Gestion Boutique</Application>
    <DocSecurity>0</DocSecurity>
    <ScaleCrop>false</ScaleCrop>
    <HeadingPairs>
      <vt:vector size="2" baseType="variant">
        <vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>
        <vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant>
      </vt:vector>
    </HeadingPairs>
    <TitlesOfParts>
      <vt:vector size="${sheets.length}" baseType="lpstr">
        ${sheets.map((sheet) => `<vt:lpstr>${xmlText(sheet.name)}</vt:lpstr>`).join("")}
      </vt:vector>
    </TitlesOfParts>
  </Properties>`);
}

function stylesXml() {
  return xmlDoc(`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <fonts count="2">
      <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
      <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
    </fonts>
    <fills count="3">
      <fill><patternFill patternType="none"/></fill>
      <fill><patternFill patternType="gray125"/></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill>
    </fills>
    <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
    <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
    <cellXfs count="2">
      <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
      <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    </cellXfs>
    <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  </styleSheet>`);
}

function worksheetXml(sheet) {
  const rows = [sheet.headers, ...sheet.rows];
  const maxCols = Math.max(sheet.headers.length, ...sheet.rows.map((row) => row.length), 1);
  const maxRows = Math.max(rows.length, 1);
  const lastCell = `${columnName(maxCols)}${maxRows}`;

  const rowXml = rows.map((row, rowIndex) => {
    const cells = Array.from({ length: maxCols }, (_, colIndex) => {
      const value = row[colIndex] ?? "";
      const ref = `${columnName(colIndex + 1)}${rowIndex + 1}`;
      return cellXml(ref, value, rowIndex === 0);
    }).join("");

    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");

  return xmlDoc(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <dimension ref="A1:${lastCell}"/>
    <sheetViews>
      <sheetView workbookViewId="0">
        <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      </sheetView>
    </sheetViews>
    <sheetFormatPr defaultRowHeight="15"/>
    <cols>${columnWidths(maxCols)}</cols>
    <sheetData>${rowXml}</sheetData>
    <autoFilter ref="A1:${columnName(maxCols)}1"/>
  </worksheet>`);
}

function cellXml(ref, value, isHeader) {
  const style = isHeader ? ' s="1"' : "";

  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  }

  return `<c r="${ref}" t="inlineStr"${style}><is><t>${xmlText(value)}</t></is></c>`;
}

function columnWidths(count) {
  return Array.from({ length: count }, (_, index) => {
    const width = index === 0 ? 18 : index === 1 ? 28 : 16;
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join("");
}

function parseWorkbookSheets(files) {
  const workbook = files["xl/workbook.xml"];
  const rels = files["xl/_rels/workbook.xml.rels"];
  if (!workbook || !rels) throw new Error("Structure XLSX invalide.");

  const relMap = {};
  for (const match of rels.matchAll(/<Relationship\b([^>]+)>/g)) {
    const attrs = parseAttrs(match[1]);
    if (attrs.Id && attrs.Target) relMap[attrs.Id] = attrs.Target;
  }

  const sharedStrings = parseSharedStrings(files["xl/sharedStrings.xml"] || "");
  const result = {};

  for (const match of workbook.matchAll(/<sheet\b([^>]+)>/g)) {
    const attrs = parseAttrs(match[1]);
    const target = relMap[attrs["r:id"]];
    if (!attrs.name || !target) continue;

    const sheetPath = `xl/${target.replace(/^\/?xl\//, "")}`;
    const rows = parseWorksheet(files[sheetPath] || "", sharedStrings);
    result[xmlUnescape(attrs.name)] = rows;
  }

  return result;
}

function parseWorksheet(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = parseAttrs(cellMatch[1]);
      const colIndex = cellColumnIndex(attrs.r || "") || row.length;
      row[colIndex] = parseCellValue(attrs, cellMatch[2], sharedStrings);
    }
    rows.push(row);
  }

  return rows;
}

function parseCellValue(attrs, xml, sharedStrings) {
  if (attrs.t === "inlineStr") {
    const match = xml.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/);
    return match ? xmlUnescape(match[1]) : "";
  }

  const valueMatch = xml.match(/<v>([\s\S]*?)<\/v>/);
  if (!valueMatch) return "";

  const raw = xmlUnescape(valueMatch[1]);
  if (attrs.t === "s") return sharedStrings[Number(raw)] || "";
  const numeric = Number(raw);
  return Number.isFinite(numeric) && raw.trim() !== "" ? numeric : raw;
}

function parseSharedStrings(xml) {
  const strings = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const textParts = [];
    for (const textMatch of match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
      textParts.push(xmlUnescape(textMatch[1]));
    }
    strings.push(textParts.join(""));
  }
  return strings;
}

function sheetObjects(rows = []) {
  if (!rows.length) return [];
  const headers = rows[0].map((header) => text(header));

  return rows.slice(1).map((row) => {
    const object = {};
    headers.forEach((header, index) => {
      object[header] = row[index] ?? "";
    });
    return object;
  });
}

function groupBy(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item);
    if (!key) return groups;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
    return groups;
  }, {});
}

function unzipFiles(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const files = {};
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Archive XLSX invalide.");

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLength).toString("utf8");

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    const data = method === 8 ? zlib.inflateRawSync(compressed) : compressed;
    files[name] = data.toString("utf8");

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

function zipFiles(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((file) => {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const { time, date } = dosTimeDate(new Date());
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + compressed.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

function findEndOfCentralDirectory(buffer) {
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Fin d'archive XLSX introuvable.");
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let c = index;
    for (let bit = 0; bit < 8; bit += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[index] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  const table = crc32.table || (crc32.table = createCrcTable());
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let c = index;
    for (let bit = 0; bit < 8; bit += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[index] = c >>> 0;
  }
  return table;
}

function dosTimeDate(dateValue) {
  const year = Math.max(1980, dateValue.getFullYear());
  return {
    time: (dateValue.getHours() << 11) | (dateValue.getMinutes() << 5) | Math.floor(dateValue.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((dateValue.getMonth() + 1) << 5) | dateValue.getDate()
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) {
        reject(new Error("Requete trop volumineuse."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON invalide."));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(urlPath, res) {
  const safePath = urlPath === "/" ? "/index.html" : decodeURIComponent(urlPath);
  const filePath = path.resolve(ROOT_DIR, `.${safePath}`);
  const root = path.resolve(ROOT_DIR);

  if (!filePath.toLowerCase().startsWith(root.toLowerCase())) {
    sendText(res, 403, "Acces refuse.");
    return;
  }

  if (filePath.startsWith(DATA_DIR) && !filePath.endsWith(".xlsx")) {
    sendText(res, 403, "Acces refuse.");
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendText(res, 404, "Fichier introuvable.");
    return;
  }

  sendFile(res, filePath, mimeType(filePath));
}

function sendFile(res, filePath, type, downloadName = "") {
  if (!fs.existsSync(filePath)) {
    sendText(res, 404, "Fichier introuvable.");
    return;
  }

  const headers = {
    "Content-Type": type || "application/octet-stream"
  };

  if (downloadName) {
    headers["Content-Disposition"] = `attachment; filename="${downloadName}"`;
  }

  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function sendText(res, status, value) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(value);
}

function addCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }[ext] || "application/octet-stream";
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function xmlDoc(content) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${content.replace(/>\s+</g, "><").trim()}`;
}

function xmlText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function xmlAttr(value) {
  return xmlText(value).replaceAll('"', "&quot;");
}

function xmlUnescape(value) {
  return String(value ?? "")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseAttrs(value) {
  const attrs = {};
  for (const match of String(value || "").matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function columnName(index) {
  let name = "";
  let value = index;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function cellColumnIndex(ref) {
  const match = String(ref).match(/^([A-Z]+)/);
  if (!match) return 0;
  return match[1].split("").reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringifyDetails(details) {
  if (details === undefined || details === null) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}
