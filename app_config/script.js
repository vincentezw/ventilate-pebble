const form = document.querySelector("#config-form");
const clientId = "https://vincentezw.github.io/ventilate-pebble/";

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
let haRefreshToken = null;
let haAccessToken = null;

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

function loadPreloadedEntitiesAndConfig() {
  try {
    // Merge search and hash parameters so URLSearchParams can read all keys reliably
    const rawParams = (window.location.search ? window.location.search.substring(1) + "&" : "") + 
                      (window.location.hash ? window.location.hash.substring(1) : "");
    const params = new URLSearchParams(rawParams);

    const preloadedUrl = params.get("url");
    const preloadedEntities = params.get("entities");
    const preloadedSensors = params.get("sensors");
    const preloadedToken = params.get("token") || params.get("accessToken");
    const preloadedRefreshToken = params.get("refreshToken");

    if (preloadedUrl) {
      haUrlInput.value = preloadedUrl;
    }

    if (preloadedToken) {
      haAccessToken = preloadedToken;
    }

    if (preloadedRefreshToken) {
      haRefreshToken = preloadedRefreshToken;
    }

    if (preloadedEntities) {
      const parsed = JSON.parse(preloadedEntities);
      entities = parsed.map(function(item) {
        if (Array.isArray(item)) {
          return { id: item[0], name: item[1] || item[0] };
        }
        return item;
      });
      console.log("Loaded " + entities.length + " cached entities from PKJS.");
    }

    if (preloadedSensors) {
      const savedSensors = JSON.parse(preloadedSensors);
      if (savedSensors.indoorTemperature) sensorInputs.indoorTemperature.value = savedSensors.indoorTemperature;
      if (savedSensors.indoorHumidity) sensorInputs.indoorHumidity.value = savedSensors.indoorHumidity;
      if (savedSensors.outdoorTemperature) sensorInputs.outdoorTemperature.value = savedSensors.outdoorTemperature;
      if (savedSensors.outdoorHumidity) sensorInputs.outdoorHumidity.value = savedSensors.outdoorHumidity;
    }

    if (preloadedUrl && (entities.length > 0 || haAccessToken || haRefreshToken)) {
      setConnected(true);
      validateSensors();
    }
  } catch (err) {
    console.error("Failed to parse preloaded data from hash:", err);
  }
}

function entityMatches(entity, query) {
  if (!query) {
    return true;
  }

  const id = entity.id || "";
  const name = entity.name || "";
  const unit = entity.unit || "";
  const deviceClass = entity.deviceClass || "";

  const haystack = (id + " " + name + " " + unit + " " + deviceClass).toLowerCase();
  return haystack.includes(query.toLowerCase());
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

  localStorage.setItem("ha_url", url);

  const currentReturnTo = getQueryParam("return_to", null);
  if (currentReturnTo) {
    localStorage.setItem("return_to", currentReturnTo);
  }

  const redirectUri = window.location.origin + window.location.pathname;

  const authUrl = `${url}/auth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  window.location.href = authUrl;
}

// Exchanges the authorization code for access and refresh tokens
async function exchangeCodeForToken(haUrl, code) {
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

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  };
}

// Handles page reload after Home Assistant redirects back with ?code=...
async function handleOAuthCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get("code");
  const storedUrl = localStorage.getItem("ha_url") || haUrlInput.value;

  if (!code || !storedUrl) {
    return;
  }

  haUrlInput.value = storedUrl;
  setConnecting(true);

  // Clean the ?code=... from the address bar while keeping existing hash
  window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);

  try {
    ({ access_token: haAccessToken, refresh_token: haRefreshToken } = await exchangeCodeForToken(storedUrl, code));
    setConnected(true);

    if (entities.length === 0) {
      showMessage(
        sensorMessage,
        "Connected! Type entity IDs manually above. Auto-complete suggestions will appear next time you open settings. Be sure to save the configuration to persist the connection to Home Assistant.",
        "info"
      );
    } else {
      hideMessage(sensorMessage);
    }
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

function showSuggestions(input) {
  if (entities.length === 0) return;

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
  const container = input.parentElement.querySelector(".suggestions");
  if (container) {
    container.classList.add("hidden");
  }
}

function validateSensors() {
  saveButton.disabled = !connected;

  return true;
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
    haAccessToken,
    haRefreshToken,
    indoorTemperature: sensorInputs.indoorTemperature.value.trim(),
    indoorHumidity: sensorInputs.indoorHumidity.value.trim(),
    outdoorTemperature: sensorInputs.outdoorTemperature.value.trim(),
    outdoorHumidity: sensorInputs.outdoorHumidity.value.trim(),
  };
}

function getQueryParam(variable, defaultValue) {
  const rawParams = window.location.search + "&" + window.location.hash.replace("#", "&");
  const urlParams = new URLSearchParams(rawParams);
  const value = urlParams.get(variable);

  if (value !== null) {
    return value;
  }

  const savedValue = localStorage.getItem(variable);
  return savedValue !== null ? savedValue : defaultValue;
}

function saveConfiguration() {
  const configuration = getConfiguration();
  const returnTo = getQueryParam("return_to", "pebblejs://close#");
  
  // Clean up localStorage return_to after reading
  localStorage.removeItem("return_to");

  const locationUrl = returnTo + encodeURIComponent(JSON.stringify(configuration));
  showMessage(saveMessage, "Saving configuration…", "success");

  window.location.href = locationUrl;
}

connectButton.addEventListener("click", startOAuthFlow);

editConnectionButton.addEventListener("click", editConnection);

form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!connected) {
    return;
  }

  saveConfiguration();
});

setupSensorInputs();

loadPreloadedEntitiesAndConfig();
handleOAuthCallback();
