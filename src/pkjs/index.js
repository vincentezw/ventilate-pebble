const HA_URL = "https://ha.local.zwanenburg.ie";
const ENTITY_INDOOR_TEMPERATURE = "sensor.ws2350_v2_38_indoor_temperature";
const ENTITY_INDOOR_HUMIDITY = "sensor.ws2350_v2_38_indoor_humidity";
const ENTITY_OUTDOOR_TEMPERATURE = "sensor.ws2350_v2_38_outdoor_temperature";
const ENTITY_OUTDOOR_HUMIDITY = "sensor.ws2350_v2_38_humidity";

const GET_STATES_ID = 1;
const SUBSCRIBE_STATES_ID = 2;
const GET_INDOOR_HUMIDITY_ID = 3;

const entities = {
  [ENTITY_INDOOR_TEMPERATURE]: null,
  [ENTITY_INDOOR_HUMIDITY]: null,
  [ENTITY_OUTDOOR_TEMPERATURE]: null,
  [ENTITY_OUTDOOR_HUMIDITY]: null
};

let humidityData;

function connectHomeAssistant() {
  const wsUrl = HA_URL.replace(/^http/, "ws") + "/api/websocket";
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
      case "event":
        handleEvent(message.event);
        break;
      case "result":
        if (message.id === GET_STATES_ID) {
          handleInitialStates(message.result);
        }
        break;
      case "auth_invalid":
        console.log("HA authentication failed");
        ws.close();
        break;
    }
  };

  ws.onerror = function(error) {
    console.log(`HA WebSocket error: ${error}`);
  };

  ws.onclose = function() {
    console.log("HA WebSocket closed");
  };
}

function authenticate(ws) {
  ws.send(JSON.stringify({
    type: "auth",
    access_token: HA_TOKEN
  }));
}

function getInitialStates(ws) {
  ws.send(JSON.stringify({
    id: GET_STATES_ID,
    type: "get_states"
  }));
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
      }
    }
  }

  if (allStatesAvailable()) {
    humidityData = {
      indoor: {
        temperature: entities[ENTITY_INDOOR_TEMPERATURE].value,
        humidity: entities[ENTITY_INDOOR_HUMIDITY].value,
        humLastUpdated: entities[ENTITY_INDOOR_HUMIDITY].lastUpdated
      },
      outdoor: {
        temperature: entities[ENTITY_OUTDOOR_TEMPERATURE].value,
        humidity: entities[ENTITY_OUTDOOR_HUMIDITY].value,
        humLastUpdated: entities[ENTITY_OUTDOOR_HUMIDITY].lastUpdated
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

  if (Number.isNaN(state)) {
    console.log(`Invalid state for ${entityId}`);
    return;
  }

  entities[entityId] = {
    value: state,
    lastUpdated,
  };

  if (allStatesAvailable()) {
    humidityData = {
      indoor: {
        temperature: entities[ENTITY_INDOOR_TEMPERATURE].value,
        humidity: entities[ENTITY_INDOOR_HUMIDITY].value,
        humLastUpdated: entities[ENTITY_INDOOR_HUMIDITY].lastUpdated
      },
      outdoor: {
        temperature: entities[ENTITY_OUTDOOR_TEMPERATURE].value,
        humidity: entities[ENTITY_OUTDOOR_HUMIDITY].value,
        humLastUpdated: entities[ENTITY_OUTDOOR_HUMIDITY].lastUpdated
      }
    };

    calculateVentilation(humidityData);
  }
}

function allStatesAvailable() {
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
      relativeHumidity: environment.indoor.humidity,
      absoluteHumidity: Math.round(indoorAbsoluteHumidity * 100) / 100,
      relHumLastUpdated: environment.indoor.humLastUpdated
    },
    outdoor: {
      temperature: environment.outdoor.temperature,
      relativeHumidity: environment.outdoor.humidity,
      absoluteHumidity: Math.round(outdoorAbsoluteHumidity * 100) / 100
    },
    absoluteHumidityDifference: Math.round(humidityDifference * 100) / 100,
    expectedIndoorHumidity: Math.round(expectedIndoorHumidity),
    recommendation,
    recommendedDuration
  };

  Pebble.sendAppMessage({command: 0, data: JSON.stringify(result)});
}

function calculateResult(data) {
  const startRelHumidity = data.startIndoorRelHumidity;
  const endRelHumidity = humidityData.indoor.relativeHumidity;
  // do we want to calculate the difference in absolute humidify?
  //
}

Pebble.addEventListener("ready", function() {
  connectHomeAssistant();
});

Pebble.addEventListener('appmessage', function (e) {
  const commandType = e.payload;
  const data = e.payload.data;
  
  console.log(`Received command from watch: ${commandType}, data: ${data}`);
  if (commandType === 1) {
    calculateResult(data);
  }
});
