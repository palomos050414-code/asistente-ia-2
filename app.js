// ===== Configuración =====
const MODELO = "google/gemma-4-31b-it:free";
const URL_API = "https://openrouter.ai/api/v1/chat/completions";
const CLAVE_STORAGE = "openrouter_api_key"; // solo el nombre; la clave la pega el usuario
const MAX_HISTORIAL = 12; // mensajes recientes que se envían al modelo

// Personalidad del vendedor (mensaje de sistema)
const INSTRUCCIONES = `Eres "Tamy", la asistente virtual de ventas de Carbón Tamesino, un negocio de venta de carnes para asar al carbón.

Tu trabajo:
- Atender con calidez, en español, con frases cortas y claras.
- Recomendar cortes (res, cerdo, pollo, chorizo, costillas, etc.) según el número de personas y la ocasión.
- Ayudar a armar el pedido: pregunta cantidad de personas, tipo de carne, cantidad en kilos o porciones, dirección o recogida y forma de pago.
- Dar consejos breves de asado: punto de cocción, tiempo, manejo del carbón.

Reglas:
- No inventes precios, promociones, horarios ni disponibilidad. Si no los conoces, di que el equipo los confirma al cerrar el pedido.
- Haz una sola pregunta a la vez.
- Al final de un pedido, resume los productos y pide confirmación.
- Si te preguntan algo ajeno al negocio, responde con amabilidad y vuelve al tema de las carnes.
- Respuestas de máximo 5 líneas, salvo que te pidan más detalle.`;

// ===== Elementos del DOM =====
const $ = (id) => document.getElementById(id);
const principal = $("principal");
const mensajes = $("mensajes");
const formulario = $("formulario");
const entrada = $("entrada");
const botonEnviar = $("enviar");
const panelClave = $("panelClave");
const abrirClave = $("abrirClave");
const inputClave = $("inputClave");

const estadoClave = $("estadoClave");
const puntoEstado = $("puntoEstado");

let historial = [];   // conversación enviada al modelo
let cargando = false; // evita envíos dobles

// ===== Clave de API (sessionStorage) =====
function leerClave() {
  try { return sessionStorage.getItem(CLAVE_STORAGE) || ""; } catch { return ""; }
}

// Enciende el punto verde si hay clave guardada
function actualizarEstadoClave() {
  const hay = Boolean(leerClave());
  puntoEstado.classList.toggle("activo", hay);
  return hay;
}

function mostrarEstado(texto, tipo = "") {
  estadoClave.textContent = texto;
  estadoClave.className = "ayuda " + tipo;
}

function alternarPanel(abrir) {
  const mostrar = abrir ?? panelClave.hidden;
  panelClave.hidden = !mostrar;
  abrirClave.setAttribute("aria-expanded", String(mostrar));
  if (mostrar) inputClave.focus();
}

abrirClave.addEventListener("click", () => alternarPanel());


$("guardarClave").addEventListener("click", () => {
  const valor = inputClave.value.trim();
  if (!valor) {
    mostrarEstado("Pega tu clave de OpenRouter antes de guardar.", "error");
    return;
  }
  try {
    sessionStorage.setItem(CLAVE_STORAGE, valor);
    inputClave.value = ""; // no dejamos la clave visible en la casilla
    mostrarEstado("Clave guardada en esta pestaña. Ya puedes chatear.", "ok");
    actualizarEstadoClave();
    setTimeout(() => alternarPanel(false), 900);
  } catch {
    mostrarEstado("No se pudo guardar la clave en este navegador.", "error");
  }
});

$("borrarClave").addEventListener("click", () => {
  try { sessionStorage.removeItem(CLAVE_STORAGE); } catch {}
  inputClave.value = "";
  mostrarEstado("Clave borrada.");
  actualizarEstadoClave();
});

// ===== Utilidades de la interfaz =====
// Escapa HTML para evitar inyección de código desde la respuesta del modelo
function escapar(texto) {
  return texto.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}


// Formato mínimo y seguro: **negrita**, listas con "-" o "*" y párrafos
function formatear(texto) {
  const lineas = escapar(texto).split("\n");
  let html = "";
  let enLista = false;
  for (const linea of lineas) {
    const item = linea.match(/^\s*[-*•]\s+(.*)/);
    if (item) {
      if (!enLista) { html += "<ul>"; enLista = true; }
      html += `<li>${item[1]}</li>`;
    } else {
      if (enLista) { html += "</ul>"; enLista = false; }
      html += linea ? `<p>${linea}</p>` : "";
    }
  }
  if (enLista) html += "</ul>";
  return html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

// Oculta la portada y muestra el historial
function entrarEnModoChat() {
  principal.classList.add("conversando");
  mensajes.hidden = false;
}

function agregarBurbuja(rol, texto, esError = false) {
  const div = document.createElement("div");
  div.className = `burbuja ${rol}${esError ? " error" : ""}`;
  if (rol === "asistente") div.innerHTML = formatear(texto);
  else div.textContent = texto;
  mensajes.appendChild(div);
  mensajes.scrollTop = mensajes.scrollHeight;

  return div;
}

function agregarEscribiendo() {
  const div = document.createElement("div");
  div.className = "burbuja asistente";
  div.innerHTML = '<div class="escribiendo" aria-label="Escribiendo"><span></span><span></span><span></span></div>';
  mensajes.appendChild(div);
  mensajes.scrollTop = mensajes.scrollHeight;
  return div;
}

// La caja de texto crece con el contenido (hasta 160 px)
function ajustarAltura() {
  entrada.style.height = "auto";
  entrada.style.height = Math.min(entrada.scrollHeight, 160) + "px";
}

// ===== Llamada a OpenRouter =====
async function pedirRespuesta() {
  const cuerpo = {
    model: MODELO,
    messages: [
      { role: "system", content: INSTRUCCIONES },
      ...historial.slice(-MAX_HISTORIAL),
    ],
    temperature: 0.6,
    max_tokens: 500,
  };

  const respuesta = await fetch(URL_API, {
    method: "POST",

    headers: {
      "Authorization": `Bearer ${leerClave()}`,
      "Content-Type": "application/json",
      "X-Title": "Carbon Tamesino - Asistente",
    },
    body: JSON.stringify(cuerpo),
  });

  // Guardamos el código HTTP para elegir el mensaje de error adecuado
  if (!respuesta.ok) {
    const error = new Error("Error HTTP " + respuesta.status);
    error.status = respuesta.status;
    throw error;
  }

  const datos = await respuesta.json();
  const texto = datos?.choices?.[0]?.message?.content?.trim();
  if (!texto) throw new Error("Respuesta vacía");
  return texto;
}

// Mensajes amables según el tipo de error
function mensajeDeError(error) {
  if (error.status === 429) {
    return "Estamos recibiendo muchas consultas en este momento. 🙏 Espera unos segundos y vuelve a enviar tu mensaje; con gusto te sigo atendiendo.";
  }
  if (error.status === 401 || error.status === 403) {
    return "Tu clave de OpenRouter no es válida. Revísala en el botón «Clave API» e inténtalo de nuevo.";
  }
  if (error.status >= 500) {
    return "El servicio del asistente tiene un problema temporal. Inténtalo de nuevo en un momento.";
  }

  // Sin status: fallo de red (fetch lanzó una excepción)
  return "No pude conectarme con el asistente. Revisa tu conexión a internet e inténtalo otra vez.";
}

// ===== Flujo de envío =====
async function enviarMensaje(texto) {
  texto = texto.trim();
  if (!texto || cargando) return;

  // Sin clave: abrimos el panel y avisamos
  if (!leerClave()) {
    alternarPanel(true);
    mostrarEstado("Pega tu clave de OpenRouter para empezar a chatear.", "error");
    return;
  }

  entrarEnModoChat();
  agregarBurbuja("usuario", texto);
  historial.push({ role: "user", content: texto });
  entrada.value = "";
  ajustarAltura();

  cargando = true;
  botonEnviar.disabled = true;
  const indicador = agregarEscribiendo();

  try {
    const respuesta = await pedirRespuesta();
    indicador.remove();
    historial.push({ role: "assistant", content: respuesta });
    agregarBurbuja("asistente", respuesta);
  } catch (error) {

    indicador.remove();
    historial.pop(); // quita el mensaje fallido para poder reintentar sin duplicarlo
    agregarBurbuja("asistente", mensajeDeError(error), true);
    if (error.status === 401 || error.status === 403) alternarPanel(true);
  } finally {
    cargando = false;
    botonEnviar.disabled = false;
    entrada.focus();
  }
}

// ===== Eventos =====
formulario.addEventListener("submit", (e) => {
  e.preventDefault();
  enviarMensaje(entrada.value);
});

// Enter envía; Shift+Enter hace salto de línea
entrada.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    enviarMensaje(entrada.value);
  }
});

entrada.addEventListener("input", ajustarAltura);

// Chips y botones píldora envían su texto predefinido
document.querySelectorAll("[data-texto]").forEach((boton) => {
  boton.addEventListener("click", () => enviarMensaje(boton.dataset.texto));
});


actualizarEstadoClave();
