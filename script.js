const file = document.getElementById("file");
// read .nbs file

let loadedNBS = null;
let tempo;

file.addEventListener("change", (e) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    const nbsBuffer = new NBSBuffer(e.target.result);
    parseNBS(nbsBuffer);
  };
  reader.readAsArrayBuffer(e.target.files[0]);
});

function showInfo(message, color) {
  const info = document.getElementById("info");
  info.innerHTML = message;

  info.style.backgroundColor = color;
}

function parseNBS(nbsBuffer) {
  const firstTwoBytes = nbsBuffer.readShort();
  if (firstTwoBytes > 0) {
    showInfo("Error: This NBS file is saved in the old format, please open it in Note Block Studio and resave it.", "red");
    return;
  }
  let header = readHeader(nbsBuffer);
  if (!header) return;
  let notes = readNotes(nbsBuffer);
  if (!notes) return;

  showMetadata(header);

  loadedNBS = {
    header,
    notes,
  };

  showInfo("Successfully opened the .nbs file.", "green");
}

function showMetadata(header) {
  document.getElementById("song-name").innerHTML = header.songName;
  document.getElementById("song-author").innerHTML = header.songAuthor;
  document.getElementById("song-original-author").innerHTML = header.originalAuthor;
  document.getElementById("song-description").innerHTML = header.description;
  document.getElementById("song-tempo").innerHTML = header.tempo / 100;
  document.getElementById("song-version").innerHTML = header.version;
  document.getElementById("song-length").innerHTML = header.songLength / 20 + " seconds";
}

function readHeader(nbsBuffer) {
  try {
    header = {
      version: nbsBuffer.readByte(),
      vanillaInstrumentCount: nbsBuffer.readByte(),
      songLength: nbsBuffer.readShort(),
      layerCount: nbsBuffer.readShort(),
      songName: nbsBuffer.readString(),
      songAuthor: nbsBuffer.readString(),
      originalAuthor: nbsBuffer.readString(),
      description: nbsBuffer.readString(),
      tempo: nbsBuffer.readShort(),
      autoSave: nbsBuffer.readByte(),
      autoSaveDuration: nbsBuffer.readByte(),
      timeSignature: nbsBuffer.readByte(),
      minutesSpent: nbsBuffer.readInt(),
      leftClicks: nbsBuffer.readInt(),
      rightClicks: nbsBuffer.readInt(),
      blocksAdded: nbsBuffer.readInt(),
      blocksRemoved: nbsBuffer.readInt(),
      midiSchemName: nbsBuffer.readString(),
      loop: nbsBuffer.readByte(),
      maxLoopCount: nbsBuffer.readByte(),
      loopStartTick: nbsBuffer.readShort(),
    };
    return header;
  } catch (e) {
    showInfo("Error: There was an error reading the .nbs header.", "red");
    console.error(e);
  }
}

function readNotes(nbsBuffer) {
  try {
    let notes = [];
    let tick = -1;
    while (true) {
      let jumpsTillNextTick = nbsBuffer.readShort();
      if (jumpsTillNextTick === 0) break;
      tick += jumpsTillNextTick;
      let layer = -1;
      while (true) {
        let jumpsTillNextLayer = nbsBuffer.readShort();
        if (jumpsTillNextLayer === 0) break;
        layer += jumpsTillNextLayer;
        let instrument = nbsBuffer.readByte();
        let key = nbsBuffer.readByte();
        if (key < 33 || key > 57) {
          showInfo("Error: The .nbs file contains a key that is not in the range of 33 to 57, which is not supported in Housing.", "red");
          return;
        }
        key -= 33; // make lowest key 0 and highest key 24
        let velocity = nbsBuffer.readByte();
        let panning = nbsBuffer.readByte();
        let pitch = nbsBuffer.readShort();

        notes.push({
          tick,
          instrument,
          key,
          velocity
        });
      }
    }
    return notes;
  } catch (e) {
    showInfo("Error: There was an error reading the .nbs notes.", "red");
    console.error(e);
  }
}

const convert = document.getElementById("convert");
convert.addEventListener("click", () => {
  if (!loadedNBS) {
    showInfo("Error: No .nbs file loaded.", "red");
    return;
  }

  const htsl = convertToHTSL(loadedNBS);

  setOutputs(htsl);
  showInfo("Successfully copied the HTSL code to your clipboard.", "green");
});

function setOutputs(htsl) {
  const outputsElement = document.getElementById("outputs");
  outputsElement.innerHTML = "";
  let megafunc = htsl.funcs[0].code;
  for (let i = 1; i < htsl.funcs.length; i++) {
    megafunc = `${megafunc}\ngoto function "${htsl.funcs[i].name}"\n${htsl.funcs[i].code}`;
  }
  function createOutput(name, code) {
    const output = document.createElement("div");
    output.classList.add("output");
    const outputName = document.createElement("h3");
    outputName.innerHTML = name;
    const outputCode = document.createElement("code");
    outputCode.innerHTML = code;
    const pre = document.createElement("pre");
    const saveToFile = document.createElement("button");
    saveToFile.innerHTML = "Save to file";
    saveToFile.addEventListener("click", () => {
      const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
      saveAs(blob, name);
    });
    pre.appendChild(outputCode);
    output.appendChild(outputName);
    output.appendChild(saveToFile);
    output.appendChild(pre);
    outputsElement.appendChild(output);
  }
  createOutput(htsl.funcs[0].name, megafunc);
}

function saveAs(blob, name) {
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function convertToHTSL(nbs) {
  const funcs = generateFunctionChainsHTSL(nbs);

  return { funcs };
}

function generateFunctionChainsHTSL(nbs) {
  // remove duplicate notes
  nbs.notes = nbs.notes.filter((note, index, self) => {
    return index === self.findIndex((t) => t.tick === note.tick && t.instrument === note.instrument && t.key === note.key);
  });

  // generate function chains
  let firstChain = generateFunctionChain(nbs.notes, 1);

  return [...firstChain];
}

function generateFunctionChain(notes, chainNumber) {
  let chainOfFuncs = [];
  // sort by tick
  notes.sort((a, b) => a.tick - b.tick);

const MAX_SOUNDS = 25;
const MAX_PAUSE = 25;
const MAX_IFS = 15;
const functions = Math.ceil(notes.length / (MAX_SOUNDS * (MAX_IFS + 1)));
for (let i = 0; i < functions; i++) {
  let funcName = `songchain${chainNumber}-${i}`;
  let funcBody = "";
  for (let j = 0; j < (MAX_IFS + 1) * MAX_SOUNDS && notes[0]; j++) {
    funcBody += `sound "${getInstrumentFromNBS(notes[0].instrument)}" ${notes[0].velocity / 100} ${getPitchFromKey(notes[0].key)} invokers_location\n`;
    if (notes[1] != null) {
      let pause = Math.floor((notes[1].tick - notes[0].tick) * (20 / (loadedNBS.header.tempo / 100)));
      if (pause > 0) {
        funcBody += `pause ${pause}\n`;
      }
    }
    notes.shift();
  }
  let lines = funcBody.split("\n");
  let finalFuncBody = "";
  let ifs = 0;
  while (lines.length > 0 && ifs < MAX_IFS) {
    finalFuncBody += "if () {\n";
    let ifPause = 0;
    let firstpause = false;
    for (let k = 0; k < MAX_SOUNDS && lines.length > 0; k++) {
      if (lines[0].startsWith("pause")) {
        // add the pause time together
        if (firstpause) {
            ifPause += parseInt(lines[0].match(/pause (\d+)/)[1]);
        } else {
            firstpause = true;
        }
        finalFuncBody += lines.shift() + "\n";
      }
      finalFuncBody += lines.shift() + "\n";
    }
    finalFuncBody += `}\npause ${ifPause}\n`;
    ifs++;  
  }
  funcBody = finalFuncBody;
  for (let k = 0; i < MAX_SOUNDS && lines.length > 0; k++) {
    if (lines[0].startsWith("pause")) {
        funcBody += lines.shift() + "\n";
      }
      funcBody += lines.shift() + "\n";
  }
  if (i != functions - 1) {
    funcBody += `function songchain${chainNumber}-${i + 1}`;
  }
    chainOfFuncs.push({
      name: funcName,
      code: funcBody,
    });
  }

  return chainOfFuncs;
}

function getPitchFromKey(key) {
  return Math.pow(2, (key - 12) / 12);
}

function getInstrumentFromNBS(instrument) {
  switch (instrument) {
    case 0:
      return "block.note_block.harp";
    case 1:
      return "block.note_block.bass";
    case 2:
      return "block.note_block.basedrum";
    case 3:
      return "block.note_block.snare";
    case 4:
      return "Note Sticks";
    case 5:
      return "block.note_block.guitar";
    case 6:
      return "block.note_block.flute";
    case 7:
      return "block.note_block.bell";
    case 8:
      return "block.note_block.chime";
    case 9:
      return "block.note_block.xylophone";
    case 10:
      return "block.note_block.iron_xylophone";
    case 11:
      return "block.note_block.cow_bell";
    case 12:
      return "block.note_block.didgeridoo";
    case 13:
      return "block.note_block.bit";
    case 14:
      return "block.note_block.banjo";
    case 15:
      return "block.note_block.pling";
    case 16:
      return "block.glass.break";
    case 17:
      return "entity.experience_orb.pickup";
    case 18:
      return "block.lava.extinguish";
    case 19:
      return "entity.generic.explode";
    case 20:
      return "entity.firework.blast_far";

    default:
      return "yubbaro"+instrument;
  }
}

class NBSBuffer {
  constructor(arrayBuffer) {
    this.dataView = new DataView(arrayBuffer);
    this.offset = 0;
  }

  readShort() {
    const value = this.dataView.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readByte() {
    const value = this.dataView.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readInt() {
    const value = this.dataView.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readString() {
    const length = this.readInt();
    let result = "";
    for (let i = 0; i < length; i++) {
      result += String.fromCharCode(this.dataView.getUint8(this.offset + i));
    }
    this.offset += length;
    return result;
  }
}
