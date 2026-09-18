(() => {
  "use strict";

  const STORAGE_KEY = "everest-raffle-machine-v1";
  const COLORS = ["#b7862e", "#2f6e62", "#7d3f4c", "#394f78", "#75558b", "#9b5a31", "#3e786e", "#8a7334", "#5b477a", "#356173", "#87483f", "#586739"];
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const defaultPool = () => ({ players: [], prizes: [], repeatWinners: true, sessionWinners: [], rotation: 0 });
  const defaultState = () => ({ version: 1, activePool: "daily", pools: { daily: defaultPool(), weekly: defaultPool() }, history: [] });

  let state = loadState();
  let pendingResult = null;
  let pendingConfirmation = null;
  let toastTimer = null;
  let spinning = false;
  let importDraft = null;

  const els = {
    raffleView: $("#raffleView"), historyView: $("#historyView"), poolLabel: $("#poolLabel"), poolTitle: $("#poolTitle"),
    playerCount: $("#playerCount"), ticketCount: $("#ticketCount"), prizeCount: $("#prizeCount"), playerList: $("#playerList"), prizeList: $("#prizeList"),
    playerForm: $("#playerForm"), prizeForm: $("#prizeForm"), playerName: $("#playerName"), memberId: $("#memberId"), initialTickets: $("#initialTickets"),
    prizeName: $("#prizeName"), prizeQuantity: $("#prizeQuantity"), currentPrize: $("#currentPrize"), repeatToggle: $("#repeatToggle"),
    wheel: $("#wheel"), wheelLabels: $("#wheelLabels"), emptyWheel: $("#emptyWheel"), chanceStrip: $("#chanceStrip"), drawBtn: $("#drawBtn"),
    drawButtonSub: $("#drawButtonSub"), eligibilityNote: $("#eligibilityNote"), historyBody: $("#historyBody"), emptyHistory: $("#emptyHistory"),
    winnerDialog: $("#winnerDialog"), winnerName: $("#winnerName"), winnerId: $("#winnerId"), winnerPrize: $("#winnerPrize"), winnerTicketText: $("#winnerTicketText"),
    dataDialog: $("#dataDialog"), confirmDialog: $("#confirmDialog"), confirmTitle: $("#confirmTitle"), confirmMessage: $("#confirmMessage"),
    toast: $("#toast"), importDialog: $("#importDialog"), importFile: $("#importFile"), importOptions: $("#importOptions"),
    importPreview: $("#importPreview"), applyImportBtn: $("#applyImportBtn")
  };

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || !parsed.pools?.daily || !parsed.pools?.weekly || !Array.isArray(parsed.history)) return defaultState();
      for (const key of ["daily", "weekly"]) {
        parsed.pools[key].players ||= [];
        parsed.pools[key].prizes ||= [];
        parsed.pools[key].sessionWinners ||= [];
        parsed.pools[key].repeatWinners ??= true;
        parsed.pools[key].rotation ||= 0;
      }
      return parsed;
    } catch { return defaultState(); }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function activePool() { return state.pools[state.activePool]; }
  function totalTickets(players = activePool().players) { return players.reduce((sum, p) => sum + Math.max(0, Number(p.tickets) || 0), 0); }
  function nextPrize(pool = activePool()) { return pool.prizes.find((p) => p.remaining > 0); }
  function eligiblePlayers(pool = activePool()) {
    return pool.players.filter((p) => p.tickets > 0 && (pool.repeatWinners || !pool.sessionWinners.includes(p.id)));
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
  }

  function render() {
    const isHistory = state.activePool === "history";
    els.raffleView.hidden = isHistory;
    els.historyView.hidden = !isHistory;
    $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.pool === state.activePool));
    if (isHistory) { renderHistory(); return; }

    const pool = activePool();
    const label = state.activePool.toUpperCase();
    els.poolLabel.textContent = `${label} POOL`;
    els.poolTitle.textContent = `${label[0]}${label.slice(1).toLowerCase()} Raffle`;
    els.playerCount.textContent = pool.players.length;
    els.ticketCount.textContent = totalTickets(pool.players).toLocaleString();
    els.prizeCount.textContent = pool.prizes.reduce((sum, p) => sum + p.remaining, 0).toLocaleString();
    els.repeatToggle.checked = pool.repeatWinners;
    els.currentPrize.textContent = nextPrize(pool)?.name || "Add a prize to begin";
    renderPlayers();
    renderPrizes();
    renderWheel();
    renderDrawState();
  }

  function renderPlayers() {
    const pool = activePool();
    if (!pool.players.length) {
      els.playerList.innerHTML = '<div class="empty-list">No players in this pool.</div>';
      return;
    }
    const eligibleTotal = totalTickets(eligiblePlayers(pool));
    const sorted = [...pool.players].sort((a, b) => b.tickets - a.tickets || a.name.localeCompare(b.name));
    els.playerList.innerHTML = sorted.map((p) => {
      const excluded = !pool.repeatWinners && pool.sessionWinners.includes(p.id);
      const chance = !excluded && eligibleTotal ? `${(p.tickets / eligibleTotal * 100).toFixed(1)}% chance` : excluded ? "Session winner · excluded" : "0% chance";
      return `
      <article class="player-card" data-player-id="${p.id}">
        <div class="identity"><b title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</b><span>ID ${escapeHtml(p.memberId)} · ${chance}</span></div>
        <div class="ticket-control">
          <button class="mini-button" data-action="decrease" type="button" aria-label="Remove one ticket from ${escapeHtml(p.name)}">−</button>
          <span class="ticket-count" title="${p.tickets} tickets">${p.tickets}</span>
          <button class="mini-button" data-action="increase" type="button" aria-label="Add one ticket to ${escapeHtml(p.name)}">+</button>
          <button class="mini-button delete" data-action="delete" type="button" aria-label="Delete ${escapeHtml(p.name)}">×</button>
        </div>
      </article>`;
    }).join("");
  }

  function renderPrizes() {
    const pool = activePool();
    if (!pool.prizes.length) {
      els.prizeList.innerHTML = '<div class="empty-list">No prizes in the queue.</div>';
      return;
    }
    const currentId = nextPrize(pool)?.id;
    els.prizeList.innerHTML = pool.prizes.map((p, index) => {
      const drawn = p.quantity - p.remaining;
      const canDecrease = p.quantity > Math.max(1, drawn);
      return `
      <article class="prize-card ${p.id === currentId ? "current" : ""} ${p.remaining === 0 ? "completed" : ""}" data-prize-id="${p.id}">
        <span class="prize-index">${p.remaining === 0 ? "✓" : String(index + 1).padStart(2, "0")}</span>
        <div class="prize-identity">
          <b title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</b>
          <span>${p.id === currentId ? "NEXT DRAW · " : ""}${p.remaining} left${drawn ? ` · ${drawn} drawn` : ""}</span>
        </div>
        <div class="prize-quantity" aria-label="Prize quantity">
          <button class="mini-button" data-action="decrease-prize" type="button" aria-label="Decrease ${escapeHtml(p.name)} quantity" ${canDecrease ? "" : "disabled"}>−</button>
          <strong title="Total quantity">${p.quantity}</strong>
          <button class="mini-button" data-action="increase-prize" type="button" aria-label="Increase ${escapeHtml(p.name)} quantity">+</button>
        </div>
        <div class="prize-order" aria-label="Drawing order">
          <button class="mini-button" data-action="move-prize-up" type="button" aria-label="Move ${escapeHtml(p.name)} earlier" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="mini-button" data-action="move-prize-down" type="button" aria-label="Move ${escapeHtml(p.name)} later" ${index === pool.prizes.length - 1 ? "disabled" : ""}>↓</button>
        </div>
        <button class="mini-button delete" data-action="delete-prize" type="button" aria-label="Delete ${escapeHtml(p.name)}">×</button>
      </article>`;
    }).join("");
  }

  function wheelData() {
    const players = eligiblePlayers();
    const total = totalTickets(players);
    let cursor = 0;
    return players.map((player, index) => {
      const size = total ? player.tickets / total * 360 : 0;
      const item = { player, start: cursor, end: cursor + size, mid: cursor + size / 2, color: COLORS[index % COLORS.length], chance: total ? player.tickets / total * 100 : 0 };
      cursor += size;
      return item;
    });
  }

  function renderWheel() {
    const data = wheelData();
    const total = totalTickets(eligiblePlayers());
    const hasPlayers = data.length > 0 && total > 0;
    els.wheel.parentElement.hidden = !hasPlayers;
    els.emptyWheel.hidden = hasPlayers;
    if (!hasPlayers) { els.chanceStrip.innerHTML = ""; return; }

    els.wheel.style.background = `conic-gradient(${data.map((d) => `${d.color} ${d.start}deg ${d.end}deg`).join(",")})`;
    els.wheel.style.transform = `rotate(${activePool().rotation || 0}deg)`;
    els.wheelLabels.innerHTML = data.filter((d) => d.chance >= 3.1 && data.length <= 24).map((d) => {
      const angle = d.mid;
      const radius = data.length <= 8 ? 35 : 37;
      const x = 50 + Math.sin(angle * Math.PI / 180) * radius;
      const y = 50 - Math.cos(angle * Math.PI / 180) * radius;
      return `<span class="wheel-label" style="left:${x}%;top:${y}%;transform:translate(-50%,-50%) rotate(${angle}deg)" title="${escapeHtml(d.player.name)}">${escapeHtml(d.player.name)}<small>${d.chance.toFixed(1)}%</small></span>`;
    }).join("");
    els.chanceStrip.innerHTML = data.slice(0, 12).map((d) => `<span class="chance-item"><i style="background:${d.color}"></i><b>${escapeHtml(d.player.name)}</b> ${d.player.tickets} · ${d.chance.toFixed(1)}%</span>`).join("");
  }

  function renderDrawState() {
    const pool = activePool();
    const eligible = eligiblePlayers(pool);
    const tickets = totalTickets(eligible);
    const prize = nextPrize(pool);
    const ready = eligible.length > 0 && tickets > 0 && Boolean(prize) && !spinning;
    els.drawBtn.disabled = !ready;
    els.drawButtonSub.textContent = ready ? `${tickets.toLocaleString()} eligible tickets` : "Waiting for pool";
    if (!pool.players.length) els.eligibilityNote.textContent = "Add at least one player with tickets.";
    else if (!eligible.length && !pool.repeatWinners) els.eligibilityNote.textContent = "All eligible players have already won this session.";
    else if (!prize) els.eligibilityNote.textContent = "Add a prize to the queue.";
    else els.eligibilityNote.textContent = `${eligible.length} eligible player${eligible.length === 1 ? "" : "s"} · ${pool.sessionWinners.length} winner${pool.sessionWinners.length === 1 ? "" : "s"} this session`;
  }

  function renderHistory() {
    const rows = [...state.history].reverse();
    els.emptyHistory.hidden = rows.length > 0;
    els.historyBody.innerHTML = rows.map((r) => `<tr>
      <td>${escapeHtml(new Date(r.timestamp).toLocaleString())}</td><td><span class="pool-badge">${escapeHtml(r.pool)}</span></td>
      <td><b>${escapeHtml(r.prize)}</b></td><td>${escapeHtml(r.playerName)}</td><td>${escapeHtml(r.memberId)}</td>
      <td>${r.ticketsBefore} → ${r.ticketsAfter}</td><td>${r.repeatWinners ? "Allowed" : "Not allowed"}</td>
    </tr>`).join("");
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2800);
  }

  function readCsv(text) {
    const rows = []; let row = []; let field = ""; let quoted = false;
    const source = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
      if (c === '"') {
        if (quoted && source[i + 1] === '"') { field += '"'; i++; }
        else quoted = !quoted;
      } else if (c === "," && !quoted) { row.push(field); field = ""; }
      else if ((c === "\n" || c === "\r") && !quoted) {
        if (c === "\r" && source[i + 1] === "\n") i++;
        row.push(field); if (row.some((v) => String(v).trim())) rows.push(row);
        row = []; field = "";
      } else field += c;
    }
    if (quoted) throw new Error("CSV has an unclosed quotation mark.");
    row.push(field); if (row.some((v) => String(v).trim())) rows.push(row);
    return [rows];
  }

  function xmlDocument(xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Excel file contains invalid worksheet data.");
    return doc;
  }
  function xmlChildren(node, name) { return [...node.children].filter((child) => child.localName === name); }
  function xmlFirst(node, name) { return xmlChildren(node, name)[0]; }
  function columnIndex(reference) {
    let index = 0;
    for (const char of reference.match(/^[A-Z]+/i)?.[0].toUpperCase() || "") index = index * 26 + char.charCodeAt(0) - 64;
    return index - 1;
  }
  async function readXlsx(file) {
    if (!window.JSZip) throw new Error("Excel reader is unavailable.");
    const zip = await JSZip.loadAsync(file);
    const sharedFile = zip.file("xl/sharedStrings.xml");
    const shared = sharedFile ? xmlChildren(xmlDocument(await sharedFile.async("string")).documentElement, "si")
      .map((si) => [...si.getElementsByTagName("*")].filter((node) => node.localName === "t").map((node) => node.textContent).join("")) : [];
    const sheetPaths = Object.keys(zip.files).filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
      .sort((a, b) => Number(a.match(/sheet(\d+)/i)[1]) - Number(b.match(/sheet(\d+)/i)[1]));
    if (!sheetPaths.length) throw new Error("Excel workbook has no worksheets.");
    const sheets = [];
    for (const path of sheetPaths) {
      const doc = xmlDocument(await zip.file(path).async("string"));
      const sheetData = [...doc.getElementsByTagName("*")].find((node) => node.localName === "sheetData");
      if (!sheetData) continue;
      const rows = xmlChildren(sheetData, "row").map((row) => {
        const values = [];
        for (const cell of xmlChildren(row, "c")) {
          const index = columnIndex(cell.getAttribute("r") || "");
          if (index < 0 || index > 100) continue;
          const type = cell.getAttribute("t");
          let value = xmlFirst(cell, "v")?.textContent || "";
          if (type === "s") value = shared[Number(value)] ?? "";
          if (type === "inlineStr") value = [...cell.getElementsByTagName("*")].filter((node) => node.localName === "t").map((node) => node.textContent).join("");
          values[index] = value;
        }
        return values;
      }).filter((row) => row.some((value) => String(value ?? "").trim()));
      if (rows.length) sheets.push(rows);
    }
    return sheets;
  }

  function normalizeHeader(text) { return String(text ?? "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, ""); }
  const HEADERS = {
    players: [
      ["memberid", "membernumber", "id", "會員id", "會員編號", "會員號碼"],
      ["name", "playername", "membername", "姓名", "玩家姓名", "會員姓名"],
      ["tickets", "ticket", "ticketqty", "ticketquantity", "ticket張數", "tickets張數", "票數", "票券張數", "張數"]
    ],
    prizes: [
      ["prize", "prizename", "award", "獎項", "獎品", "獎項名稱", "獎品名稱"],
      ["quantity", "qty", "count", "數量", "獎品數量", "個數"]
    ]
  };
  function parseImport(sheets, kind) {
    for (const sheet of sheets) {
      for (let headerRow = 0; headerRow < Math.min(5, sheet.length); headerRow++) {
        const headers = sheet[headerRow].map(normalizeHeader);
        const columns = HEADERS[kind].map((aliases) => headers.findIndex((h) => aliases.includes(h)));
        if (columns.some((index) => index < 0)) continue;
        const rows = []; const seen = new Set();
        for (let rowIndex = headerRow + 1; rowIndex < sheet.length; rowIndex++) {
          const row = sheet[rowIndex];
          if (row.every((v) => !String(v ?? "").trim())) continue;
          const values = columns.map((i) => String(row[i] ?? "").trim());
          if (kind === "players") {
            const [memberId, name, rawTickets] = values;
            const tickets = Number(rawTickets);
            if (!memberId || !name || !Number.isSafeInteger(tickets) || tickets < 0) throw new Error(`Row ${rowIndex + 1}: Member ID, Name, and a whole-number ticket count ≥ 0 are required.`);
            const key = memberId.toLowerCase();
            if (seen.has(key)) throw new Error(`Duplicate Member ID in file: ${memberId}. Combine its rows before importing.`);
            seen.add(key); rows.push({ memberId, name, tickets });
          } else {
            const [name, rawQuantity] = values;
            const quantity = Number(rawQuantity);
            if (!name || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) throw new Error(`Row ${rowIndex + 1}: Prize and Quantity (1–100) are required.`);
            rows.push({ name, quantity });
          }
        }
        if (!rows.length) throw new Error("No data rows were found below the headers.");
        return rows;
      }
    }
    throw new Error(kind === "players" ? "No sheet has MEMBER ID, NAME, and TICKETS columns." : "No sheet has PRIZE and QUANTITY columns.");
  }

  function importMode() { return els.importOptions.querySelector('input[name="importMode"]:checked')?.value || "add"; }
  function refreshImportPreview() {
    const draft = importDraft;
    els.applyImportBtn.disabled = !draft?.rows || spinning || Boolean(pendingResult);
    if (!draft?.rows) return;
    const pool = state.pools[draft.pool];
    const mode = importMode();
    if (draft.kind === "players") {
      const existing = new Map(pool.players.map((p) => [p.memberId.toLowerCase(), p]));
      const newCount = draft.rows.filter((row) => !existing.has(row.memberId.toLowerCase())).length;
      const change = draft.rows.reduce((sum, row) => {
        const old = existing.get(row.memberId.toLowerCase())?.tickets || 0;
        return sum + (mode === "add" ? row.tickets : row.tickets - old);
      }, 0);
      els.importPreview.innerHTML = `<strong>${draft.rows.length} players · ${newCount} new · tickets ${change >= 0 ? "+" : ""}${change.toLocaleString()}</strong><ul>${draft.rows.slice(0, 8).map((r) => `<li>${escapeHtml(r.memberId)} · ${escapeHtml(r.name)} · ${r.tickets} tickets</li>`).join("")}${draft.rows.length > 8 ? `<li>…and ${draft.rows.length - 8} more</li>` : ""}</ul>`;
    } else {
      const quantity = draft.rows.reduce((sum, row) => sum + row.quantity, 0);
      els.importPreview.innerHTML = `<strong>${draft.rows.length} prize rows · ${quantity} draws · ${mode === "replace" ? "replace pending queue" : "add after existing prizes"}</strong><ul>${draft.rows.slice(0, 8).map((r, i) => `<li>${i + 1}. ${escapeHtml(r.name)} × ${r.quantity}</li>`).join("")}${draft.rows.length > 8 ? `<li>…and ${draft.rows.length - 8} more</li>` : ""}</ul>`;
    }
  }

  function openImport(kind) {
    if (spinning || pendingResult) return showToast("Finish the current draw first.");
    importDraft = { pool: state.activePool, kind, rows: null };
    $("#importPoolLabel").textContent = `${state.activePool.toUpperCase()} POOL`;
    $("#importTitle").textContent = kind === "players" ? "Import player tickets" : "Import prizes";
    $("#importHint").textContent = kind === "players" ? "Excel/CSV columns: MEMBER ID, NAME, TICKETS. Choose how existing members are updated." : "Excel/CSV columns: PRIZE, QUANTITY. File row order becomes draw order.";
    els.importOptions.innerHTML = kind === "players"
      ? '<label><input type="radio" name="importMode" value="add" checked /><span><b>Add tickets</b><small>Daily entries add to existing member totals. Good for Weekly accumulation.</small></span></label><label><input type="radio" name="importMode" value="replace" /><span><b>Set ticket totals</b><small>Overwrite matching members with the numbers in this file. Other members stay.</small></span></label>'
      : '<label><input type="radio" name="importMode" value="add" checked /><span><b>Append prizes</b><small>Add after any pending prizes, in file row order.</small></span></label><label><input type="radio" name="importMode" value="replace" /><span><b>Replace pending prizes</b><small>Keep completed prizes and history; replace prizes yet to be drawn.</small></span></label>';
    els.importPreview.textContent = "Select a file to preview changes before confirming.";
    els.importFile.value = "";
    els.applyImportBtn.disabled = true;
    els.importDialog.showModal();
  }

  $("#importPlayersBtn").addEventListener("click", () => openImport("players"));
  $("#importPrizesBtn").addEventListener("click", () => openImport("prizes"));
  $("#closeImportBtn").addEventListener("click", () => els.importDialog.close());
  els.importOptions.addEventListener("change", refreshImportPreview);
  els.importFile.addEventListener("change", async () => {
    const file = els.importFile.files[0];
    if (!file || !importDraft) return;
    importDraft.rows = null;
    els.applyImportBtn.disabled = true;
    els.importPreview.textContent = "Reading file…";
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("File exceeds 5 MB. Split the list into smaller files.");
      const sheets = /\.xlsx$/i.test(file.name) ? await readXlsx(file) : /\.csv$/i.test(file.name) ? readCsv(await file.text()) : null;
      if (!sheets) throw new Error("Select a .xlsx or .csv file.");
      importDraft.rows = parseImport(sheets, importDraft.kind);
      refreshImportPreview();
    } catch (error) {
      els.importPreview.innerHTML = `<span class="import-error">${escapeHtml(error.message || "Could not read file.")}</span>`;
    }
  });
  $("#downloadTemplateBtn").addEventListener("click", () => {
    const kind = importDraft?.kind || "players";
    const csv = kind === "players" ? "MEMBER ID,NAME,TICKETS\r\n80080082,JOY,10\r\n" : "PRIZE,QUANTITY\r\n₱600,2\r\n₱800,2\r\n";
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    anchor.download = `everest-${kind}-template.csv`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  });
  els.applyImportBtn.addEventListener("click", () => {
    const draft = importDraft;
    if (!draft?.rows || spinning || pendingResult) return;
    const pool = state.pools[draft.pool];
    const mode = importMode();
    if (draft.kind === "players") {
      const members = new Map(pool.players.map((p) => [p.memberId.toLowerCase(), p]));
      for (const row of draft.rows) {
        const old = members.get(row.memberId.toLowerCase());
        if (old) { old.name = row.name; old.tickets = mode === "add" ? old.tickets + row.tickets : row.tickets; }
        else pool.players.push({ id: uid(), ...row });
      }
    } else {
      if (mode === "replace") pool.prizes = pool.prizes.filter((p) => p.remaining === 0);
      pool.prizes.push(...draft.rows.map((r) => ({ id: uid(), name: r.name, quantity: r.quantity, remaining: r.quantity })));
    }
    saveState(); els.importDialog.close(); render();
    showToast(`Imported ${draft.rows.length} ${draft.kind === "players" ? "players" : "prizes"} into ${draft.pool}.`);
    importDraft = null;
  });

  function registerWebMcpTools() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const register = (tool) => {
      try { void Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch {}
    };
    const getPool = (key) => {
      if (!['daily', 'weekly'].includes(key)) throw new Error("Pool must be daily or weekly.");
      return state.pools[key];
    };

    register({
      name: "read_raffle_pool",
      title: "Read raffle pool",
      description: "Read players, ticket totals, prizes, and repeat-winner settings for the Daily or Weekly raffle pool.",
      inputSchema: { type: "object", properties: { pool: { type: "string", enum: ["daily", "weekly"] } }, required: ["pool"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input) {
        const pool = getPool(input?.pool);
        return { pool: input.pool, players: pool.players.map(({ name, memberId, tickets }) => ({ name, memberId, tickets })), totalTickets: totalTickets(pool.players), prizes: pool.prizes.map(({ name, quantity, remaining }) => ({ name, quantity, remaining })), repeatWinners: pool.repeatWinners };
      }
    });

    register({
      name: "add_player_tickets",
      title: "Add player tickets",
      description: "Add a positive number of tickets to a player in the Daily or Weekly raffle pool, creating the player if the member ID is new.",
      inputSchema: { type: "object", properties: { pool: { type: "string", enum: ["daily", "weekly"] }, memberId: { type: "string", minLength: 1 }, playerName: { type: "string", minLength: 1 }, tickets: { type: "integer", minimum: 1 } }, required: ["pool", "memberId", "playerName", "tickets"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute(input) {
        const pool = getPool(input?.pool);
        const memberId = String(input.memberId || "").trim();
        const name = String(input.playerName || "").trim();
        const tickets = Number(input.tickets);
        if (!memberId || !name || !Number.isInteger(tickets) || tickets < 1) throw new Error("A player name, member ID, and positive whole-number ticket amount are required.");
        let player = pool.players.find((p) => p.memberId.toLowerCase() === memberId.toLowerCase());
        if (player) { player.tickets += tickets; player.name = name; }
        else { player = { id: uid(), name, memberId, tickets }; pool.players.push(player); }
        saveState(); render();
        return { pool: input.pool, playerName: player.name, memberId: player.memberId, tickets: player.tickets };
      }
    });

    register({
      name: "add_raffle_prize",
      title: "Add raffle prize",
      description: "Add a prize and quantity to the top of a Daily or Weekly raffle prize queue so it becomes the next draw.",
      inputSchema: { type: "object", properties: { pool: { type: "string", enum: ["daily", "weekly"] }, name: { type: "string", minLength: 1 }, quantity: { type: "integer", minimum: 1, maximum: 100 } }, required: ["pool", "name", "quantity"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute(input) {
        const pool = getPool(input?.pool);
        const name = String(input.name || "").trim();
        const quantity = Number(input.quantity);
        if (!name || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new Error("A prize name and quantity from 1 to 100 are required.");
        pool.prizes.unshift({ id: uid(), name, quantity, remaining: quantity });
        saveState(); render();
        return { pool: input.pool, name, quantity, queuePosition: 1 };
      }
    });
  }

  function secureRandom(maxExclusive) {
    if (maxExclusive <= 0) return 0;
    const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
    const values = new Uint32Array(1);
    do { crypto.getRandomValues(values); } while (values[0] >= limit);
    return values[0] % maxExclusive;
  }

  function chooseWinner() {
    const players = eligiblePlayers();
    const total = totalTickets(players);
    let ticket = secureRandom(total);
    for (const player of players) {
      if (ticket < player.tickets) return player;
      ticket -= player.tickets;
    }
    return players[players.length - 1];
  }

  function startDraw() {
    if (spinning) return;
    const pool = activePool();
    const prize = nextPrize(pool);
    const winner = chooseWinner();
    if (!prize || !winner) return;
    const segment = wheelData().find((d) => d.player.id === winner.id);
    const jitterRange = Math.max(0, Math.min((segment.end - segment.start) * .24, 7));
    const jitter = jitterRange ? (secureRandom(10001) / 10000 * 2 - 1) * jitterRange : 0;
    const normalizedCurrent = ((pool.rotation % 360) + 360) % 360;
    const targetWithinTurn = (360 - (segment.mid + jitter)) % 360;
    const extra = (360 - normalizedCurrent + targetWithinTurn) % 360;
    pool.rotation += 360 * 6 + extra;
    pendingResult = { pool: state.activePool, playerId: winner.id, prizeId: prize.id };
    spinning = true;
    els.drawBtn.classList.add("spinning");
    els.drawBtn.disabled = true;
    els.drawButtonSub.textContent = "Drawing…";
    els.wheel.style.transform = `rotate(${pool.rotation}deg)`;
    saveState();
    window.setTimeout(() => {
      spinning = false;
      els.drawBtn.classList.remove("spinning");
      showWinner(winner, prize);
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 150 : 6150);
  }

  function showWinner(player, prize) {
    els.winnerName.textContent = player.name;
    els.winnerId.textContent = player.memberId;
    els.winnerPrize.textContent = prize.name;
    els.winnerTicketText.textContent = `${player.tickets} → ${Math.max(0, player.tickets - 1)} tickets after confirmation.`;
    els.winnerDialog.showModal();
  }

  function confirmWinner() {
    if (!pendingResult) return;
    const pool = state.pools[pendingResult.pool];
    const player = pool.players.find((p) => p.id === pendingResult.playerId);
    const prize = pool.prizes.find((p) => p.id === pendingResult.prizeId);
    if (!player || !prize || player.tickets < 1 || prize.remaining < 1) {
      els.winnerDialog.close(); pendingResult = null; render(); showToast("Result could not be confirmed."); return;
    }
    const before = player.tickets;
    player.tickets -= 1;
    prize.remaining -= 1;
    if (!pool.sessionWinners.includes(player.id)) pool.sessionWinners.push(player.id);
    state.history.push({ id: uid(), timestamp: new Date().toISOString(), pool: pendingResult.pool, prize: prize.name, playerName: player.name, memberId: player.memberId, ticketsBefore: before, ticketsAfter: player.tickets, repeatWinners: pool.repeatWinners });
    els.winnerDialog.close();
    pendingResult = null;
    saveState();
    render();
    showToast("Winner confirmed and 1 ticket deducted.");
  }

  function askConfirm(title, message, label, action) {
    els.confirmTitle.textContent = title;
    els.confirmMessage.textContent = message;
    $("#confirmActionBtn").textContent = label;
    pendingConfirmation = action;
    els.confirmDialog.showModal();
  }

  $$(".tab").forEach((tab) => tab.addEventListener("click", () => {
    if (spinning || pendingResult) return showToast("Finish the current draw first.");
    state.activePool = tab.dataset.pool;
    saveState();
    render();
  }));

  $("#addPlayerBtn").addEventListener("click", () => { els.playerForm.hidden = false; els.playerName.focus(); });
  $("#cancelPlayerBtn").addEventListener("click", () => { els.playerForm.hidden = true; els.playerForm.reset(); els.initialTickets.value = 1; });
  els.playerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = els.playerName.value.trim();
    const memberId = els.memberId.value.trim();
    const tickets = Number.parseInt(els.initialTickets.value, 10);
    const pool = activePool();
    const existing = pool.players.find((p) => p.memberId.toLowerCase() === memberId.toLowerCase());
    if (existing) {
      existing.tickets += tickets;
      existing.name = name;
      showToast(`${tickets} ticket${tickets === 1 ? "" : "s"} added to ${existing.name}.`);
    } else {
      pool.players.push({ id: uid(), name, memberId, tickets });
      showToast(`${name} added to the ${state.activePool} pool.`);
    }
    els.playerForm.reset(); els.initialTickets.value = 1; els.playerForm.hidden = true;
    saveState(); render();
  });

  els.playerList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    const card = event.target.closest("[data-player-id]");
    if (!button || !card || spinning) return;
    const pool = activePool();
    const player = pool.players.find((p) => p.id === card.dataset.playerId);
    if (!player) return;
    if (button.dataset.action === "increase") player.tickets += 1;
    if (button.dataset.action === "decrease") player.tickets = Math.max(0, player.tickets - 1);
    if (button.dataset.action === "delete") {
      askConfirm(`Remove ${player.name}?`, `This removes the player and all ${player.tickets} tickets from the ${state.activePool} pool.`, "Remove player", () => {
        pool.players = pool.players.filter((p) => p.id !== player.id);
        pool.sessionWinners = pool.sessionWinners.filter((id) => id !== player.id);
      });
      return;
    }
    saveState(); render();
  });

  $("#addPrizeBtn").addEventListener("click", () => { els.prizeForm.hidden = false; els.prizeName.focus(); });
  $("#cancelPrizeBtn").addEventListener("click", () => { els.prizeForm.hidden = true; els.prizeForm.reset(); els.prizeQuantity.value = 1; });
  els.prizeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = els.prizeName.value.trim();
    const quantity = Number.parseInt(els.prizeQuantity.value, 10);
    activePool().prizes.unshift({ id: uid(), name, quantity, remaining: quantity });
    els.prizeForm.reset(); els.prizeQuantity.value = 1; els.prizeForm.hidden = true;
    saveState(); render(); showToast(`${name} added to the prize queue.`);
  });

  els.prizeList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    const card = event.target.closest("[data-prize-id]");
    if (!button || !card || spinning) return;
    const pool = activePool();
    const prize = pool.prizes.find((p) => p.id === card.dataset.prizeId);
    const index = pool.prizes.findIndex((p) => p.id === prize?.id);
    if (!prize || index < 0) return;
    if (button.dataset.action === "increase-prize") {
      prize.quantity += 1;
      prize.remaining += 1;
    }
    if (button.dataset.action === "decrease-prize") {
      const drawn = prize.quantity - prize.remaining;
      if (prize.quantity > Math.max(1, drawn)) {
        prize.quantity -= 1;
        prize.remaining = Math.max(0, prize.remaining - 1);
      }
    }
    if (button.dataset.action === "move-prize-up" && index > 0) {
      [pool.prizes[index - 1], pool.prizes[index]] = [pool.prizes[index], pool.prizes[index - 1]];
    }
    if (button.dataset.action === "move-prize-down" && index < pool.prizes.length - 1) {
      [pool.prizes[index + 1], pool.prizes[index]] = [pool.prizes[index], pool.prizes[index + 1]];
    }
    if (button.dataset.action === "delete-prize") {
      askConfirm(`Remove ${prize.name}?`, "This prize will be removed from the queue. Confirmed history will not change.", "Remove prize", () => { pool.prizes = pool.prizes.filter((p) => p.id !== prize.id); });
      return;
    }
    saveState(); render();
  });

  els.repeatToggle.addEventListener("change", () => { activePool().repeatWinners = els.repeatToggle.checked; saveState(); render(); });
  els.drawBtn.addEventListener("click", startDraw);
  $("#confirmResultBtn").addEventListener("click", confirmWinner);
  $("#cancelResultBtn").addEventListener("click", () => { els.winnerDialog.close(); pendingResult = null; render(); showToast("Result cancelled. No ticket was deducted."); });
  els.winnerDialog.addEventListener("cancel", (event) => event.preventDefault());
  $("#clearWinnersBtn").addEventListener("click", () => askConfirm("Start a new winner session?", "Players excluded by the no-repeat setting will become eligible again. Tickets and prizes will not change.", "Start new session", () => { activePool().sessionWinners = []; }));
  $("#resetPoolBtn").addEventListener("click", () => askConfirm(`Reset ${state.activePool} pool?`, "All players, tickets, prizes, and current session winners in this pool will be deleted. History will remain.", "Reset pool", () => { state.pools[state.activePool] = defaultPool(); }));

  $("#confirmCancelBtn").addEventListener("click", () => { pendingConfirmation = null; els.confirmDialog.close(); });
  $("#confirmActionBtn").addEventListener("click", () => {
    if (pendingConfirmation) pendingConfirmation();
    pendingConfirmation = null; els.confirmDialog.close(); saveState(); render(); showToast("Action completed.");
  });

  $("#dataBtn").addEventListener("click", () => els.dataDialog.showModal());
  $$('[data-close-dialog="dataDialog"]').forEach((button) => button.addEventListener("click", () => els.dataDialog.close()));
  $("#backupBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `everest-raffle-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click(); URL.revokeObjectURL(anchor.href); showToast("Backup downloaded.");
  });
  $("#restoreInput").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!imported?.pools?.daily || !imported?.pools?.weekly || !Array.isArray(imported.history)) throw new Error("Invalid backup");
      state = imported; state.activePool = "daily"; saveState(); els.dataDialog.close(); render(); showToast("Backup restored.");
    } catch { showToast("This backup file is not valid."); }
    event.target.value = "";
  });
  $("#resetAllBtn").addEventListener("click", () => { els.dataDialog.close(); askConfirm("Reset all app data?", "Daily pool, Weekly pool, prizes, settings, and complete raffle history will be permanently deleted.", "Reset everything", () => { state = defaultState(); }); });

  $("#exportHistoryBtn").addEventListener("click", () => {
    if (!state.history.length) return showToast("There is no history to export.");
    const csv = [["Date & Time","Pool","Prize","Winner","Member ID","Tickets Before","Tickets After","Repeat Winners"], ...state.history.map((r) => [new Date(r.timestamp).toLocaleString(), r.pool, r.prize, r.playerName, r.memberId, r.ticketsBefore, r.ticketsAfter, r.repeatWinners ? "Allowed" : "Not allowed"])].map((row) => row.map((v) => `"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob); anchor.download = `everest-raffle-history-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(anchor.href);
  });

  $("#fullscreenBtn").addEventListener("click", async () => {
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen(); } catch { showToast("Fullscreen is not available in this browser."); }
  });

  document.addEventListener("keydown", (event) => {
    if (event.code === "Space" && !event.target.matches("input, button") && !document.querySelector("dialog[open]") && state.activePool !== "history") { event.preventDefault(); if (!els.drawBtn.disabled) startDraw(); }
  });

  window.addEventListener("storage", (event) => { if (event.key === STORAGE_KEY) { state = loadState(); render(); showToast("Raffle data updated in another tab."); } });
  render();
  registerWebMcpTools();
})();
