import Poco from "commodetto/Poco";
import parseBMF from "commodetto/parseBMF";
import parseRLE from "commodetto/parseRLE";
import Message from "pebble/message";
import Button from "pebble/button";
import WakeUp from "pebble/wakeup";

const WAKEUP_COOKIE = 12345678;
const STORAGE_KEY = "ventilation_wakeup_id";
const START_TIME_KEY = "ventilation_start_time";

watch.addEventListener("wakeup", (wake) => {
  if (wake.cookie === WAKEUP_COOKIE) {
    WakeUp.cancel(wake.id);
    localStorage.removeItem(STORAGE_KEY);
    sendVentilationEndCommand();
    renderTimerFinishedScreen();
  }
});

const render = new Poco(screen);
const fonts = {
  gothicRegular: new render.Font("Gothic-Regular", 14),
	openSansRegular: getFont("OpenSans-Regular", 14),
	openSansBold: getFont("OpenSans-Semibold", 16),
};

const colours = {
  black: render.makeColor(0, 0, 0),
  white: render.makeColor(255, 255, 255),
  card: render.makeColor(3, 136, 252),
  red: render.makeColor(245, 180, 180),
  green: render.makeColor(190, 235, 190),
}

const icons = {
  back: new Poco.PebbleBitmap(1),
  minus: new Poco.PebbleBitmap(2),
  play: new Poco.PebbleBitmap(3),
  plus: new Poco.PebbleBitmap(4),
  stop: new Poco.PebbleBitmap(5),
  clock: new Poco.PebbleBitmap(6),
  droplet: new Poco.PebbleBitmap(7),
  fan: new Poco.PebbleDrawCommandImage(8),
  house: new Poco.PebbleDrawCommandSequence(12),
  thermometer: new Poco.PebbleBitmap(9),
  trendingDown: new Poco.PebbleBitmap(10),
  waves: new Poco.PebbleBitmap(11),
  window: new Poco.PebbleDrawCommandSequence(13),
};

let entityData = null;
let appMessageWritable = false;
let pendingCommand = null;
let selectedDuration = null;
let state = "loading";
let fanAnimation = null;
let windowAnimationTimer = null;
let windAnimationTimer = null;
let updateTimeDisplay = null;
let countdownTimer = null;
let ventilationStartedAt = null;
let startIndoorRelHumidity = null;

new Button({
  types: ["select", "up", "down", "back"],
  onPush(down, type) {
    if (!down) {
      return;
    }

    if (type === "back") {
      if (state === "time") {
        renderMainScreen();
        return;
      }
      stopAllTimers();
      if (typeof watch.exit === "function") {
        watch.exit();
      }
      return;
    }

    const handlers = {
      main: {
        select: () => renderTimeScreen(),
      },
      time: {
        select: () => renderWaitScreen(),
        up: () => {
          selectedDuration = Math.min(selectedDuration + 30, 3600);
          if (updateTimeDisplay) updateTimeDisplay();
        },
        down: () => {
          selectedDuration = Math.max(selectedDuration - 30, 60);
          if (updateTimeDisplay) updateTimeDisplay();
        },
      },
      wait: {
        select: () => {
          clearExistingWakeup();
          renderTimerFinishedScreen();
          sendVentilationEndCommand();
        },
      },
      finished: {
        select: () => renderMainScreen(),
      },
    };

    const action = handlers[state]?.[type];
    if (action) {
      action();
    }
  },
});

const appMessage = new Message({
  keys: ["command", "data"],
  onReadable() {
    console.log("Received message from phone.");
    const msg = this.read();
    const command = msg.get("command");
    console.log("Command received:", command);
    const data = msg.get("data");
    if (command === 0) {
      try {
        entityData = JSON.parse(data);
      } catch (e) {
        console.error("Failed to parse entity data:", e);
        entityData = null;
        return;
      }
      if (state === "loading" || state === "main") {
        renderMainScreen();
      } else if (state === "finished") {
        renderTimerFinishedScreen();
      }
    } else if (command === 2) {
      render.begin();
      render.fillRectangle(colours.white, 0, 0, render.width, render.height);
      drawTextCentered("Error: " + data, fonts.gothicRegular, colours.red);
      render.end();
      return;
    }
  },
  onWritable() {
    appMessageWritable = true;

    if (pendingCommand) {
      const cmd = pendingCommand;
      pendingCommand = null;
      const map = new Map([
        ["command", cmd.command],
      ]);
      if (cmd.data) {
        map.set("data", cmd.data);
      }
      this.write(map);
    }
  },
  onSuspend() {
    appMessageWritable = false;
  },
});

function getFont(name, size) {
	const font = parseBMF(new Resource(`${name}-${size}.fnt`));
	font.bitmap = parseRLE(new Resource(`${name}-${size}-alpha.bm4`))
	return font;
}

function drawTextCentered(msg, font, color, y = null) {
	const w = render.getTextWidth(msg, font);
  if (y === null) {
    y = (render.height - font.height) / 2;
  }
	render.drawText(msg, font, color, (render.width - w) - 14 >> 1, y);
}

function renderActionBar(select, up, down) {
  const width = 14;
  const x = render.width - width;

  render.fillRectangle(colours.black, x, 0, width, render.height);
  if (select === 'play') {
    render.drawBitmap(icons.play, x + 1, render.height / 2);
  } else if (select === 'stop') {
    render.drawBitmap(icons.stop, x + 1, render.height / 2);
  } else if (select === 'back') {
    render.drawBitmap(icons.back, x + 1, render.height / 2);
  }
  
  if (up === 'plus') {
    render.drawBitmap(icons.plus, x, 30);
  }
  if (down === 'minus') {
    render.drawBitmap(icons.minus, x, render.height - 44);
  }
}

function scheduleVentilationWakeup() {
  clearExistingWakeup();

  const endTime = Date.now() + (selectedDuration * 1000);
  const wakeupId = WakeUp.schedule(endTime, WAKEUP_COOKIE, false);
  
  localStorage.setItem(STORAGE_KEY, wakeupId.toString());
  localStorage.setItem(START_TIME_KEY, ventilationStartedAt.toString());
  return endTime;
}

function clearExistingWakeup() {
  const storedId = localStorage.getItem(STORAGE_KEY);
  if (storedId) {
    const id = parseInt(storedId, 10);
    const info = WakeUp.query(id);
    if (info && info.scheduled) {
      WakeUp.cancel(id);
    }
    localStorage.removeItem(STORAGE_KEY);
  }
  localStorage.removeItem(START_TIME_KEY);
}

function stopAllTimers() {
  if (fanAnimation !== null) {
    clearInterval(fanAnimation);
    fanAnimation = null;
  }
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  if (windowAnimationTimer) {
    clearTimeout(windowAnimationTimer);
    windowAnimationTimer = null;
  }
  if (windAnimationTimer) {
    clearTimeout(windAnimationTimer);
    windAnimationTimer = null;
  }
}

function trySend(command, data = null) {
  console.log("Attempting to send command:", command, "with data:", data);
  if (appMessageWritable) {
    const map = new Map([
      ["command", command],
    ]);
    if (data) {
      console.log("Adding data to message map:", data);
      map.set("data", data);
    }
    appMessage.write(map);
  } else {
    pendingCommand = {command, data};
  }
  console.log("Command sent or queued:", pendingCommand);
}

function sendVentilationEndCommand() {
  const payload = {
    startIndoorRelHumidity,
    ventilationStartedAt,
    ventilationEndedAt: Date.now(),
  };
  trySend(1, JSON.stringify(payload));
}

function renderMainScreen() {
  state = "main";
  stopAllTimers();

  if (!entityData) {
    render.begin();
    render.fillRectangle(colours.white, 0, 0, render.width, render.height);
    render.end();
    drawLabel("Loading...");
    return;
  }

  const recommendationText = {
    good: "Good time to ventilate",
    excellent: "Perfect time",
    weak: "Small benefit",
    none: "Little benefit",
    bad: "Don't ventilate now",
  }[entityData.recommendation];

  const recommendationColor = {
    good: render.makeColor(190, 235, 190),
    excellent: render.makeColor(160, 225, 160),
    weak: render.makeColor(245, 225, 150),
    none: render.makeColor(225, 225, 225),
    bad: render.makeColor(245, 180, 180),
  }[entityData.recommendation];

  const width = render.width - 24;
  const x = 5;
  const radius = 6;

  render.begin();
  render.fillRectangle(colours.white, 0, 0, render.width, render.height);
  renderActionBar("play", null, null);
  drawTextCentered(
    recommendationText,
    fonts.openSansBold,
    colours.black,
    4
  );

  const cardsY = [32, 90, 148];
  render.drawRoundRect(x, cardsY[0], width, 48, colours.card, radius);
  render.drawRoundRect(x, cardsY[1], width, 48, colours.card, radius);
  render.drawRoundRect(x, cardsY[2], width, 70, recommendationColor, radius);

  render.drawText(
    "Indoors",
    fonts.openSansRegular,
    colours.black,
    12,
    cardsY[0]
  );
  render.drawBitmap(icons.thermometer, 8, cardsY[0] + 18);
  render.drawBitmap(icons.droplet, (render.width / 2) - 14, cardsY[0] + 18);
  render.drawBitmap(icons.waves, 8, cardsY[0] + 32);
  render.drawText(
    `${Math.round(entityData.indoor.temperature)}°C`,
    fonts.gothicRegular,
    colours.black,
    22,
    cardsY[0] + 18
  );
  render.drawText(
    `${Math.round(entityData.indoor.relativeHumidity)}% RH`,
    fonts.gothicRegular,
    colours.black,
    (render.width / 2) + 2,
    cardsY[0] + 18
  );
  render.drawText(
    `${Math.round(entityData.indoor.absoluteHumidity)}g/m³ AH`,
    fonts.gothicRegular,
    colours.black,
    22,
    cardsY[0] + 32
  );

  render.drawText(
    "Outside",
    fonts.openSansRegular,
    colours.black,
    12,
    cardsY[1]
  );
  render.drawBitmap(icons.thermometer, 8, cardsY[1] + 18);
  render.drawBitmap(icons.droplet, (render.width / 2) - 14, cardsY[1] + 18);
  render.drawBitmap(icons.waves, 8, cardsY[1] + 32);
  render.drawText(
    `${Math.round(entityData.outdoor.temperature)}°C`,
    fonts.gothicRegular,
    colours.black,
    22,
    cardsY[1] + 18
  );
  render.drawText(
    `${Math.round(entityData.outdoor.relativeHumidity)}% RH`,
    fonts.gothicRegular,
    colours.black,
    (render.width / 2) + 2,
    cardsY[1] + 18
  );
  render.drawText(
    `${Math.round(entityData.outdoor.absoluteHumidity)}g/m³ AH`,
    fonts.gothicRegular,
    colours.black,
    22,
    cardsY[1] + 32
  );

  const duration = `Ventilate for ${Math.round(entityData.recommendedDuration / 60)} min`;
  const estimate = `${Math.round(entityData.expectedIndoorHumidity)}% RH`;
  const estimateWidth = render.getTextWidth(estimate, fonts.gothicRegular);
  const trendIconPadding = (render.width - estimateWidth) / 2 - 24;

  let angle = 0;
  fanAnimation = setInterval(() => {
    if (state !== "main") {
      stopAllTimers();
      return;
    }

    const fanX = (render.width / 2) - 14 - icons.fan.width / 2;
    const fanY = cardsY[2] + 32;

    render.begin();
    render.fillRectangle(recommendationColor, fanX, fanY, icons.fan.width, icons.fan.height);
    render.drawDCI(icons.fan.clone().rotate(angle, icons.fan.width >> 1, icons.fan.height >> 1), fanX, fanY);

    angle -= Math.PI / 30;
    render.end();
  }, 17);
  drawTextCentered(duration, fonts.openSansRegular, colours.black, cardsY[2] + 2);
  render.drawBitmap(icons.trendingDown, trendIconPadding, cardsY[2] + 18);
  drawTextCentered(estimate, fonts.gothicRegular, colours.black, cardsY[2] + 18);
  drawTextCentered("Press select to start", fonts.gothicRegular, colours.black, cardsY[2] + 55);
  render.end();
}

function renderTimeScreen() {
  state = "time";
  stopAllTimers();
  if (windowAnimationTimer) {
    clearTimeout(windowAnimationTimer);
    windowAnimationTimer = null;
  }

  if (selectedDuration === null) {
    selectedDuration = 420; // Default fallback in seconds (07:00)
  }

  const speedFactor = 4.0;
  const pauseDurationMs = 1500;

  const windowX = ((render.width - icons.window.width) / 2) - 7;
  const windowY = 10;
  const boxWidth = render.width - 48;
  const boxHeight = 32;
  const boxX = (render.width - boxWidth - 14) / 2;
  const boxY = windowY + icons.window.height + 8;

  const renderUI = () => {
    if (state !== "time") return;

    const minutes = Math.floor(selectedDuration / 60);
    const seconds = selectedDuration % 60;
    const timeString = `${minutes < 10 ? "0" : ""}${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;

    render.begin();
    render.drawRoundRect(boxX, boxY, boxWidth, boxHeight, colours.red, 6);

    const gap = 6;
    const totalContentWidth = icons.clock.width + gap + render.getTextWidth(timeString, fonts.openSansBold);
    const startX = boxX + (boxWidth - totalContentWidth) / 2;
    const contentY = boxY + (boxHeight - fonts.openSansBold.height) / 2;

    render.drawBitmap(icons.clock, startX, boxY + (boxHeight - icons.clock.height) / 2 + 1);
    render.drawText(
      timeString,
      fonts.openSansBold,
      colours.black,
      startX + icons.clock.width + gap,
      contentY
    );

    drawTextCentered("Open all windows wide!", fonts.gothicRegular, colours.black, boxY + boxHeight + 8);
    drawTextCentered("Press select when ready.", fonts.gothicRegular, colours.black, boxY + boxHeight + 22);

    render.end();
  }

  const drawFrame = () => {
    if (state !== "time") return;

    render.begin();
    render.fillRectangle(colours.white, windowX, windowY, icons.window.width, icons.window.height);
    render.drawDCI(icons.window, windowX, windowY);
    render.end();

    const baseDuration = icons.window.frameDuration || 100;
    const nextTime = icons.window.time + baseDuration;

    if (nextTime >= icons.window.duration) {
      icons.window.time = 0;
      windowAnimationTimer = setTimeout(drawFrame, pauseDurationMs);
    } else {
      icons.window.time = nextTime;
      windowAnimationTimer = setTimeout(drawFrame, baseDuration * speedFactor);
    }
  };

  render.begin();
  render.fillRectangle(colours.white, 0, 0, render.width, render.height);
  renderActionBar("play", "plus", "minus");
  render.end();

  renderUI();
  drawFrame();

  updateTimeDisplay = renderUI;
}

function renderWaitScreen() {
  state = "wait";
  stopAllTimers();

  const durationMs = (selectedDuration || 420) * 1000;
  const endTime = Date.now() + durationMs;
  ventilationStartedAt = Date.now();
  startIndoorRelHumidity = entityData?.indoor.relativeHumidity;
  scheduleVentilationWakeup();

  const scale = 3.0;
  const scaledWidth = (icons.house.width * scale) | 0;
  const scaledHeight = (icons.house.height * scale) | 0;
  const windowX = (((render.width - scaledWidth) / 2) - 7) | 0;
  const windowY = 10;

  const boxWidth = render.width - 48;
  const boxHeight = 32;
  const boxX = (render.width - boxWidth - 14) / 2;
  const boxY = windowY + scaledHeight + 8;

  const renderTimerCard = (remainingSeconds) => {
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    const timeString = `${mins < 10 ? "0" : ""}${mins}:` + `${secs < 10 ? "0" : ""}${secs}`;
    render.drawRoundRect(boxX, boxY, boxWidth, boxHeight, colours.green, 6);

    const gap = 6;
    const totalContentWidth = icons.clock.width + gap + render.getTextWidth(timeString, fonts.openSansBold);
    const startX = boxX + (boxWidth - totalContentWidth) / 2;
    const contentY = boxY + (boxHeight - fonts.openSansBold.height) / 2;

    render.drawBitmap(icons.clock, startX, boxY + (boxHeight - icons.clock.height) / 2 + 1);
    render.drawText( timeString, fonts.openSansBold, colours.black, startX + icons.clock.width + gap, contentY);
    drawTextCentered("Let that fresh air in!", fonts.openSansRegular, colours.black, boxY + boxHeight + 8);
    drawTextCentered("Feel free to close the app.", fonts.gothicRegular, colours.black, boxY + boxHeight + 48);
    drawTextCentered("We'll let you know when it's time to", fonts.gothicRegular, colours.black, boxY + boxHeight + 62);
    drawTextCentered("close the windows again.", fonts.gothicRegular, colours.black, boxY + boxHeight + 76);
  };

  const drawFrameAndTick = () => {
    if (state !== "wait") {
      return;
    }

    const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    const baseDuration = icons.house.frameDuration || 100;
    const nextTime = icons.house.time + baseDuration;
    if (nextTime >= (icons.house.duration || 0)) {
      icons.house.time = 0;
    } else {
      icons.house.time = nextTime;
    }

    render.begin();
    render.fillRectangle(colours.white, windowX, windowY, scaledWidth, scaledHeight);
    render.drawDCI(icons.house.clone().scale(scale), windowX, windowY);
    renderTimerCard(remaining);
    render.end();

    if (remaining <= 0) {
      stopAllTimers();
    }
  };

  render.begin();
  render.fillRectangle(colours.white, 0, 0, render.width, render.height);
  renderActionBar("stop", null, null);
  render.end();

  drawFrameAndTick();
  windAnimationTimer = setInterval(drawFrameAndTick, 1000);
}

function renderTimerFinishedScreen() {
  state = "finished";
  stopAllTimers();

  const width = render.width - 24;
  const cardX = (render.width - width - 14) / 2;
  const cardY = 32;
  const cardHeight = 100;

  render.begin();
  render.fillRectangle(colours.white, 0, 0, render.width, render.height);
  renderActionBar("back", null, null);
  drawTextCentered("Close all windows!", fonts.openSansBold, colours.black, 8);

  const lastIndoorHumidity = entityData ? entityData.indoor.relativeHumidity : null;
  const humUpdatedTimestamp = entityData && entityData.indoor.relHumLastUpdated
    ? new Date(entityData.indoor.relHumLastUpdated).getTime()
    : null;

  console.log("humUpdatedTimestamp:", humUpdatedTimestamp, "ventilationStartedAt:", ventilationStartedAt);

  const hasNewData = humUpdatedTimestamp && ventilationStartedAt && (humUpdatedTimestamp >= ventilationStartedAt);
  const cardColor = hasNewData ? colours.green : colours.card;
  render.drawRoundRect(cardX, cardY, width, cardHeight, cardColor, 6);

  if (lastIndoorHumidity !== null) {
    const elapsedSecs = Math.max(0, Math.floor((Date.now() - humUpdatedTimestamp) / 1000));
    let timeAgoStr = "just now";
    if (elapsedSecs >= 60) {
      const mins = Math.floor(elapsedSecs / 60);
      timeAgoStr = `${mins} min ago`;
    } else if (elapsedSecs > 5) {
      timeAgoStr = `${elapsedSecs} sec ago`;
    }

    render.drawText("Indoor Humidity", fonts.openSansRegular, colours.black, cardX + 8, cardY + 6);
    
    const humidityText = `${Math.round(lastIndoorHumidity)}% RH`;
    render.drawBitmap(icons.droplet, cardX + 8, cardY + 30);
    render.drawText(humidityText, fonts.openSansBold, colours.black, cardX + 28, cardY + 26);
    render.drawText(`Updated ${timeAgoStr}`, fonts.gothicRegular, colours.black, cardX + 8, cardY + 52);

    if (entityData.expectedIndoorHumidity !== undefined) {
      const targetText = `Target: ${Math.round(entityData.expectedIndoorHumidity)}% RH`;
      render.drawText(targetText, fonts.gothicRegular, colours.black, cardX + 8, cardY + 70);
    }
  } else {
    render.drawBitmap(icons.clock, cardX + 8, cardY + 12);
    render.drawText("Waiting for sensor...", fonts.openSansRegular, colours.black, cardX + 28, cardY + 10);
    
    drawTextCentered("No data received since", fonts.gothicRegular, colours.black, cardY + 42);
    drawTextCentered("ventilation started.", fonts.gothicRegular, colours.black, cardY + 58);
  }

  drawTextCentered("Press select to return home", fonts.gothicRegular, colours.black, render.height - 22);

  render.end();
}

function drawLabel(text) {
  const labelHeight = 20;
  const labelY = (render.height - labelHeight) / 2;
  drawTextCentered(text, fonts.openSansBold, colours.black, labelY);
}

function initApp() {
  const storedStartTime = localStorage.getItem(START_TIME_KEY);
  if (storedStartTime) {
    ventilationStartedAt = parseInt(storedStartTime, 10);
  }

  if (watch.wake) {
    clearExistingWakeup();
    sendVentilationEndCommand();
    renderTimerFinishedScreen();
    return;
  }

  const storedId = localStorage.getItem(STORAGE_KEY);
  if (storedId) {
    const id = parseInt(storedId, 10);
    const info = WakeUp.query(id);

    if (info && info.scheduled && info.time > Date.now()) {
      const remainingSeconds = Math.ceil((info.time - Date.now()) / 1000);
      selectedDuration = remainingSeconds;
      renderWaitScreen();
      return;
    } else {
      drawLabel("Loading...");
      clearExistingWakeup();
    }
  }

  drawLabel("Loading...");
}

initApp();

