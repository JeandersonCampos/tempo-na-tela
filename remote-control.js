/* The publishable key is public. Row policies require the separate pairing token. */
(() => {
  const lan = Boolean(document.querySelector('meta[name="tempo-lan"]'));
  const endpoint = lan ? "/api/sessao" : "https://demtrwnxkalsuqturmmm.supabase.co/rest/v1/tempo_remote_sessions";
  const apiKey = "sb_publishable_rr0bW5un5PWYNbHKlTn4NA__vHL_Z46";
  const pairDialog = byId("pair-dialog");
  const controller = byId("remote-controller");
  const remoteStatus = byId("remote-status");
  const remoteAlert = byId("remote-alert");
  const displayMessage = byId("display-message");
  const messageWindow = byId("display-message-window");
  const messageText = byId("display-message-text");
  const messageInput = byId("remote-message-input");
  const messageSend = byId("remote-message-send");
  const messageClear = byId("remote-message-clear");
  const messageStop = byId("remote-message-stop");
  const messageFeedback = byId("remote-message-feedback");
  const remoteDuration = byId("remote-duration");
  const remoteActions = [...controller.querySelectorAll("[data-remote-action]")];
  const remoteModes = [...controller.querySelectorAll("[data-remote-mode]")];
  const pairStatus = byId("pair-status");
  const shareButton = byId("pair-share");
  const shareField = byId("pair-share-link");
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
  remoteDuration.oninput = () => { enteredDuration = true; remoteStatus.textContent = ""; };
  const remoteFields = [];

  function setRemoteDuration(seconds) {
    remoteFields[0].value = Math.floor(seconds / 3600);
    remoteFields[1].value = Math.floor(seconds / 60) % 60;
    remoteFields[2].value = seconds % 60;
  }

  async function request(token, method = "GET", body, filter = "") {
    const query = "?expires_at=gt.now" + filter;
    const response = await fetch(endpoint + query, {
      cache: "no-store",
      method,
      headers: {
        ...(lan ? {} : { apikey: apiKey }),
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
      displayMessage: messageText.textContent,
    };
  }

  function fitDisplayMessage() {
    const width = messageWindow.clientWidth;
    const textWidth = messageText.offsetWidth;
    const overflowing = width > 0 && textWidth > width;
    if (overflowing) {
      displayMessage.style.setProperty("--scroll-width", width + "px");
      displayMessage.style.setProperty("--scroll-duration", Math.max(4, (width + textWidth) / 100) + "s");
    }
    displayMessage.classList.toggle("is-scrolling", overflowing);
  }

  const messageResize = new ResizeObserver(fitDisplayMessage);
  messageResize.observe(messageWindow);
  messageResize.observe(messageText);

  function showDisplayMessage(message) {
    const text = typeof message === "string" ? message.slice(0, 140).trim() : "";
    displayMessage.classList.remove("is-scrolling");
    displayMessage.hidden = !text;
    messageText.textContent = text;
    fitDisplayMessage();
  }

  function applyCommand(command) {
    if (command.action === "message") {
      showDisplayMessage(command.text);
      return;
    }
    if (command.action === "join") {
      document.body.classList.add("paired-display");
      if (pairDialog.open) pairDialog.close();
      return;
    }
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
      if (hostSession === session && pairStatus.textContent === "Conexão interrompida. Tentando reconectar.") pairStatus.textContent = "Conexão restabelecida.";
    } catch {
      if (hostSession === session) pairStatus.textContent = "Conexão interrompida. Tentando reconectar.";
    }
    if (hostSession === session) setTimeout(() => syncHost(session), 750);
  }

  function endHost(message) {
    const hadSession = Boolean(hostSession);
    hostSession = null;
    if (hadSession) {
      showDisplayMessage("");
      resetWatch();
      resetTimer();
      refresh();
    }
    document.body.classList.remove("paired-display");
    byId("pair-code").replaceChildren();
    shareButton.hidden = true;
    shareField.hidden = true;
    shareField.value = "";
    byId("pair-end").hidden = true;
    byId("pair-create").hidden = false;
    byId("pair-create").disabled = false;
    pairStatus.textContent = message;
  }

  function openPairDialog() {
    if (!pairDialog.open) pairDialog.showModal();
  }

  byId("pair-open").onclick = openPairDialog;
  clock.onclick = () => {
    if (document.body.classList.contains("paired-display")) openPairDialog();
  };
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && document.body.classList.contains("paired-display") && !pairDialog.open) openPairDialog();
  });

  const scanner = byId("scanner");
  const video = byId("scan-video");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const scanFile = byId("scan-file");
  let camera;
  let scanFrame;
  let scanAttempt = null;

  function stopScanner() {
    scanAttempt = null;
    clearTimeout(scanFrame);
    camera?.getTracks().forEach(track => track.stop());
    camera = undefined;
    video.srcObject = null;
    video.hidden = true;
    scanner.hidden = true;
    scanFile.value = "";
  }

  function openScannedLink(value) {
    let url;
    try { url = new URL(value.trim()); } catch { return false; }
    const allowed = url.origin === location.origin ||
      (url.origin === "https://jeandersoncampos.github.io" && url.pathname === "/tempo-na-tela/") ||
      (url.origin === "https://compasso-relogio.trimbetta32.chatgpt.site" && url.pathname === "/");
    if (!allowed || url.username || url.password || !/^#controle=[0-9a-f]{64}$/.test(url.hash)) return false;
    stopScanner();
    if (pairDialog.open) pairDialog.close();
    if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) {
      history.replaceState(null, "", url.href);
      location.reload();
    } else {
      location.assign(url.href);
    }
    return true;
  }

  function decode(source, width, height) {
    if (!width || !height || !context) return false;
    const scale = Math.min(1, 1200 / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(pixels.data, pixels.width, pixels.height);
    return Boolean(code && openScannedLink(code.data));
  }

  function scanVideo() {
    if (!scanAttempt) return;
    if (!decode(video, video.videoWidth, video.videoHeight)) scanFrame = setTimeout(scanVideo, 180);
  }

  function takePhoto() {
    scanFile.value = "";
    scanFile.click();
  }

  byId("scan-photo").onclick = takePhoto;
  byId("pair-scan").onclick = async () => {
    if (scanAttempt) return;
    scanner.hidden = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      pairStatus.textContent = "A câmera ao vivo requer uma página HTTPS. Tire uma foto do QR code ou cole o link.";
      return;
    }
    const attempt = {};
    scanAttempt = attempt;
    pairStatus.textContent = "Permita o acesso à câmera para ler o QR code.";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      if (scanAttempt !== attempt || !pairDialog.open) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      camera = stream;
      video.srcObject = stream;
      video.hidden = false;
      await video.play();
      if (scanAttempt !== attempt) return;
      pairStatus.textContent = "Aponte a câmera traseira para o QR code.";
      scanVideo();
    } catch {
      if (scanAttempt !== attempt) return;
      stopScanner();
      scanner.hidden = false;
      pairStatus.textContent = "Câmera ao vivo indisponível. Confira a permissão ou toque em Tirar foto do QR code.";
    }
  };
  scanFile.onchange = async () => {
    const file = scanFile.files[0];
    if (!file) return;
    const imageUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = imageUrl;
      await image.decode();
      if (!pairDialog.open || scanner.hidden || scanFile.files[0] !== file) return;
      if (decode(image, image.naturalWidth, image.naturalHeight)) return;
    } catch {
      if (!pairDialog.open || scanner.hidden) return;
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
    pairStatus.textContent = "QR code inválido ou ilegível. Tente outra foto ou cole o link.";
  };
  byId("scan-form").onsubmit = event => {
    event.preventDefault();
    if (!openScannedLink(byId("scan-link").value)) pairStatus.textContent = "Use um link de controle gerado pelo Tempo na Tela.";
  };
  pairDialog.addEventListener("close", stopScanner);
  byId("pair-create").onclick = async () => {
    stopScanner();
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
      const session = { token, url: url.href };
      hostSession = session;
      const img = document.createElement("img");
      img.src = code.createDataURL(4, 16);
      img.alt = "QR code para conectar o celular";
      byId("pair-code").replaceChildren(img);
      shareButton.hidden = false;
      byId("pair-end").hidden = false;
      byId("pair-create").hidden = true;
      pairStatus.textContent = "Escaneie o QR code ou compartilhe o link de controle.";
      syncHost(session);
    } catch {
      endHost(lan ? "Confira a rede local e tente novamente." : "Confira a internet e tente novamente.");
    }
  };
  shareButton.onclick = async () => {
    const session = hostSession;
    if (!session) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Controle do Tempo na Tela", url: session.url });
        return;
      }
    } catch (error) {
      if (error.name === "AbortError") return;
    }
    if (hostSession !== session) return;
    try {
      await navigator.clipboard.writeText(session.url);
      pairStatus.textContent = "Link de controle copiado.";
    } catch {
      if (hostSession !== session) return;
      shareField.value = session.url;
      shareField.hidden = false;
      shareField.select();
    }
  };

  byId("pair-end").onclick = async () => {
    const session = hostSession;
    if (!session) return;
    const button = byId("pair-end");
    button.disabled = true;
    try {
      await request(session.token, "DELETE");
      if (hostSession === session) endHost("Sessão encerrada.");
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

  function paintRemoteAlert(remaining, counting, finished) {
    const warning = counting && remaining > 0 && remaining <= 300000;
    const finalMinute = warning && remaining <= 60000;
    controller.classList.toggle("timer-warning", warning);
    controller.classList.toggle("timer-final-minute", finalMinute);
    controller.classList.toggle("done", finished);
    controller.classList.toggle("expiry-dim", finished && Math.floor(-remaining / 700) % 2 === 1);
    const message = finished ? "Tempo esgotado!" : finalMinute ? "Último minuto" : warning ? "Últimos 5 minutos" : "";
    if (remoteAlert.textContent !== message) remoteAlert.textContent = message;
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
    paintRemoteAlert(ms, live && !stopwatch && active, live && finished);
    byId("remote-clock").textContent = finished ? "−" + formatRemote(Math.abs(ms)) :
      formatRemote(stopwatch ? ms : Math.ceil(Math.max(0, ms) / 1000) * 1000, stopwatch && data.centiseconds);
    remoteDuration.hidden = !ready;
    remoteDuration.disabled = locked;
    messageInput.disabled = locked;
    messageSend.disabled = locked || !messageInput.value.trim();
    messageClear.disabled = !messageInput.value;
    messageStop.hidden = !data.displayMessage;
    messageStop.disabled = locked || !data.displayMessage;
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
      finished ? "Contando o tempo excedido" : active ? "Em andamento" : "Visor conectado";
    if (!locked && ready && remoteStatus.textContent === "Escolha uma duração maior que zero.") return;
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

  let joined = false;

  async function readRemote(session) {
    if (remoteSession !== session) return;
    try {
      const [row] = await request(session);
      if (remoteSession !== session) return;
      if (!row) {
        remoteSession = null;
        remoteSnapshot = null;
        paintRemoteAlert(0, false, false);
        byId("remote-clock").textContent = "00:00:00";
        const laps = byId("remote-laps");
        laps.replaceChildren();
        laps.hidden = true;
        remoteStatus.textContent = "Sessão encerrada ou expirada.";
        remoteModes.concat(remoteActions).forEach(button => { button.disabled = true; });
        remoteDuration.disabled = true;
        messageInput.disabled = messageSend.disabled = messageClear.disabled = messageStop.disabled = true;
        messageStop.hidden = true;
        messageFeedback.textContent = "";
        return;
      }
      if (row.snapshot.tick !== lastHostTick) {
        lastHostTick = row.snapshot.tick;
        lastSeenAt = snapshotReceivedAt = performance.now();
        remoteSnapshot = row.snapshot;
        showLaps(remoteSnapshot);
        if (!enteredDuration) setRemoteDuration(Math.round(row.snapshot.timer.duration / 1000));
      }
      pending = row.command;
      if (!joined && !pending && performance.now() - lastSeenAt < 5000) {
        joined = await send("join", row.snapshot.mode);
      }
      paintRemote();
    } catch {
      lastSeenAt = -Infinity;
      if (!remoteSnapshot) remoteStatus.textContent = "Sem conexão. Tentando reconectar…";
    }
    if (remoteSession === session) setTimeout(() => readRemote(session), 750);
  }

  async function send(action, targetMode, seconds, text) {
    if (!remoteSession || !remoteSnapshot || sending || pending || performance.now() - lastSeenAt >= 5000) return;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
    const command = { id, action, mode: targetMode, seconds, text };
    sending = true;
    paintRemote();
    try {
      if (action === "end") {
        await request(remoteSession, "DELETE");
        location.replace("./");
        return;
      }
      const [row] = await request(remoteSession, "PATCH", { command }, "&command=is.null");
      if (row) {
        pending = row.command;
        if (action === "start") enteredDuration = false;
      }
      return Boolean(row);
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
  remoteDuration.replaceChildren(...Array.from(form.children, child => child.cloneNode(true)));
  remoteFields.push(...remoteDuration.querySelectorAll("input"));
  remoteFields.forEach(input => { input.removeAttribute("id"); });
  for (const button of remoteDuration.querySelectorAll("[data-minutes]")) {
    button.onclick = () => {
      setRemoteDuration(Number(button.dataset.minutes) * 60);
      remoteDuration.dispatchEvent(new Event("input"));
    };
  }
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
        if (!remoteFields.every(field => field.reportValidity())) return;
        const [hours, minutes, seconds] = remoteFields.map(field => field.valueAsNumber);
        const duration = ((hours * 60 + minutes) * 60 + seconds);
        if (!duration) {
          remoteStatus.textContent = "Escolha uma duração maior que zero.";
          return;
        }
        send("start", data.mode, duration);
        return;
      }
      send(action === "start" && active ? "pause" : action, data.mode);
    };
  });
  async function sendMessage(text) {
    if (!remoteSnapshot) return;
    const draft = messageInput.value;
    const accepted = await send("message", remoteSnapshot.mode, undefined, text);
    if (accepted && text && messageInput.value === draft) messageInput.value = "";
    messageFeedback.textContent = accepted
      ? (text ? "Mensagem enviada." : "Remoção solicitada.")
      : "Não foi possível enviar. Tente novamente.";
    paintRemote();
  }

  messageInput.oninput = paintRemote;
  byId("remote-message-form").onsubmit = event => {
    event.preventDefault();
    const text = messageInput.value.trim();
    if (text) sendMessage(text);
  };
  messageClear.onclick = () => {
    messageInput.value = "";
    paintRemote();
    if (!messageInput.disabled) messageInput.focus();
  };
  messageStop.onclick = () => sendMessage("");
  readRemote(remoteSession);
  setInterval(paintRemote, 50);
})();
