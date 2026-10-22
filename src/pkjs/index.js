let haConfig = {
  haUrl: null,
  haAccessToken: null,
  haAccessTokenExpiry: null,
  haRefreshToken: null,
  indoorHumidity: null,
  indoorTemperature: null,
  outdoorHumidity: null,
  outdoorTemperature: null
};
let entities = {};
let endedVentilation = null;
     
const CONFIG_URL="https://vincentezw.github.io/ventilate-pebble/";
const GET_STATES_ID = 1;
const SUBSCRIBE_STATES_ID = 2;
const GET_INDOOR_HUMIDITY_ID = 3;

function sendError(errorMessage) {
  Pebble.sendAppMessage({command: 2, data: errorMessage});
}

function initEntitiesFromConfig() {
  const toCheck = [haConfig.indoorHumidity, haConfig.indoorTemperature, haConfig.outdoorHumidity, haConfig.outdoorTemperature];
  if (toCheck.some(entity => !entity)) {
    console.error("One or more entity IDs are missing in the configuration.");
    return {data: {}, error: "One or more entity IDs are missing in the configuration."};
  }

  var data = {};
  data[haConfig.indoorTemperature] = null;
  data[haConfig.indoorHumidity] = null;
  data[haConfig.outdoorTemperature] = null;
  data[haConfig.outdoorHumidity] = null;
  return {data, error: null};
}

let humidityData;

function isTokenExpired() {
  if (!haConfig || !haConfig.haAccessTokenExpiry) {
    return true;
  }

  const BUFFER_MS = 60 * 1000;
  return Date.now() + BUFFER_MS >= haConfig.haAccessTokenExpiry;
}

function ensureValidAccessToken(callback) {
  if (isTokenExpired()) {
    refreshAccessToken(callback);
  } else {
    callback(null);
  }
}

function exchangeCodeForToken(url, code, clientId, callback, replyFn) {
  const req = new XMLHttpRequest();
  req.open("POST", url + "/auth/token", true);
  req.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");

  req.onload = function() {
    if (req.status === 200) {
      try {
        const data = JSON.parse(req.responseText);
        const tokens = {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_in: data.expires_in
        };

        if (callback) {
          callback(null, url, tokens, replyFn);
        }
      } catch (err) {
        if (callback) {
          callback(err);
        }
      }
    } else {
      if (callback) {
        callback(new Error(`Failed to exchange authorization code (HTTP ${req.status}).`));
      }
    }
  };

  req.onerror = function() {
    if (callback) {
      callback(new Error("Network error during authorization code exchange"));
    }
  };

  req.send(
    "grant_type=authorization_code" +
    "&code=" + encodeURIComponent(code) +
    "&client_id=" + encodeURIComponent(clientId)
  );
}

function refreshAccessToken(callback) {
  if (!haConfig || !haConfig.haUrl || !haConfig.haRefreshToken) {
    console.error("Cannot refresh token: Missing URL or Refresh Token.");
    if (callback) { callback(new Error("Missing credentials")); }
    return;
  }

  const req = new XMLHttpRequest();
  req.open("POST", haConfig.haUrl + "/auth/token", true);
  req.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");

  req.onload = function() {
    if (req.status === 200) {
      try {
        const data = JSON.parse(req.responseText);
        haConfig.haAccessToken = data.access_token;

        if (data.expires_in) {
          haConfig.haAccessTokenExpiry = Date.now() + data.expires_in * 1000;
        }

        localStorage.setItem("ha_config", JSON.stringify(haConfig));

        if (callback) callback(null);
      } catch (err) {
        if (callback) callback(err);
      }
    } else {
      if (callback) callback(new Error("Refresh failed"));
    }
  };

  req.onerror = function() {
    if (callback) callback(new Error("Network error during token refresh"));
  };

  req.send(
    "grant_type=refresh_token&refresh_token=" +
    encodeURIComponent(haConfig.haRefreshToken) +
    "&client_id=" +
    encodeURIComponent(clientId)
  );
}

function loadConfig() {
  const haConfigString = localStorage.getItem('ha_config');
  if (haConfigString) {
    try {
      haConfig = JSON.parse(haConfigString);
    }
    catch (err) {
      console.error('Error parsing Home Assistant configuration from localStorage: ' + err.message);
    }
    const result = initEntitiesFromConfig(); 
    if (result.error) {
      console.error(result.error);
      sendError(result.error);
    }

    entities = result.data;
  }
}

Pebble.addEventListener('showConfiguration', function(e) {
  loadConfigWithEntities();
});

function tokenCallback(err, url, tokens, replyFn) {
  if (err) {
    console.error('Failed to exchange code for token: ' + err.message);
    return;
  }

  haConfig = haConfig || {};
  haConfig.haUrl = url;
  haConfig.haAccessToken = tokens.access_token;
  haConfig.haRefreshToken = tokens.refresh_token;
  haConfig.haAccessTokenExpiry = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null;

  localStorage.setItem('ha_config', JSON.stringify(haConfig));

  const result = initEntitiesFromConfig();
  if (result.error) {
    console.log(result.error);
    sendError(result.error);
  }
  entities = result.data;

  if (haConfig.haAccessToken && Object.keys(entities).length > 0) {
    connectHomeAssistant();
  }

  if (replyFn) {
    replyFn({data: 'ok', error: null});
  }
}

Pebble.addEventListener('configmessage', function(e) {
  const message = (e && e.data && typeof e.data === 'object') ? e.data : {};
  if (message.clientId && message.code && message.url) {
    exchangeCodeForToken(message.url, message.code, message.clientId, tokenCallback, e.respond);
  }
  loadConfigWithEntities(false, true);
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e || !e.response) {
    return;
  }

  try {
    const decoded = decodeURIComponent(e.response);
    const newConfig = typeof decoded === 'string' ? JSON.parse(decoded) : decoded;
    console.log("Received configuration from webview: " + JSON.stringify(newConfig));

    if (newConfig.code && newConfig.url) {
      const clientId = "https://vincentezw.github.io/ventilate-pebble/";

      exchangeCodeForToken(newConfig.url, newConfig.code, clientId, tokenCallback);
      return;
    }

    haConfig = {
      haUrl: haConfig.haUrl,
      haAccessToken: haConfig.haAccessToken,
      haRefreshToken: haConfig.haRefreshToken,
      haAccessTokenExpiry: haConfig.haAccessTokenExpiry,
      indoorHumidity: newConfig.indoorHumidity || haConfig.indoorHumidity || null,
      indoorTemperature: newConfig.indoorTemperature || haConfig.indoorTemperature || null,
      outdoorHumidity: newConfig.outdoorHumidity || haConfig.outdoorHumidity || null,
      outdoorTemperature: newConfig.outdoorTemperature || haConfig.outdoorTemperature || null,
    };
    localStorage.setItem('ha_config', JSON.stringify(haConfig));

    const result = initEntitiesFromConfig();
    if (result.error) {
      console.log(result.error);
      sendError(result.error);
    }
    
    entities = result.data;

    if (haConfig.haAccessToken && Object.keys(entities).length > 0) {
      connectHomeAssistant();
    }
  } catch (err) {
    console.error('Error parsing configuration response: ' + err.message);
  }
});

function composeConfigUrl() {
  if (!haConfig || !haConfig.haUrl) {
    return CONFIG_URL;
  }

  const params = [
    'url=' + encodeURIComponent(haConfig.haUrl),
    'accessToken=' + encodeURIComponent(haConfig.haAccessToken || ''),
    'refreshToken=' + encodeURIComponent(haConfig.haRefreshToken || ''),
    'indoorHumidity=' + encodeURIComponent(haConfig.indoorHumidity || ''),
    'indoorTemperature=' + encodeURIComponent(haConfig.indoorTemperature || ''),
    'outdoorHumidity=' + encodeURIComponent(haConfig.outdoorHumidity || ''),
    'outdoorTemperature=' + encodeURIComponent(haConfig.outdoorTemperature || '')
  ];

  return CONFIG_URL + '#' + params.join('&');
}

function loadConfigWithEntities(isRetry = false, sendToConfig = false) {
  if (!haConfig || !haConfig.haUrl || !haConfig.haRefreshToken || !haConfig.haAccessToken) {
    Pebble.openURL(CONFIG_URL);
    return;
  }

  ensureValidAccessToken(function(err) {
    if (err) {
      sendError('Reconnect to Home Assistant');
      return;
    }

    const req = new XMLHttpRequest();
    req.open('GET', haConfig.haUrl + '/api/states', true);
    req.setRequestHeader('Authorization', 'Bearer ' + haConfig.haAccessToken);
    req.setRequestHeader('Content-Type', 'application/json');

    req.onload = function() {
      if (req.status === 200) {
        try {
          const states = JSON.parse(req.responseText);
          var filtered = states
            .filter(function(s) {
              if (!s.entity_id || !s.entity_id.startsWith('sensor.')) { return false;  }
              const deviceClass = s.attributes && s.attributes.device_class;
              return deviceClass === 'temperature' || deviceClass === 'humidity';
            })
            .map(function(s) {
              const friendlyName = (s.attributes && s.attributes.friendly_name) || s.entity_id;
              return {
                id: s.entity_id,
                name: friendlyName.length > 25 ? friendlyName.substring(0, 22) + '...' : friendlyName
              };
            });

          const filteredEntities = JSON.stringify(filtered);
          if (sendToConfig) {
            Pebble.sendConfigMessage({
              type: "entities",
              data: filtered,
              error: null
            });
            return;
          }

          const url = composeConfigUrl() + '&entities=' + encodeURIComponent(filteredEntities);
          Pebble.openURL(url);
        } catch (err) {
          console.error('Error parsing states response: ' + err.message);
          Pebble.openURL(composeConfigUrl());
        }
      } else {
        if (req.status === 401 && !isRetry) {
          console.log('Unauthorized access. Attempting to refresh token.');
          refreshAccessToken(function(err) {
            if (err) {
              console.log('Token refresh failed: ' + err.message);
              sendError('Token refresh failed: ' + err.message);
              return;
            }
            loadConfigWithEntities(true);
          })
        }

        console.log('Failed to fetch states natively. HTTP Status: ' + req.status);
        Pebble.openURL(composeConfigUrl());
      }
    };

    req.onerror = function() {
      console.log('Network error occurred while fetching Home Assistant entities.');
    };

    req.send();
  });
}

function connectHomeAssistant(isRetry = false) {
  if (!haConfig || !haConfig.haUrl) {
    console.error("Home Assistant URL not configured.");
    sendError("Home Assistant URL not configured.");
    return;
  }

  if (!haConfig.haAccessToken || !haConfig.haRefreshToken) {
    console.error("Home Assistant access token or refresh token not configured.");
    sendError("Reconnect to Home Assistant");
    return;
  }

  if (!haConfig.indoorHumidity || !haConfig.indoorTemperature || !haConfig.outdoorHumidity || !haConfig.outdoorTemperature) {
    console.error("One or more sensor entity IDs are not configured.");
    sendError("One or more sensor entity IDs are not configured.");
    return;
  }

  ensureValidAccessToken(function(err) {
    if (err) {
      console.error("Error ensuring valid access token: " + err.message);
      sendError("Reconnect to Home Assistant");
      return;
    }

    const wsUrl = haConfig.haUrl.replace(/^http/, "ws") + "/api/websocket";
    const ws = new WebSocket(wsUrl);

    ws.onopen = function() {
      console.log("HA WebSocket connected");
    };

    ws.onmessage = function(event) {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case "auth_required":
          authenticate(ws);
          break;
        case "auth_ok":
          getInitialStates(ws);
          subscribeToStates(ws);
          break;
        case "auth_invalid":
          console.log("HA authentication failed");
          refreshAccessToken(function(err) {
            if (err) {
              console.log("Token refresh failed: " + err.message);
              ws.close();
              return;
            }
            if (!isRetry) {
              connectHomeAssistant(true);
            }
          });
          break;
        case "event":
          handleEvent(message.event);
          break;
        case "result":
          if (message.id === GET_STATES_ID) {
            handleInitialStates(message.result);
          }
          break;
      }
    };

    ws.onerror = function(error) {
      console.log(`HA WebSocket error: ${error}`);
    };

    ws.onclose = function() {
      console.log("HA WebSocket closed");
    };
  });
}

function authenticate(ws) {
  ws.send(JSON.stringify({
    type: "auth",
    access_token: haConfig.haAccessToken
  }));
}

function getInitialStates(ws) {
  ws.send(JSON.stringify({
    id: GET_STATES_ID,
    type: "get_states" }));
  console.log("Requested initial states from HA");
}

function handleInitialStates(states) {
  for (const state of states) {
    const entityId = state.entity_id;

    if (!(entityId in entities)) {
      continue;
    }

    const value = parseFloat(state.state);
    const lastUpdated = state.last_reported;
    if (!Number.isNaN(value)) {
      entities[entityId] = {
        value,
        lastUpdated,
        unit: state.attributes && state.attributes.unit_of_measurement
      }
    }
  }

  if (allStatesAvailable()) {
    humidityData = {
      indoor: {
        temperature: entities[haConfig.indoorTemperature].value,
        temp_unit: entities[haConfig.indoorTemperature].unit,
        humidity: entities[haConfig.indoorHumidity].value,
        humLastUpdated: entities[haConfig.indoorHumidity].lastUpdated
      },
      outdoor: {
        temperature: entities[haConfig.outdoorTemperature].value,
        temp_unit: entities[haConfig.outdoorTemperature].unit,
        humidity: entities[haConfig.outdoorHumidity].value,
        humLastUpdated: entities[haConfig.outdoorHumidity].lastUpdated
      }
    };
    calculateVentilation(humidityData);
  }
}

function subscribeToStates(ws) {
  ws.send(JSON.stringify({
    id: SUBSCRIBE_STATES_ID,
    type: "subscribe_events",
    event_type: "state_changed"
  }));

  console.log("Subscribed to HA state changes");
}

function handleEvent(event) {
  const entityId = event.data.entity_id;
  if (!(entityId in entities)) {
    return;
  }

  const state = parseFloat(event.data.new_state.state);
  const lastUpdated = event.data.new_state.last_reported;
  const unit = event.data.new_state.attributes && event.data.new_state.attributes.unit_of_measurement;

  if (Number.isNaN(state)) {
    console.log(`Invalid state for ${entityId}`);
    return;
  }

  entities[entityId] = {
    value: state,
    unit,
    lastUpdated,
  };

  if (allStatesAvailable()) {
    humidityData = {
      indoor: {
        temperature: entities[haConfig.indoorTemperature].value,
        temp_unit: entities[haConfig.indoorTemperature].unit,
        humidity: entities[haConfig.indoorHumidity].value,
        humLastUpdated: entities[haConfig.indoorHumidity].lastUpdated
      },
      outdoor: {
        temperature: entities[haConfig.outdoorTemperature].value,
        temp_unit: entities[haConfig.outdoorTemperature].unit,
        humidity: entities[haConfig.outdoorHumidity].value,
        humLastUpdated: entities[haConfig.outdoorHumidity].lastUpdated
      }
    };

    calculateVentilation(humidityData);
  }
}

function allStatesAvailable() {
  const keys = Object.keys(entities || {});
  if (keys.length === 0) { return false;  }
  return Object.values(entities).every(value => value !== null);
}

function absoluteHumidity(temperature, relativeHumidity) {
  return (
    relativeHumidity *
    6.112 *
    2.1674 *
    Math.exp((temperature * 17.67) / (temperature + 243.5)) /
    (temperature + 273.15)
  );
}

function relativeHumidity(temperature, absoluteHumidity) {
  const saturationVapourPressure =
    6.112 * Math.exp((temperature * 17.67) / (temperature + 243.5));

  return (
    absoluteHumidity *
    (temperature + 273.15) /
    (2.1674 * saturationVapourPressure)
  );
}

function getRecommendation(humidityDifference) {
  if (humidityDifference < 0) {
    return "bad";
  }

  if (humidityDifference < 0.5) {
    return "none";
  }

  if (humidityDifference < 2) {
    return "weak";
  }

  if (humidityDifference < 4) {
    return "good";
  }

  return "excellent";
}


function getRecommendedDuration(indoorTemperature, outdoorTemperature) {
  const temperatureDifference =
    indoorTemperature - outdoorTemperature;

  if (temperatureDifference >= 10) {
    return 240; // 4 minutes
  }

  if (temperatureDifference >= 7) {
    return 300; // 5 minutes
  }

  if (temperatureDifference >= 4) {
    return 420; // 7 minutes
  }

  if (temperatureDifference >= 2) {
    return 480; // 8 minutes
  }

  return 600; // 10 minutes
}

function calculateVentilation(environment) {
  const indoorAbsoluteHumidity = absoluteHumidity(environment.indoor.temperature, environment.indoor.humidity);
  const outdoorAbsoluteHumidity = absoluteHumidity(environment.outdoor.temperature, environment.outdoor.humidity);

  const humidityDifference = indoorAbsoluteHumidity - outdoorAbsoluteHumidity;
  const expectedIndoorHumidity = relativeHumidity(environment.indoor.temperature, outdoorAbsoluteHumidity);
  const recommendedDuration = getRecommendedDuration(environment.indoor.temperature, environment.outdoor.temperature);
  const recommendation = getRecommendation(humidityDifference);

  const result = {
    indoor: {
      temperature: environment.indoor.temperature,
      temp_unit: environment.indoor.temp_unit,
      relativeHumidity: environment.indoor.humidity,
      absoluteHumidity: Math.round(indoorAbsoluteHumidity * 100) / 100,
      relHumLastUpdated: environment.indoor.humLastUpdated
    },
    outdoor: {
      temperature: environment.outdoor.temperature,
      temp_unit: environment.outdoor.temp_unit,
      relativeHumidity: environment.outdoor.humidity,
      absoluteHumidity: Math.round(outdoorAbsoluteHumidity * 100) / 100
    },
    absoluteHumidityDifference: Math.round(humidityDifference * 100) / 100,
    expectedIndoorHumidity: Math.round(expectedIndoorHumidity),
    recommendation,
    recommendedDuration,
    endSummary: calculateResult()
  };

  console.log("Sending ventilation calculation result to Pebble: " + JSON.stringify(result));

  Pebble.sendAppMessage({command: 0, data: JSON.stringify(result)});
}

function calculateResult() {
  if (!endedVentilation) {
    return {};
  }

  const startMs = endedVentilation.startedAt.getTime();
  const lastUpdatedMs = humidityData.indoor.humLastUpdated 
    ? new Date(humidityData.indoor.humLastUpdated).getTime() 
    : Date.now();
  const isFresh = lastUpdatedMs >= startMs;
  const startAbs = absoluteHumidity(endedVentilation.startIndoorTemperature, endedVentilation.startIndoorRelHumidity);
  const endAbs = absoluteHumidity(humidityData.indoor.temperature, humidityData.indoor.humidity);
  const absDiff = startAbs - endAbs; 
  const relDiff = endedVentilation.startIndoorRelHumidity - humidityData.indoor.humidity;
  let elapsedSec = Math.floor((Date.now() - startMs) / 1000);
  if (elapsedSec < 0) { elapsedSec = 0; }
  const tempDiff = humidityData.indoor.temperature - endedVentilation.startIndoorTemperature;

  let minutesAgo = Math.floor((Date.now() - lastUpdatedMs) / 60000);
  if (minutesAgo < 0) { minutesAgo = 0; }

  return {
    isFresh,
    absHumidityDiff: Math.round(absDiff * 100) / 100, // g/m³ drop
    relHumidityDiff: Math.round(relDiff * 10) / 10,   // % drop
    elapsedMinutes: Math.round(elapsedSec / 60),
    measuredMinutesAgo: minutesAgo,
    tempDiff,
  };
}

Pebble.addEventListener("ready", function() {
  loadConfig();
  connectHomeAssistant();
});

Pebble.addEventListener('appmessage', function (e) {
  const commandType = e.payload.command;
  const data = e.payload.data;
  
  if (commandType === 1) {
    try {
      const parsed = JSON.parse(data);
      endedVentilation = {
        startedAt: new Date(parsed.startedAt),
        startIndoorRelHumidity: parseFloat(parsed.startIndoorRelHumidity),
        startIndoorTemperature: parseFloat(parsed.startIndoorTemperature),
      };

      if (allStatesAvailable()) {
        calculateVentilation(humidityData);
      }
    } catch (err) {
      console.log("Error parsing active ventilation data: " + err.message);
    }
  }
});

