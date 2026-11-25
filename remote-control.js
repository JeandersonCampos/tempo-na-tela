/* The publishable key is public. Row policies require the separate pairing token. */
(() => {
  const endpoint = "https://demtrwnxkalsuqturmmm.supabase.co/rest/v1/tempo_remote_sessions";
  const apiKey = "sb_publishable_rr0bW5un5PWYNbHKlTn4NA__vHL_Z46";
  const pairDialog = byId("pair-dialog");
  const controller = byId("remote-controller");
  const remoteStatus = byId("remote-status");
  const remoteDuration = byId("remote-duration");
  const remoteActions = [...controller.querySelectorAll("[data-remote-action]")];
  const remoteModes = [...controller.querySelectorAll("[data-remote-mode]")];
  const pairStatus = byId("pair-status");
  let hostSession;
  let remoteSession;
  let remoteSnapshot;
  let pending;
  let sending = false;
  let lastSeenAt = 0;
  let lastHostTick;
  let snapshotReceivedAt = 0;
  let displayedLaps = "";
  let enteredDuration = false;
  remoteDuration.oninput = () => { enteredDuration = true; };

  async function request(token, method = "GET", body, filter = "") {
    const query = "?expires_at=gt.now" + filter;
    const response = await fetch(endpoint + query, {
      cache: "no-store",
      method,
      headers: {
        apikey: apiKey,
        "x-tempo-session": token,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw Error("HTTP " + response.status);
    return response.json();
  }

  function snapshot() {
    return {
      tick: Date.now(),
      mode,
      watch: { elapsed: elapsed(), running: watch.since !== null, laps: watch.laps.slice(-500) },
      timer: {
        phase: timer.phase,
        remaining: timer.deadline === null ? timer.remaining : timer.deadline - Date.now(),
        duration: configuredDuration(),
      },
      centiseconds: centiseconds.checked,
    };
  }

  function applyCommand(command) {
    if (command.action === "mode" && ["watch", "timer"].includes(command.mode)) {
      selectMode(command.mode);
      return;
    }
    if (command.mode !== mode) return;
    checkExpiration();
    if (command.action === "start" && mode === "timer" && timer.phase === "ready") {
      const seconds = command.seconds;
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 359999) return;
      fields[0].value = Math.floor(seconds / 3600);
      fields[1].value = Math.floor(seconds / 60) % 60;
      fields[2].value = seconds % 60;
      form.dispatchEvent(new Event("input"));
    }
    const running = mode === "watch" ? watch.since !== null : timer.phase === "running";
    if (command.action === "start" && !running && !start.hidden) start.click();
    if (command.action === "pause" && running) start.click();
    if (command.action === "reset") reset.click();
    if (command.action === "lap" && mode === "watch") lap.click();
  }

  async function syncHost(session) {
    if (hostSession !== session) return;
    try {
      const [row] = await request(session.token);
      if (hostSession !== session) return;
      if (!row) {
        endHost("Sessão encerrada. Gere um novo link para conectar.");
        return;
      }
      if (row.command && row.command.id !== session.lastCommand) {
        session.lastCommand = row.command.id;
        applyCommand(row.command);
      }
      const update = { snapshot: snapshot() };
      if (row.command) update.command = null;
      await request(session.token, "PATCH", update);
      if (hostSession === session) pairStatus.textContent = "Compartilhe o QR code com seu celular.";
    } catch {
      if (hostSession === session) pairStatus.textContent = "Conexão interrompida. Tentando reconectar.";
    }
    if (hostSession === session) setTimeout(() => syncHost(session), 750);
  }

  function endHost(message) {
    hostSession = null;
    byId("pair-code").replaceChildren();
    byId("pair-link").hidden = true;
    byId("pair-end").hidden = true;
    byId("pair-create").hidden = false;
    byId("pair-create").disabled = false;
    pairStatus.textContent = message;
  }

  byId("pair-open").onclick = () => pairDialog.showModal();
  byId("pair-create").onclick = async () => {
    byId("pair-create").disabled = true;
    pairStatus.textContent = "Criando sessão…";
    prepareAudio();
    try {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte =>
        byte.toString(16).padStart(2, "0")).join("");
      const url = new URL(location.pathname, location.origin);
      url.hash = "controle=" + token;
      const code = qrcode(0, "M");
      code.addData(url.href);
      code.make();
      await request(token, "POST", { token, snapshot: snapshot() });
      const session = { token };
      hostSession = session;
      const img = document.createElement("img");
      img.src = code.createDataURL(4, 16);
      img.alt = "QR code para conectar o celular";
      byId("pair-code").replaceChildren(img);
      const link = byId("pair-link");
      link.href = url.href;
      link.hidden = false;
      byId("pair-end").hidden = false;
      byId("pair-create").hidden = true;
      syncHost(session);
    } catch {
      endHost("Não foi possível conectar. Confira a internet e tente novamente.");
    }
  };
  byId("pair-end").onclick = async () => {
    const session = hostSession;
    if (!session) return;
    const button = byId("pair-end");
    button.disabled = true;
    try {
      await request(session.token, "DELETE");
      endHost("Sessão encerrada.");
    } catch {
      pairStatus.textContent = "Não foi possível encerrar. Confira a internet e tente novamente.";
    } finally {
      button.disabled = false;
    }
  };

  function formatRemote(milliseconds, showCentiseconds = false) {
    const [hours, minutes, seconds, hundredths] = parts(Math.max(0, milliseconds));
    return hours + ":" + minutes + ":" + seconds + (showCentiseconds ? "," + hundredths : "");
  }

  function paintRemote() {
    if (!remoteSnapshot) return;
    const data = remoteSnapshot;
    const stopwatch = data.mode === "watch";
    const delta = performance.now() - snapshotReceivedAt;
    const active = stopwatch ? data.watch.running : data.timer.phase === "running";
    const finished = !stopwatch && data.timer.phase === "finished";
    const ready = !stopwatch && data.timer.phase === "ready";
    const live = performance.now() - lastSeenAt < 5000;
    const locked = !live || sending || Boolean(pending);
    const ms = stopwatch ? data.watch.elapsed + (active ? delta : 0) :
      data.timer.remaining - (active || finished ? delta : 0);
    byId("remote-clock").textContent = finished ? "−" + formatRemote(Math.abs(ms)) :
      formatRemote(stopwatch ? ms : Math.ceil(Math.max(0, ms) / 1000) * 1000, stopwatch && data.centiseconds);
    remoteDuration.hidden = !ready;
    remoteDuration.disabled = locked;
    remoteModes.forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.remoteMode === data.mode));
      button.disabled = locked;
    });
    remoteActions.forEach(button => {
      const action = button.dataset.remoteAction;
      button.disabled = locked;
      if (action === "start") {
        button.hidden = finished;
        button.textContent = active ? "Pausar" : (stopwatch ? data.watch.elapsed > 0 : data.timer.phase === "paused") ? "Retomar" : "Iniciar";
      }
      if (action === "lap") {
        button.hidden = !stopwatch;
        button.disabled = locked || !active;
      }
    });
    const message = !live ? "Aguardando o visor conectado…" : pending ? "Enviando comando…" :
      finished ? "Tempo esgotado!" : active ? "Em andamento" : "Visor conectado";
    if (remoteStatus.textContent !== message) remoteStatus.textContent = message;
  }

  function showLaps(data) {
    const list = byId("remote-laps");
    const laps = data.mode === "watch" ? data.watch.laps : [];
    const signature = JSON.stringify([laps, data.centiseconds]);
    if (displayedLaps === signature) return;
    displayedLaps = signature;
    list.hidden = !laps.length;
    list.replaceChildren(...laps.slice().reverse().map(total => {
      const item = document.createElement("li");
      item.textContent = formatRemote(total, data.centiseconds);
      return item;
    }));
    list.reversed = true;
  }

  async function readRemote(session) {
    if (remoteSession !== session) return;
    try {
      const [row] = await request(session);
      if (remoteSession !== session) return;
      if (!row) {
        remoteSession = null;
        remoteSnapshot = null;
        remoteStatus.textContent = "Sessão encerrada ou expirada.";
        remoteModes.concat(remoteActions).forEach(button => { button.disabled = true; });
        remoteDuration.disabled = true;
        return;
      }
      if (row.snapshot.tick !== lastHostTick) {
        lastHostTick = row.snapshot.tick;
        lastSeenAt = snapshotReceivedAt = performance.now();
        remoteSnapshot = row.snapshot;
        showLaps(remoteSnapshot);
        if (!enteredDuration) remoteDuration.value = row.snapshot.timer.duration ? row.snapshot.timer.duration / 1000 : "";
      }
      pending = row.command;
      paintRemote();
    } catch {
      lastSeenAt = -Infinity;
      if (!remoteSnapshot) remoteStatus.textContent = "Sem conexão. Tentando reconectar…";
    }
    if (remoteSession === session) setTimeout(() => readRemote(session), 750);
  }

  async function send(action, targetMode, seconds) {
    if (!remoteSession || !remoteSnapshot || sending || pending || performance.now() - lastSeenAt >= 5000) return;
    const command = { id: crypto.randomUUID(), action, mode: targetMode, seconds };
    sending = true;
    paintRemote();
    try {
      const [row] = await request(remoteSession, "PATCH", { command }, "&command=is.null");
      if (row) {
        pending = row.command;
        if (action === "start") enteredDuration = false;
      }
    } catch {
      lastSeenAt = -Infinity;
    } finally {
      sending = false;
      paintRemote();
    }
  }

  const match = /^#controle=([0-9a-f]{64})$/.exec(location.hash);
  if (!match) return;
  remoteSession = match[1];
  byId("panel").hidden = true;
  byId("pair-open").hidden = true;
  controller.hidden = false;
  remoteModes.concat(remoteActions).forEach(button => { button.disabled = true; });
  remoteModes.forEach(button => { button.onclick = () => send("mode", button.dataset.remoteMode); });
  remoteActions.forEach(button => {
    button.onclick = () => {
      const action = button.dataset.remoteAction;
      const data = remoteSnapshot;
      const active = data.mode === "watch" ? data.watch.running : data.timer.phase === "running";
      if (action === "start" && data.mode === "timer" && data.timer.phase === "ready") {
        if (!remoteDuration.reportValidity()) return;
        send("start", data.mode, remoteDuration.valueAsNumber);
        return;
      }
      send(action === "start" && active ? "pause" : action, data.mode);
    };
  });
  readRemote(remoteSession);
  setInterval(paintRemote, 50);
})();
