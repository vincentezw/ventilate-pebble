const form = document.querySelector("#config-form");

const connectionSection = document.querySelector("#connection-section");
const connectionFields = document.querySelector("#connection-fields");
const connectedState = document.querySelector("#connected-state");
const connectedUrl = document.querySelector("#connected-url");
const connectionStatus = document.querySelector("#connection-status");
const connectionMessage = document.querySelector("#connection-message");
const connectButton = document.querySelector("#connect-button");
const editConnectionButton = document.querySelector("#edit-connection");
const saveConnectionButton = document.querySelector("#save-connection");

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

    if (preloadedUrl) {
      haUrlInput.value = preloadedUrl;
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

    if (preloadedUrl && (entities.length > 0 || preloadedSensors)) {
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
  const clientId = redirectUri;

  const authUrl = `${url}/auth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  window.location.href = authUrl;
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
    const bridge = (typeof Pebble !== 'undefined' && Pebble &&
      typeof Pebble.sendMessage === 'function' &&
      typeof Pebble.addEventListener === 'function') ? Pebble : null;

    // if (bridge) {
    if (false) {
      const clientId = window.location.origin + window.location.pathname;
      const reply = await bridge.sendMessage(JSON.stringify({clientId, code, url: storedUrl}));
      if (!reply) {
        console.error('No reply from the watch app');
        showMessage(connectionMessage, "No reply from Pebble app");
        setConnected(false);
        return;
      }
      if (reply.error) {
        console.error(String(reply.error));
        showMessage(connectionMessage, reply.error);
        setConnected(false);
        return;
      }
			setConnected(true);
    } else {
      connectionFields.classList.toggle("hidden", true);
      connectedState.classList.toggle("hidden", false);
      connectionStatus.classList.toggle("hidden", false);
      editConnectionButton.classList.add('hidden');

      saveConnectionButton.classList.remove('hidden');
      saveConnectionButton.addEventListener('click', () => {
        saveConfiguration(code, storedUrl);
      });
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

function saveConfiguration(code, url) {
  const returnTo = getQueryParam("return_to", "pebblejs://close#");
  localStorage.removeItem("return_to");
  let locationUrl;
  if (code && url) {
    locationUrl = returnTo + encodeURIComponent(JSON.stringify({code, url}));
  } else {
    const configuration = getConfiguration();
    locationUrl = returnTo + encodeURIComponent(JSON.stringify(configuration));
  }
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

if (typeof Pebble !== 'undefined') {
  Pebble.addEventListener("message", function(event) {
    if (event.data && event.data.type === "entities") {
      try {
        entities = event.data.data.map(function(item) {
          if (Array.isArray(item)) {
            return { id: item[0], name: item[1] || item[0] };
          }
          return item;
        });
      } catch (err) {
        console.error("Failed to parse entities from Pebble message:", err);
      }
    }
  });
} else {
  console.log("Running in a standalone browser. Pebble bridge mocked/unavailable.");
}
const originalConsoleError = console.error;
console.error = function(...args) {
  originalConsoleError.apply(console, args);
  showMessage(connectionMessage, "ERR: " + args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' '), "error");
};

setupSensorInputs();

loadPreloadedEntitiesAndConfig();
handleOAuthCallback();
