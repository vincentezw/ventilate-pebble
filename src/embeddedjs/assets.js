import {} from "piu/MC";

const colours = Object.freeze({
  black: "#000000",
  white: "#FFFFFF",
  green: "#00ff00",
  yellow: "#ffff00",
  red: "#ff0000",
});

// using array to save some memory
const styles = [
  new Style({ font:"OpenSans-Regular-14", horizontal: "left", right: 5}),
  new Style({ font:"OpenSans-Semibold-18", horizontal: "center", top: 5, bottom: 5}),
  new Style({ font:"OpenSans-Semibold-14", horizontal: "left", left: 5}),
  new Style({
    font: "OpenSans-Semibold-18",
    horizontal: "center",
    top: 10,
    bottom: 10,
  }),
];

const skins = Object.freeze({
  actionBar: new Skin({
    texture: new Texture(1),
    width: 17,
    height: 14,
    fill: colours.black,
    variants: 17,
  }),
  blackBg: new Skin({ fill: colours.black }),
  main: new Skin({fill: [colours.white, colours.green, colours.yellow, colours.red]}),
});

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export {colours, styles, skins, formatDuration};
