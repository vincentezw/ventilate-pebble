const form = document.querySelector("#config-form");

const connectionSection = document.querySelector("#connection-section");
const connectionFields = document.querySelector("#connection-fields");
const connectedState = document.querySelector("#connected-state");
const connectedUrl = document.querySelector("#connected-url");
const connectionStatus = document.querySelector("#connection-status");
const connectionMessage = document.querySelector("#connection-message");
const connectButton = document.querySelector("#connect-button");
const editConnectionButton = document.querySelector("#edit-connection");

const sensorsSection = document.querySelector("#sensors-section");
const sensorMessage = document.querySelector("#sensor-message");
const saveSection = document.querySelector("#save-section");
const saveButton = document.querySelector("#save-button");
const saveMessage = document.querySelector("#save-message");

const haUrlInput = document.querySelector("#ha-url");

const sensorInputs = {
  indoorTemperature: document.querySelector("#indoor-temperature"),
  indoorHumidity: document.querySelector("#indoor-humidity"),
  outdoorTemperature: document.querySelector("#outdoor-temperature"),
  outdoorHumidity: document.querySelector("#outdoor-humidity"),
};

let connected = false;
let entities = [];
let suggestionTimer = null;
let haToken = ""; // Store long-lived token obtained via OAuth

function normaliseUrl(url) {
  return url.trim().replace(/\/+$/, "");
}

function showMessage(element, text, type = "error") {
  element.textContent = text;
  element.className = `message ${type}`;
}

function hideMessage(element) {
  element.textContent = "";
  element.className = "message hidden";
}

function setConnected(value) {
  connected = value;

  connectionFields.classList.toggle("hidden", value);
  connectedState.classList.toggle("hidden", !value);
  connectionStatus.classList.toggle("hidden", !value);
  sensorsSection.classList.toggle("hidden", !value);
  saveSection.classList.toggle("hidden", !value);

  if (value) {
    connectedUrl.textContent = normaliseUrl(haUrlInput.value);
    connectionStatus.textContent = "Connected";
  }
}

function setConnecting(value) {
  connectButton.disabled = value;
  connectButton.textContent = value ? "Connecting…" : "Connect";
}

// Redirects the browser tab to Home Assistant's native OAuth authorization endpoint
function startOAuthFlow() {
  hideMessage(connectionMessage);
  const url = normaliseUrl(haUrlInput.value);

  if (!url) {
    showMessage(connectionMessage, "Please enter your Home Assistant URL.");
    return;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("The Home Assistant URL must use HTTP or HTTPS.");
    }
  } catch (err) {
    showMessage(connectionMessage, err.message || "Invalid URL.");
    return;
  }

  // Preserve the HA URL across page redirects
  localStorage.setItem("ha_url", url);

  // Clean current origin without query string or hash
  const redirectUri = window.location.origin + window.location.pathname;
  const clientId = redirectUri;

  const authUrl = `${url}/auth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  window.location.href = authUrl;
}

// Exchanges the authorization code for a long-lived refresh token
async function exchangeCodeForToken(haUrl, code) {
  const redirectUri = window.location.origin + window.location.pathname;
  const clientId = redirectUri;

  const response = await fetch(`${haUrl}/auth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      client_id: clientId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to exchange authorization code (HTTP ${response.status}).`);
  }

  const data = await response.json();
  
  // Home Assistant refresh token acts as a long-lived token
  return data.refresh_token || data.access_token;
}

async function fetchHomeAssistantStates(url, token) {
  const response = await fetch(`${url}/api/states`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Home Assistant rejected the token.");
    }
    throw new Error(`Home Assistant returned HTTP ${response.status}.`);
  }

  return response.json();
}

// Handles page reload after Home Assistant redirects back with ?code=...
async function handleOAuthCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get("code");
  const storedUrl = localStorage.getItem("ha_url");

  if (!code || !storedUrl) {
    return;
  }

  haUrlInput.value = storedUrl;
  setConnecting(true);

  // Clean the ?code=... from the address bar
  window.history.replaceState({}, document.title, window.location.pathname);

  try {
    haToken = await exchangeCodeForToken(storedUrl, code);
    const states = await fetchHomeAssistantStates(storedUrl, haToken);

    if (!Array.isArray(states)) {
      throw new Error("Home Assistant returned an unexpected response.");
    }

    buildEntityIndex(states);
    setConnected(true);
    hideMessage(sensorMessage);
  } catch (error) {
    console.error(error);
    setConnected(false);
    showMessage(
      connectionMessage,
      error.message || "Unable to complete Home Assistant authentication."
    );
  } finally {
    setConnecting(false);
  }
}

function buildEntityIndex(states) {
  entities = states
    .filter((state) => {
      const domain = state.entity_id?.split(".")[0];
      return domain === "sensor" || domain === "input_number";
    })
    .map((state) => ({
      id: state.entity_id,
      name: state.attributes?.friendly_name || state.entity_id,
      unit: state.attributes?.unit_of_measurement || "",
      deviceClass: state.attributes?.device_class || "",
    }));
}

function entityMatches(entity, query) {
  if (!query) {
    return true;
  }

  const haystack = [
    entity.id,
    entity.name,
    entity.unit,
    entity.deviceClass,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query.toLowerCase());
}

function showSuggestions(input) {
  const container = input.parentElement.querySelector(".suggestions");
  const query = input.value.trim();

  const matches = entities
    .filter((entity) => entityMatches(entity, query))
    .slice(0, 12);

  container.innerHTML = "";

  if (matches.length === 0) {
    container.classList.add("hidden");
    return;
  }

  for (const entity of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion";

    const name = document.createElement("span");
    name.className = "suggestion-name";
    name.textContent = entity.name;

    const id = document.createElement("span");
    id.className = "suggestion-id";
    id.textContent = [
      entity.id,
      entity.unit ? `· ${entity.unit}` : "",
    ].join(" ");

    button.append(name, id);

    button.addEventListener("click", () => {
      input.value = entity.id;
      hideSuggestions(input);
      validateSensors();
    });

    container.appendChild(button);
  }

  container.classList.remove("hidden");
}

function hideSuggestions(input) {
  input.parentElement
    .querySelector(".suggestions")
    .classList.add("hidden");
}

function validateSensors() {
  const values = Object.values(sensorInputs).map((input) => input.value.trim());
  const valid = values.every(Boolean);

  saveButton.disabled = !connected || !valid;

  return valid;
}

function setupSensorInputs() {
  for (const input of Object.values(sensorInputs)) {
    input.addEventListener("focus", () => {
      showSuggestions(input);
    });

    input.addEventListener("input", () => {
      window.clearTimeout(suggestionTimer);

      suggestionTimer = window.setTimeout(() => {
        showSuggestions(input);
      }, 80);

      validateSensors();
      hideMessage(sensorMessage);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        hideSuggestions(input);
      }
    });
  }

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".entity-field")) {
      for (const input of Object.values(sensorInputs)) {
        hideSuggestions(input);
      }
    }
  });
}

function editConnection() {
  setConnected(false);
  hideMessage(connectionMessage);
  haUrlInput.focus();
}

function getConfiguration() {
  return {
    haUrl: normaliseUrl(haUrlInput.value),
    haToken: haToken,

    sensors: {
      indoorTemperature: sensorInputs.indoorTemperature.value.trim(),
      indoorHumidity: sensorInputs.indoorHumidity.value.trim(),
      outdoorTemperature: sensorInputs.outdoorTemperature.value.trim(),
      outdoorHumidity: sensorInputs.outdoorHumidity.value.trim(),
    },
  };
}

function saveConfiguration() {
  const configuration = getConfiguration();

  const closeForm = document.createElement("form");
  closeForm.method = "POST";
  closeForm.action = "pebblejs://close#";
  closeForm.style.display = "none";

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "config";
  input.value = JSON.stringify(configuration);

  closeForm.appendChild(input);
  document.body.appendChild(closeForm);

  showMessage(
    saveMessage,
    "Saving configuration…",
    "success"
  );

  closeForm.submit();
}

// Connect button triggers the OAuth redirect
connectButton.addEventListener("click", startOAuthFlow);

editConnectionButton.addEventListener("click", editConnection);

form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!connected) {
    return;
  }

  if (!validateSensors()) {
    showMessage(
      sensorMessage,
      "Choose an entity for all four sensors."
    );
    return;
  }

  saveConfiguration();
});

setupSensorInputs();

// Initialize OAuth callback processing on page load
handleOAuthCallback();
