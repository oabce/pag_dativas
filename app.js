const STORAGE_KEY = "solicitacaoAdvogado";
const PGE_STEP_INTERVAL_MS = 30000;
const ADMIN_STATUSES = ["Deferido", "Indeferido", "Pendencia"];
const PGE_STEPS = [
  {
    status: "Analise",
    descricao: "Formulario em analise no sistema PGE."
  },
  {
    status: "Deferido pelo PGE",
    descricao: "Formulario deferido pelo PGE."
  },
  {
    status: "Enviado para SEfaz",
    descricao: "Formulario enviado para SEfaz."
  },
  {
    status: "Efetuado o pagamento",
    descricao: "Pagamento efetuado. Processo finalizado e arquivado."
  }
];

function saveRequest(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadRequest() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

function getTimestamp(dateValue = new Date()) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}/${month}/${day} - ${hours}:${minutes}`;
}

function appendHistoryEntry(data, status, descricao, dateValue = new Date()) {
  if (!data.historico) {
    data.historico = [];
  }

  data.historico.push({
    dataHora: getTimestamp(dateValue),
    status: status,
    descricao: descricao
  });
}

function getPgeStep(status) {
  return PGE_STEPS.find((step) => step.status === status) || null;
}

function isPgeStatus(status) {
  return Boolean(getPgeStep(status));
}

function buildStatusDescription(status) {
  if (status === "Aguardando analise") {
    return "Seu formulario foi enviado e esta aguardando analise do administrador.";
  }

  if (status === "Em analise") {
    return "Formulario enviado para analise do administrador.";
  }

  if (status === "Deferido") {
    return "O formulario foi aprovado pelo administrador e enviado para o PGE.";
  }

  if (status === "Indeferido") {
    return "O formulario foi reprovado.";
  }

  if (status === "Pendencia") {
    return "O formulario possui pendencia e precisa de ajuste.";
  }

  const pgeStep = getPgeStep(status);
  if (pgeStep) {
    return pgeStep.descricao;
  }

  return "";
}

function ensureHistory(data) {
  if (data && !data.historico) {
    data.historico = [
      {
        dataHora: getTimestamp(),
        status: data.status,
        descricao: data.mensagem || buildStatusDescription(data.status)
      }
    ];
  }
}

function inferAdminStatus(data) {
  if (data.adminStatus) {
    return data.adminStatus;
  }

  if (ADMIN_STATUSES.includes(data.status)) {
    return data.status;
  }

  if (data.status === "Deferido" || isPgeStatus(data.status)) {
    return "Deferido";
  }

  return "";
}

function startPgeFlow(data, startAt = new Date()) {
  const startDate = startAt instanceof Date ? startAt : new Date(startAt);
  const firstStep = PGE_STEPS[0];

  data.pgeFlow = {
    startedAt: startDate.getTime(),
    currentStepIndex: 0,
    active: true
  };
  data.status = firstStep.status;
  data.mensagem = firstStep.descricao;
  appendHistoryEntry(data, firstStep.status, firstStep.descricao, startDate);
}

function normalizeRequest(data) {
  if (!data) {
    return false;
  }

  let changed = false;

  if (!data.historico) {
    ensureHistory(data);
    changed = true;
  }

  const inferredAdminStatus = inferAdminStatus(data);
  if (data.adminStatus !== inferredAdminStatus) {
    data.adminStatus = inferredAdminStatus;
    changed = true;
  }

  if (data.adminStatus === "Deferido" && !data.pgeFlow && data.status === "Deferido") {
    startPgeFlow(data, new Date());
    changed = true;
  }

  if (data.status === "Efetuado o pagamento" && !data.arquivado) {
    data.arquivado = true;
    changed = true;
  }

  return changed;
}

function runPgeSimulation(data) {
  if (!data || data.adminStatus !== "Deferido" || !data.pgeFlow) {
    return false;
  }

  const currentIndex = typeof data.pgeFlow.currentStepIndex === "number"
    ? data.pgeFlow.currentStepIndex
    : 0;
  const elapsed = Math.max(Date.now() - data.pgeFlow.startedAt, 0);
  const targetIndex = Math.min(
    Math.floor(elapsed / PGE_STEP_INTERVAL_MS),
    PGE_STEPS.length - 1
  );
  let changed = false;

  for (let index = currentIndex + 1; index <= targetIndex; index += 1) {
    const step = PGE_STEPS[index];
    const stepDate = new Date(data.pgeFlow.startedAt + index * PGE_STEP_INTERVAL_MS);
    appendHistoryEntry(data, step.status, step.descricao, stepDate);
    changed = true;
  }

  if (currentIndex !== targetIndex) {
    data.pgeFlow.currentStepIndex = targetIndex;
    changed = true;
  }

  const currentStep = PGE_STEPS[targetIndex];
  if (data.status !== currentStep.status || data.mensagem !== currentStep.descricao) {
    data.status = currentStep.status;
    data.mensagem = currentStep.descricao;
    changed = true;
  }

  const shouldBeActive = targetIndex < PGE_STEPS.length - 1;
  if (data.pgeFlow.active !== shouldBeActive) {
    data.pgeFlow.active = shouldBeActive;
    changed = true;
  }

  const archived = targetIndex === PGE_STEPS.length - 1;
  if (data.arquivado !== archived) {
    data.arquivado = archived;
    changed = true;
  }

  return changed;
}

function setStatusBadge(element, status) {
  element.className = "status-badge";

  if (status === "Deferido" || status === "Deferido pelo PGE") {
    element.classList.add("status-deferido");
  } else if (status === "Indeferido") {
    element.classList.add("status-indeferido");
  } else if (status === "Pendencia") {
    element.classList.add("status-pendencia");
  } else if (status === "Enviado para SEfaz") {
    element.classList.add("status-sefaz");
  } else if (status === "Efetuado o pagamento") {
    element.classList.add("status-pagamento");
  } else {
    element.classList.add("status-aguardando");
  }

  element.textContent = status;
}

function initLoginPage() {
  const form = document.getElementById("login-form");
  if (!form) {
    return;
  }

  const perfilField = document.getElementById("perfil");
  const loginLabel = document.getElementById("login-label");
  const loginInput = document.getElementById("login");

  function syncLoginField() {
    if (perfilField.value === "advogado") {
      loginLabel.textContent = "Numero da OAB";
      loginInput.placeholder = "Digite seu numero da OAB";
      return;
    }

    loginLabel.textContent = "Usuario";
    loginInput.placeholder = "Digite seu usuario";
  }

  syncLoginField();
  perfilField.addEventListener("change", syncLoginField);

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (perfilField.value === "advogado") {
      window.location.href = "advogado.html";
      return;
    }

    window.location.href = "administrador.html";
  });
}

function initAdvogadoPage() {
  const form = document.getElementById("advogado-form");
  if (!form) {
    return;
  }

  const feedback = document.getElementById("advogado-feedback");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const fileInput = document.getElementById("documento");
    const file = fileInput.files[0];

    if (!file) {
      feedback.textContent = "Selecione um documento para envio.";
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const createdAt = new Date();
      const payload = {
        advogado: {
          nome: document.getElementById("nome").value,
          oab: document.getElementById("oab").value,
          cpf: document.getElementById("cpf").value,
          email: document.getElementById("email").value,
          telefone: document.getElementById("telefone").value
        },
        documento: {
          nome: file.name,
          tipo: file.type,
          dataUrl: dataUrl
        },
        status: "Aguardando analise",
        adminStatus: "",
        mensagem: "Seu formulario foi enviado e esta aguardando analise do administrador.",
        retornoDocumento: null,
        arquivado: false,
        pgeFlow: null,
        historico: [
          {
            dataHora: getTimestamp(createdAt),
            status: "Em analise",
            descricao: "Formulario enviado para analise do administrador."
          }
        ]
      };

      saveRequest(payload);
      feedback.textContent = "Formulario enviado com sucesso.";
      window.location.href = "status.html";
    } catch (error) {
      feedback.textContent = "Nao foi possivel enviar o formulario.";
    }
  });
}

function initAdministradorPage() {
  const content = document.getElementById("admin-content");
  if (!content) {
    return;
  }

  const empty = document.getElementById("admin-empty");
  const form = document.getElementById("admin-form");
  const feedback = document.getElementById("admin-feedback");
  const archivedNotice = document.getElementById("admin-archived");
  const statusField = document.getElementById("status");
  const messageGroup = document.getElementById("mensagem-group");
  const messageField = document.getElementById("mensagem");
  const indeferidoDocumentGroup = document.getElementById("indeferido-documento-group");
  const indeferidoDocumentField = document.getElementById("indeferido-documento");
  const indeferidoCurrentFile = document.getElementById("indeferido-documento-atual");
  const submitButton = form.querySelector('button[type="submit"]');
  let data = loadRequest();

  if (!data) {
    empty.classList.remove("hidden");
    return;
  }

  const normalized = normalizeRequest(data);
  const simulated = runPgeSimulation(data);
  const changed = normalized || simulated;
  if (changed) {
    saveRequest(data);
  }

  function syncAdminMessageField() {
    const isPendencia = statusField.value === "Pendencia";
    const isIndeferido = statusField.value === "Indeferido";

    messageGroup.classList.toggle("hidden", !isPendencia);
    messageField.required = isPendencia;
    indeferidoDocumentGroup.classList.toggle("hidden", !isIndeferido);
    indeferidoDocumentField.required = isIndeferido && !data.retornoDocumento;

    if (!isPendencia) {
      messageField.value = "";
    }

    if (!isIndeferido) {
      indeferidoDocumentField.value = "";
    }
  }

  content.classList.remove("hidden");
  document.getElementById("admin-nome").textContent = data.advogado.nome;
  document.getElementById("admin-oab").textContent = data.advogado.oab;
  document.getElementById("admin-cpf").textContent = data.advogado.cpf;
  document.getElementById("admin-email").textContent = data.advogado.email;
  document.getElementById("admin-telefone").textContent = data.advogado.telefone;

  const link = document.getElementById("admin-documento");
  link.textContent = data.documento.nome;
  link.href = data.documento.dataUrl;
  link.download = data.documento.nome;

  statusField.value = data.adminStatus || "";
  messageField.value = data.adminStatus === "Pendencia" ? data.mensagem || "" : "";

  if (data.retornoDocumento) {
    indeferidoCurrentFile.textContent = "Documento atual: " + data.retornoDocumento.nome;
    indeferidoCurrentFile.classList.remove("hidden");
  } else {
    indeferidoCurrentFile.textContent = "";
    indeferidoCurrentFile.classList.add("hidden");
  }

  syncAdminMessageField();
  statusField.addEventListener("change", syncAdminMessageField);

  if (data.arquivado) {
    archivedNotice.classList.remove("hidden");
    statusField.disabled = true;
    messageField.disabled = true;
    indeferidoDocumentField.disabled = true;
    submitButton.disabled = true;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (data.arquivado) {
      feedback.textContent = "O processo ja foi finalizado e arquivado.";
      return;
    }

    const adminStatus = statusField.value;
    const mensagem = messageField.value.trim();
    const retornoFile = indeferidoDocumentField.files[0];

    if (!adminStatus) {
      feedback.textContent = "Selecione um status para continuar.";
      return;
    }

    if (adminStatus === "Pendencia" && !mensagem) {
      feedback.textContent = "Informe a mensagem que sera enviada ao advogado.";
      return;
    }

    if (adminStatus === "Indeferido" && !retornoFile && !data.retornoDocumento) {
      feedback.textContent = "Anexe o documento que sera devolvido ao advogado.";
      return;
    }

    let retornoDocumento = null;

    if (adminStatus === "Indeferido") {
      if (retornoFile) {
        try {
          retornoDocumento = {
            nome: retornoFile.name,
            tipo: retornoFile.type,
            dataUrl: await readFileAsDataUrl(retornoFile)
          };
        } catch (error) {
          feedback.textContent = "Nao foi possivel anexar o documento de retorno.";
          return;
        }
      } else {
        retornoDocumento = data.retornoDocumento;
      }
    }

    const updated = {
      ...data,
      adminStatus: adminStatus,
      retornoDocumento: adminStatus === "Indeferido" ? retornoDocumento : null,
      pgeFlow: null
    };

    if (adminStatus === "Deferido") {
      const approvalDate = new Date();
      appendHistoryEntry(updated, "Deferido", buildStatusDescription("Deferido"), approvalDate);
      startPgeFlow(updated, approvalDate);
    } else {
      updated.status = adminStatus;
      updated.mensagem = adminStatus === "Pendencia"
        ? mensagem
        : buildStatusDescription(adminStatus);
      appendHistoryEntry(updated, adminStatus, updated.mensagem);
    }

    saveRequest(updated);
    data = updated;

    if (data.retornoDocumento) {
      indeferidoCurrentFile.textContent = "Documento atual: " + data.retornoDocumento.nome;
      indeferidoCurrentFile.classList.remove("hidden");
    } else {
      indeferidoCurrentFile.textContent = "";
      indeferidoCurrentFile.classList.add("hidden");
    }

    syncAdminMessageField();
    feedback.textContent = "Status atualizado com sucesso.";
  });
}

function renderHistoryList(container, historico) {
  container.innerHTML = "";

  historico
    .slice()
    .reverse()
    .forEach((item) => {
      const entry = document.createElement("div");
      entry.className = "history-item";
      entry.innerHTML = `
        <p class="history-date">${item.dataHora}</p>
        <p class="history-status">Status: ${item.status}.</p>
        <p class="history-description">${item.descricao}</p>
      `;
      container.appendChild(entry);
    });
}

function initStatusPage() {
  const content = document.getElementById("status-content");
  if (!content) {
    return;
  }

  const empty = document.getElementById("status-empty");
  const badge = document.getElementById("status-badge");
  const statusMessage = document.getElementById("status-message");
  const arquivadoBox = document.getElementById("status-arquivado-box");
  const retornoBox = document.getElementById("status-retorno-box");
  const retornoLink = document.getElementById("status-retorno-link");
  const historico = document.getElementById("status-historico");

  function refreshStatusPage() {
    const data = loadRequest();

    if (!data) {
      empty.classList.remove("hidden");
      content.classList.add("hidden");
      return;
    }

    const normalized = normalizeRequest(data);
    const simulated = runPgeSimulation(data);
    const changed = normalized || simulated;
    if (changed) {
      saveRequest(data);
    }

    empty.classList.add("hidden");
    content.classList.remove("hidden");
    document.getElementById("status-nome").textContent = data.advogado.nome;
    document.getElementById("status-oab").textContent = data.advogado.oab;
    document.getElementById("status-cpf").textContent = data.advogado.cpf;
    document.getElementById("status-email").textContent = data.advogado.email;
    document.getElementById("status-telefone").textContent = data.advogado.telefone;
    document.getElementById("status-documento").textContent = data.documento.nome;
    setStatusBadge(badge, data.status);
    statusMessage.textContent = data.mensagem || "";

    if (data.arquivado) {
      arquivadoBox.classList.remove("hidden");
    } else {
      arquivadoBox.classList.add("hidden");
    }

    if (data.status === "Indeferido" && data.retornoDocumento) {
      retornoLink.textContent = data.retornoDocumento.nome;
      retornoLink.href = data.retornoDocumento.dataUrl;
      retornoLink.download = data.retornoDocumento.nome;
      retornoBox.classList.remove("hidden");
    } else {
      retornoBox.classList.add("hidden");
      retornoLink.textContent = "Baixar documento";
      retornoLink.href = "#";
    }

    renderHistoryList(historico, data.historico || []);
  }

  refreshStatusPage();
  window.setInterval(refreshStatusPage, 1000);
}

initLoginPage();
initAdvogadoPage();
initAdministradorPage();
initStatusPage();
