/*
Goal: JavaScript for BetterQuesting Tracker
Requirements:
1. Wait for user to upload two files:
   - DefaultQuests.json (quest definitions)
   - PlayerData.json (player completion)
2. Parse the JSON files
3. Merge quest definitions with player completion
   - If quest ID is in player.completedQuestIds, mark as completed
   - Else mark as incomplete
4. Render the sidebar with chapters
5. Render quest cards in main panel
   - Display quest icon (map quest.icon.id to PNG in /icons)
   - Display quest name, reward, and completion status
   - Completed quests in green, incomplete in gray
6. Optional: Add overall progress bar
7. Handle errors if files are invalid
*/

// Hard-coded chapter order for left sidebar (12 chapters). Add PNGs to icons/chapters/ later.
var ORDERED_CHAPTER_NAMES = [
  'Genesis', 'The Beginning', 'Simulating Resources', 'Matter-Energy', 'Early Game',
  'Into The Microverse', 'Mid Game', 'Late Game', 'Fusion & Research', 'End Game',
  'Processing Lines', 'Progression'
];
// Match chapter names that differ slightly in the pack (e.g. "Simulation Resources" -> same as "Simulating Resources")
var CHAPTER_NAME_ALIASES = { 'simulation resources': 'simulating resources', 'into the microverse': 'into the microverse' };

// Global state
let questData = null;
let playerData = null;
let mergedQuests = [];
let chapters = [];
let currentChapter = null;

// ========== QUEST ICONS (GTNH-style: icons/ + optional internet fallback) ==========
// Primary: icons/<mod>_<item>.png (e.g. icons/appliedenergistics2_charger.png), same as gregtechnewhorizons / appGTNH.js
// Optional: set ICON_CDN_BASE to a URL that serves PNGs as {base}{iconId}.png (e.g. GitHub raw or your CDN)
const ICON_CDN_BASE = ''; // e.g. 'https://raw.githubusercontent.com/.../icons/' to pull missing icons from internet
// Legacy atlas (optional): nomi/quests_icons.json + nomi/quests_icons/QuestIcon/<AtlasName>.gtbl
const NOMI_ICON_MAPPING_URL = 'nomi/quests_icons.json';
const NOMI_ICON_ATLAS_BASE_URL = 'nomi/quests_icons/QuestIcon';

// ========== Pre-built icon map (nomi-icon-map.json) ==========
// Maps icon IDs ("modid:itemname") → relative path in icons_nomi/
let nomiIconMap = null; // { "modid:itemname": "icons_nomi/..." }
let nomiIconMapPromise = null;

function initNomiIconMap() {
  if (!nomiIconMapPromise) {
    nomiIconMapPromise = fetch('nomi-icon-map.json')
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(data => {
        nomiIconMap = data.iconMap || data.icons || {};
        console.log('[NOMI] Loaded icon map with', Object.keys(nomiIconMap).length, 'entries from', data.source || 'unknown source');
        console.log('[NOMI] Icon stats: matched', data.matched || 0, '/', data.totalUniqueIcons || 0, 'icons');
        return nomiIconMap;
      })
      .catch(err => {
        console.warn('[NOMI] Icon map not available:', err.message);
        nomiIconMap = {};
        return nomiIconMap;
      });
  }
  return nomiIconMapPromise;
}

// Start loading immediately
initNomiIconMap();

let nomiIconMapping = null; // { questId(string) : atlasName(string) }
let nomiLoadedAtlases = {}; // { atlasName : { [questId]: base64Webp } }
let nomiAtlasLoadQueue = {}; // { atlasName : 'loading' | Array<{img, questId}> }
let nomiIconMappingPromise = null;

function initNomiIconSystem() {
  if (!nomiIconMappingPromise) {
    nomiIconMappingPromise = loadNomiIconMapping();
  }
  return nomiIconMappingPromise;
}

async function loadNomiIconMapping() {
  try {
    const response = await fetch(NOMI_ICON_MAPPING_URL);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const mapping = await response.json();
    const out = {};

    // mapping format (from MakeFileConfig.js):
    // { "QuestIcon/Genesis": ["0","1",...], ... }
    for (const [atlasPath, questIds] of Object.entries(mapping || {})) {
      const parts = String(atlasPath).split('/');
      const atlasName = parts.length >= 2 ? parts[1] : null;
      if (!atlasName || !Array.isArray(questIds)) continue;
      questIds.forEach((qid) => { out[String(qid)] = atlasName; });
    }

    nomiIconMapping = out;
    console.log('[NOMI] Loaded icon mapping for', Object.keys(nomiIconMapping).length, 'quests');
    return nomiIconMapping;
  } catch (error) {
    // Non-fatal: if not present, we fall back to icons/<item>.png
    console.warn('[NOMI] Icon mapping not available:', error.message || error);
    nomiIconMapping = null;
    return null;
  }
}

async function loadNomiIconAtlas(atlasName) {
  if (!atlasName) return null;
  if (nomiLoadedAtlases[atlasName]) return nomiLoadedAtlases[atlasName];

  if (nomiAtlasLoadQueue[atlasName] === 'loading') {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (nomiLoadedAtlases[atlasName] || nomiAtlasLoadQueue[atlasName] == null) {
          clearInterval(interval);
          resolve(nomiLoadedAtlases[atlasName] || null);
        }
      }, 100);
    });
  }

  nomiAtlasLoadQueue[atlasName] = 'loading';

  async function tryLoadGtblOrJson(ext) {
    const url = `${NOMI_ICON_ATLAS_BASE_URL}/${atlasName}.${ext}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (ext === 'json') return await r.json();
    const arrayBuffer = await r.arrayBuffer();
    const decompressed = pako.ungzip(new Uint8Array(arrayBuffer), { to: 'string' });
    return JSON.parse(decompressed);
  }

  try {
    let iconData = null;
    try {
      iconData = await tryLoadGtblOrJson('gtbl');
    } catch (eGtbl) {
      iconData = await tryLoadGtblOrJson('json');
    }

    if (!iconData || typeof iconData !== 'object') throw new Error('Invalid atlas data');

    nomiLoadedAtlases[atlasName] = iconData;
    console.log(`[NOMI] Loaded atlas ${atlasName} with ${Object.keys(iconData).length} icons`);

    if (Array.isArray(nomiAtlasLoadQueue[atlasName])) {
      nomiAtlasLoadQueue[atlasName].forEach(({ img, questId }) => {
        const data = iconData[String(questId)];
        if (data) {
          img.src = `data:${b64MimeType(data)};base64,${data}`;
          img.style.display = 'block';
        }
      });
    }
    delete nomiAtlasLoadQueue[atlasName];
    return iconData;
  } catch (error) {
    console.warn(`[NOMI] Failed to load atlas ${atlasName}:`, error.message || error);
    delete nomiAtlasLoadQueue[atlasName];
    return null;
  }
}

/** Detect MIME type from a base64-encoded image string. PNG → image/png, else image/webp. */
function b64MimeType(b64) {
  return b64.startsWith('iVBOR') ? 'image/png' : 'image/webp';
}

async function setNomiQuestIcon(img, questId) {
  if (!img || questId == null) return false;
  await initNomiIconSystem();
  if (!nomiIconMapping) return false;

  const qid = String(questId);
  const atlasName = nomiIconMapping[qid];
  if (!atlasName) return false;

  if (nomiLoadedAtlases[atlasName] && nomiLoadedAtlases[atlasName][qid]) {
    const d0 = nomiLoadedAtlases[atlasName][qid];
    img.src = `data:${b64MimeType(d0)};base64,${d0}`;
    img.style.display = 'block';
    return true;
  }

  // Queue this image, then load the atlas
  if (!nomiAtlasLoadQueue[atlasName]) nomiAtlasLoadQueue[atlasName] = [];
  if (Array.isArray(nomiAtlasLoadQueue[atlasName])) {
    nomiAtlasLoadQueue[atlasName].push({ img, questId: qid });
  }
  const atlas = await loadNomiIconAtlas(atlasName);
  if (atlas && atlas[qid]) {
    const d1 = atlas[qid];
    img.src = `data:${b64MimeType(d1)};base64,${d1}`;
    img.style.display = 'block';
    return true;
  }
  return false;
}

// Lang file entries (key -> value). Filled automatically from Nomifactory CEU Quests.txt in same folder.
window.NOMI_LANG = {};

// DOM elements
const playerFileInput = document.getElementById('playerFile');
const chapterNav = document.getElementById('chapterNav');
const questList = document.getElementById('questList');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

// Sidebar elements
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarClose = document.getElementById('sidebarClose');
const sidebar = document.getElementById('chapterList');
const currentChapterTitle = document.getElementById('currentChapterTitle');
const currentChapterIcon = document.getElementById('currentChapterIcon');
const questStats = document.getElementById('questStats');
const completedCount = document.getElementById('completedCount');
const totalCount = document.getElementById('totalCount');
const questContent = document.querySelector('.quest-content');

// Leaderboard elements
const leaderboardPanel = document.getElementById('leaderboardPanel');
const leaderboardBody = document.getElementById('leaderboardBody');
const leaderboardStatus = document.getElementById('leaderboardStatus');
const leaderboardSubmitBtn = document.getElementById('leaderboardSubmitBtn');

// Leaderboard configuration (fill in URL/key to enable backend)
const LEADERBOARD_ENABLED = true;
const LEADERBOARD_PACK_ID = 'nomifactory';
// Your Supabase project URL
const LEADERBOARD_SUPABASE_URL = 'https://fyiiopwyjzedunkettqo.supabase.co';
// TODO: paste your Supabase anon public key here (from Settings → API → anon public)
const LEADERBOARD_SUPABASE_KEY = 'sb_publishable_vThV3j_ZQV0pF6qn8p4e7w_bXaVhdE8';
const LEADERBOARD_MAX_ROWS = 50;
// if true, submission uses the `upsert_leaderboard_entry` RPC which accumulates
// completed_count; set to false to do the simpler table upsert/replace.
const LEADERBOARD_USE_RPC = false;

// Cached overall progress for leaderboard submissions
let _leaderboardProgress = { total: 0, completed: 0, percent: 0 };

// Event listeners for file inputs
playerFileInput.addEventListener('change', handlePlayerFile);
initQuestModal();

// Sidebar toggle functionality
function toggleSidebar() {
  sidebar.classList.toggle('hidden');
  sidebarToggle.classList.toggle('active');
}

function hideSidebar() {
  sidebar.classList.add('hidden');
  sidebarToggle.classList.remove('active');
}

// Add event listeners for sidebar toggle
if (sidebarToggle) {
  sidebarToggle.addEventListener('click', (e) => {
    e.preventDefault();
    toggleSidebar();
  });
}

if (sidebarClose) {
  sidebarClose.addEventListener('click', (e) => {
    e.preventDefault();
    hideSidebar();
  });
}

// Try to load Nomifactory CEU Quests.txt from the same folder (e.g. GitHub Pages). No upload needed if file is in repo.
function loadLangFileFromUrl() {
  var url = 'Nomifactory CEU Quests.txt';
  fetch(url).then(function (r) { return r.ok ? r.text() : Promise.reject(new Error(r.status)); }).then(function (text) {
    parseLangText(text);
    // If quest data is already loaded, re-process everything with the new lang keys
    if (window.questData) {
       tryMergeAndRender();
    }
  }).catch(function () { /* file not found or not in repo – user can still upload */ });
}

function parseLangText(text) {
  window.NOMI_LANG = {};
  if (!text) return;
  text = (text + '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text.split('\n').forEach(function (line) {
    line = line.trim();
    if (!line || line.charAt(0) === '#') return;
    var eq = line.indexOf('=');
    if (eq === -1) return;
    var key = line.slice(0, eq).trim();
    var val = line.slice(eq + 1).trim();
    window.NOMI_LANG[key] = val;
  });
}

// Quest names load automatically from Nomifactory CEU Quests.txt in the same folder (no upload).
loadLangFileFromUrl();

// Try to initialize icon mapping early (non-blocking).
initNomiIconSystem();

// Simple visitor counter for site statistics
function initVisitorCounter() {
  const storageKey = 'questTracker_visitCount';
  let visitCount = localStorage.getItem(storageKey);
  visitCount = visitCount ? parseInt(visitCount) + 1 : 1;
  localStorage.setItem(storageKey, visitCount.toString());
  
  console.log('🌟 Site visits:', visitCount);
}

// Initialize visitor counter immediately
initVisitorCounter();

// DefaultQuests is bundled in the repo — fetch it automatically.
function loadQuestFileFromUrl() {
  fetch('defaultquests/DefaultQuestsNomifactory.json')
    .then(function(r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
    .then(function(data) {
      questData = data;
      window._debugRootKeys = data && typeof data === 'object' ? Object.keys(data) : [];
      console.log('Quest data loaded from repo:', questData);
      tryMergeAndRender();
    })
    .catch(function(err) {
      showError('Failed to load DefaultQuests.json: ' + err.message);
    });
}
loadQuestFileFromUrl();

// Apply NOMI_LANG titles/descriptions to merged quests (nomifactory.quest.normal.db.{id}.title / .desc)
function applyLangToMergedQuests() {
  if (!window.NOMI_LANG || !mergedQuests.length) return;
  mergedQuests.forEach(function (q) {
    var keyBase = 'nomifactory.quest.normal.db.' + q.id + '.';
    q.langTitle = window.NOMI_LANG[keyBase + 'title'];
    q.langDesc = window.NOMI_LANG[keyBase + 'desc'];
  });
}

// Re-render sidebar and current chapter without reloading data
function refreshDisplay() {
  if (!chapters.length) return;
  renderChapters();
  if (currentChapter) selectChapter(currentChapter);
}

// Minecraft/Essentials § color codes to HTML. §0-§f, §r reset, §l bold, §o italic, §n underline, §m strikethrough. %n%n / %n -> newline.
function mcColorToHtml(str) {
  if (!str || typeof str !== 'string') return '';
  var s = str.replace(/%n%n/g, '\n\n').replace(/%n/g, '\n');
  var out = '';
  var i = 0;
  var openTags = [];
  var mcColors = { '0': '#000000', '1': '#0000aa', '2': '#00aa00', '3': '#00aaaa', '4': '#aa0000', '5': '#aa00aa', '6': '#ffaa00', '7': '#aaaaaa', '8': '#555555', '9': '#5555ff', 'a': '#55ff55', 'b': '#55ffff', 'c': '#ff5555', 'd': '#ff55ff', 'e': '#ffff55', 'f': '#ffffff' };
  while (i < s.length) {
    if (s.charAt(i) === '§' && i + 1 < s.length) {
      var code = s.charAt(i + 1).toLowerCase();
      i += 2;
      if (code === 'r') {
        while (openTags.length) { out += '</span>'; openTags.pop(); }
        continue;
      }
      if (code === 'l') { out += '<b>'; openTags.push('b'); continue; }
      if (code === 'o') { out += '<i>'; openTags.push('i'); continue; }
      if (code === 'n') { out += '<u>'; openTags.push('u'); continue; }
      if (code === 'm') { out += '<s>'; openTags.push('s'); continue; }
      if (mcColors[code]) {
        while (openTags.length) { out += '</span>'; openTags.pop(); }
        out += '<span class="mc-color" style="color:' + mcColors[code] + '">';
        openTags.push('span');
      }
      continue;
    }
    if (s.charAt(i) === '<') { out += '&lt;'; i++; continue; }
    if (s.charAt(i) === '>') { out += '&gt;'; i++; continue; }
    if (s.charAt(i) === '&') { out += '&amp;'; i++; continue; }
    if (s.charAt(i) === '\n') { out += '<br>'; i++; continue; }
    out += s.charAt(i);
    i++;
  }
  while (openTags.length) {
    var t = openTags.pop();
    out += t === 'b' ? '</b>' : t === 'i' ? '</i>' : t === 'u' ? '</u>' : t === 's' ? '</s>' : '</span>';
  }
  return out;
}

// Handle DefaultQuests.json file upload
function handleQuestFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      questData = JSON.parse(e.target.result);
      window._debugRootKeys = questData && typeof questData === 'object' ? Object.keys(questData) : [];
      console.log('Quest data loaded:', questData);
      tryMergeAndRender();
    } catch (error) {
      showError('Error parsing DefaultQuests.json: ' + error.message);
    }
  };
  reader.onerror = function() {
    showError('Error reading DefaultQuests.json file');
  };
  reader.readAsText(file);
}

// ========== PLAYER NAME RESOLUTION ==========
// Extract UUID from filename and look up Minecraft username
function tryResolvePlayerName(filename) {
  if (!filename) return false;
  // Match UUID pattern: 8-4-4-4-12 hex chars (with or without dashes)
  var uuidRegex = /([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})/i;
  var match = filename.match(uuidRegex);
  if (!match) return false;
  var uuid = match[1].replace(/-/g, ''); // strip dashes for API call

  // Show UUID immediately while we look up the name
  showPlayerName(match[1], null);

  // Try CORS-friendly API to resolve UUID to username
  fetch('https://api.ashcon.app/mojang/v2/user/' + uuid)
    .then(function(r) { return r.ok ? r.json() : Promise.reject(new Error(r.status)); })
    .then(function(data) {
      if (data && data.username) {
        showPlayerName(data.username, uuid);
      }
    })
    .catch(function() {
      // API failed — UUID is already shown as fallback
      console.log('Could not resolve username for UUID:', uuid);
    });
    
  return true;
}

// Try to extract UUID from the parsed NBT/JSON data if filename didn't have it
function tryExtractUuidFromData(data) {
  if (!data || typeof data !== 'object') return;
  
  // Helper to recursively search for a UUID string
  function findUuid(obj, depth) {
    if (depth > 10 || !obj || typeof obj !== 'object') return null;
    
    // Check keys and values at this level
    for (const key in obj) {
      const val = obj[key];
      
      // Sometimes the key itself is the UUID (e.g., in PartyProgress or UserProgress)
      if (typeof key === 'string' && /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(key)) {
        return key;
      }
      
      // Sometimes there's a 'uuid' field
      if ((key === 'uuid' || key === 'uuid:8') && typeof val === 'string' && val.length >= 32) {
        return val;
      }
      
      // Recurse
      if (typeof val === 'object') {
        const found = findUuid(val, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
  
  const foundUuid = findUuid(data, 0);
  if (foundUuid) {
    console.log('Found UUID inside player data:', foundUuid);
    // We found a UUID inside the file! Let's resolve it.
    tryResolvePlayerName(foundUuid);
  }
}

function showPlayerName(name, uuid) {
  var display = document.getElementById('playerNameDisplay');
  var textEl = document.getElementById('playerNameText');
  var headImg = document.getElementById('playerHead');
  if (!display || !textEl) return;

  textEl.textContent = name;
  display.style.display = 'flex';

  // Show player head using Crafatar (CORS-friendly, works with UUID)
  if (headImg && uuid) {
    var cleanUuid = uuid.replace(/-/g, '');
    headImg.src = 'https://crafatar.com/avatars/' + cleanUuid + '?size=32&overlay';
    headImg.alt = name;
    headImg.style.display = 'block';
  }

  // Store for sharing / leaderboard
  window._playerDisplayName = name;
  if (uuid) {
    window._playerUuid = uuid;
  }
}

// Handle PlayerData.dat file upload (NBT format)
function handlePlayerFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Try to extract UUID from filename (e.g. "60586fce-7db5-486f-b7fc-20965f503990.json")
  const nameResolvedFromFilename = tryResolvePlayerName(file.name);

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const arrayBuffer = e.target.result;
      
      // Try to parse as JSON first (in case it's actually JSON)
      try {
        const text = new TextDecoder().decode(arrayBuffer);
        if (text.trim().startsWith('{')) {
          playerData = JSON.parse(text);
          console.log('Player data loaded as JSON:', playerData);
          
          // If filename didn't have UUID, try to find it in the JSON data
          if (!nameResolvedFromFilename && !window._playerDisplayName) {
            tryExtractUuidFromData(playerData);
          }
          
          tryMergeAndRender();
          return;
        }
      } catch (jsonError) {
        // Not JSON, continue with NBT parsing
      }
      
      // Parse as NBT (binary format)
      playerData = await parseNBT(arrayBuffer);
      console.log('Player data loaded from NBT:', playerData);
      
      // If filename didn't have UUID, try to find it in the NBT data
      if (!nameResolvedFromFilename && !window._playerDisplayName) {
        tryExtractUuidFromData(playerData);
      }
      
      tryMergeAndRender();
    } catch (error) {
      showError('Error parsing PlayerData.dat: ' + error.message);
      console.error(error);
    }
  };
  reader.onerror = function() {
    showError('Error reading PlayerData.dat file');
  };
  reader.readAsArrayBuffer(file);
}

// NBT Parser for .dat files
async function parseNBT(arrayBuffer) {
  let data = new Uint8Array(arrayBuffer);
  
  // Check if gzip compressed (starts with 0x1f 0x8b)
  if (data[0] === 0x1f && data[1] === 0x8b) {
    try {
      data = pako.inflate(data);
    } catch (e) {
      throw new Error('Failed to decompress gzip data: ' + e.message);
    }
  }
  
  // Parse NBT structure
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  
  function readByte() {
    return view.getInt8(offset++);
  }
  
  function readShort() {
    const val = view.getInt16(offset, false);
    offset += 2;
    return val;
  }
  
  function readInt() {
    const val = view.getInt32(offset, false);
    offset += 4;
    return val;
  }
  
  function readLong() {
    // JavaScript doesn't handle 64-bit ints well, read as two 32-bit
    const high = view.getInt32(offset, false);
    const low = view.getUint32(offset + 4, false);
    offset += 8;
    return high * 0x100000000 + low;
  }
  
  function readFloat() {
    const val = view.getFloat32(offset, false);
    offset += 4;
    return val;
  }
  
  function readDouble() {
    const val = view.getFloat64(offset, false);
    offset += 8;
    return val;
  }
  
  function readString() {
    const length = readShort();
    const bytes = data.slice(offset, offset + length);
    offset += length;
    return new TextDecoder('utf-8').decode(bytes);
  }
  
  function readByteArray() {
    const length = readInt();
    const arr = Array.from(data.slice(offset, offset + length));
    offset += length;
    return arr;
  }
  
  function readIntArray() {
    const length = readInt();
    const arr = [];
    for (let i = 0; i < length; i++) {
      arr.push(readInt());
    }
    return arr;
  }
  
  function readLongArray() {
    const length = readInt();
    const arr = [];
    for (let i = 0; i < length; i++) {
      arr.push(readLong());
    }
    return arr;
  }
  
  function readTag(tagType) {
    switch (tagType) {
      case 0: return null; // TAG_End
      case 1: return readByte(); // TAG_Byte
      case 2: return readShort(); // TAG_Short
      case 3: return readInt(); // TAG_Int
      case 4: return readLong(); // TAG_Long
      case 5: return readFloat(); // TAG_Float
      case 6: return readDouble(); // TAG_Double
      case 7: return readByteArray(); // TAG_Byte_Array
      case 8: return readString(); // TAG_String
      case 9: { // TAG_List
        const listType = readByte();
        const length = readInt();
        const list = [];
        for (let i = 0; i < length; i++) {
          list.push(readTag(listType));
        }
        return list;
      }
      case 10: { // TAG_Compound
        const compound = {};
        while (true) {
          const type = readByte();
          if (type === 0) break; // TAG_End
          const name = readString();
          compound[name] = readTag(type);
        }
        return compound;
      }
      case 11: return readIntArray(); // TAG_Int_Array
      case 12: return readLongArray(); // TAG_Long_ARRAY
      default:
        throw new Error(`Unknown NBT tag type: ${tagType}`);
    }
  }
  
  // Read root compound tag
  const rootType = readByte();
  if (rootType !== 10) {
    throw new Error('NBT file must start with a compound tag');
  }
  const rootName = readString();
  const result = readTag(10);
  
  console.log('NBT root name:', rootName);
  return result;
}

// Try to merge data and render when quest data is loaded (player file optional — no file = all incomplete)
function tryMergeAndRender() {
  if (!questData) {
    return; // Wait for quest data (from URL or upload)
  }

  try {
    // Unwrap nested root (e.g. { "betterquesting": { "questDatabase:9": ... } } or single-key wrapper)
    var _effectiveQuestRoot = questData;
    if (questData && typeof questData === 'object') {
      if (questData.betterquesting && typeof questData.betterquesting === 'object') _effectiveQuestRoot = questData.betterquesting;
      else if (questData.data && typeof questData.data === 'object') _effectiveQuestRoot = questData.data;
      else { var _k = Object.keys(questData); if (_k.length === 1 && typeof questData[_k[0]] === 'object') _effectiveQuestRoot = questData[_k[0]]; }
    }
    window._effectiveRootKeys = _effectiveQuestRoot && typeof _effectiveQuestRoot === 'object' ? Object.keys(_effectiveQuestRoot) : [];

    mergeQuestData(_effectiveQuestRoot);
    applyLangToMergedQuests();
    extractChapters(_effectiveQuestRoot);
    renderChapters();
    updateProgressBar();

    // Show first chapter by default or all quests
    if (chapters.length > 0) {
      selectChapter(chapters[0].id);
    } else {
      renderQuests(mergedQuests);
    }
  } catch (error) {
    showError('Error processing quest data: ' + error.message);
    console.error(error);
  }
}

// Merge quest definitions with player completion data
function mergeQuestData(root) {
  mergedQuests = [];
  if (!root) root = questData;

  // Get completed quest IDs from player data
  // BetterQuesting NBT/JSON format can vary, so we check multiple possible structures
  let completedIds = new Set();

  // If loaded from a shared link, use the pre-decoded IDs directly
  if (window._sharedCompletedIds) {
    window._sharedCompletedIds.forEach(id => completedIds.add(String(id)));
  } else if (playerData) {
  // Parse completion from player data only when a file was loaded
  // Helper: get a property regardless of NBT type suffix (e.g. "completed" matches "completed:1")
  function nbtGet(obj, baseName) {
    if (!obj || typeof obj !== 'object') return undefined;
    if (obj[baseName] !== undefined) return obj[baseName];
    // Try with common NBT type suffixes: :1 (byte), :3 (int), :8 (string), :9 (list), :10 (compound)
    var suffixes = [':1', ':2', ':3', ':4', ':5', ':6', ':7', ':8', ':9', ':10', ':11', ':12'];
    for (var s = 0; s < suffixes.length; s++) {
      var key = baseName + suffixes[s];
      if (obj[key] !== undefined) return obj[key];
    }
    return undefined;
  }

  // Helper: check if a value represents "true/completed" — handles byte (1), boolean, string, OR non-empty object/array
  function isTruthy(val) {
    if (val === 1 || val === true || val === '1') return true;
    if (Array.isArray(val) && val.length > 0) return true;
    if (val && typeof val === 'object' && Object.keys(val).length > 0) return true;
    return false;
  }

  // Helper to recursively find completed quests in player data (many BQ/export formats)
  function findCompletedQuests(obj, path, depth) {
    if (!obj || typeof obj !== 'object') return;
    if (depth == null) depth = 0;
    if (depth > 20) return;
    var next = depth + 1;

    const addId = (id) => completedIds.add(String(id));

    // --- completedQuests / completedQuestIds ---
    var cq = nbtGet(obj, 'completedQuests');
    if (cq) {
      if (Array.isArray(cq)) cq.forEach(id => addId(id));
      else if (typeof cq === 'object') Object.keys(cq).forEach(id => addId(id));
    }
    var cqi = nbtGet(obj, 'completedQuestIds');
    if (cqi && Array.isArray(cqi)) {
      cqi.forEach(id => addId(id));
    }

    // --- questProgress (BetterQuesting main progress structure) ---
    // Format: "questProgress:9": { "0:10": { "completed:9": {non-empty=done}, "questID:3": N }, ... }
    var qp = nbtGet(obj, 'questProgress');
    if (qp && typeof qp === 'object') {
      var qpEntries = Array.isArray(qp) ? qp : Object.values(qp);
      qpEntries.forEach(function (entry) {
        if (!entry || typeof entry !== 'object') return;
        var e = entry.value && typeof entry.value === 'object' ? entry.value : entry;

        // Get the quest ID — stored as questID:3 inside the entry, NOT the object key
        var qid = nbtGet(e, 'questID');
        if (qid === undefined || qid === null) {
          qid = nbtGet(e, 'id');
        }
        if (qid === undefined || qid === null) {
          qid = entry.key; // fallback for array-style NBT
        }
        if (qid === undefined || qid === null) return;

        // Check completion: "completed:9" is an object/list — non-empty means completed
        var completedVal = nbtGet(e, 'completed');
        if (isTruthy(completedVal)) {
          addId(qid);
          return;
        }

        // Also check claimed at this level
        var claimedVal = nbtGet(e, 'claimed');
        if (isTruthy(claimedVal)) {
          addId(qid);
          return;
        }

        // Fallback: check if all tasks have completeUsers (tasks done = quest done)
        var tasks = nbtGet(e, 'tasks');
        if (tasks && typeof tasks === 'object') {
          var taskEntries = Array.isArray(tasks) ? tasks : Object.values(tasks);
          var allTasksComplete = taskEntries.length > 0;
          taskEntries.forEach(function (task) {
            if (!task || typeof task !== 'object') { allTasksComplete = false; return; }
            var t = task.value && typeof task.value === 'object' ? task.value : task;
            var cu = nbtGet(t, 'completeUsers');
            if (!cu || (typeof cu === 'object' && Object.keys(cu).length === 0)) {
              allTasksComplete = false;
            }
          });
          if (allTasksComplete) addId(qid);
        }
      });
    }

    // --- quests (direct quest map) ---
    var qs = nbtGet(obj, 'quests');
    if (qs && typeof qs === 'object' && qs !== qp) {
      Object.entries(qs).forEach(function (kv) {
        var q = kv[1];
        if (!q || typeof q !== 'object') return;
        var qq = q.value && typeof q.value === 'object' ? q.value : q;
        var isComplete = nbtGet(qq, 'completed');
        var isClaimed = nbtGet(qq, 'claimed');
        if (isTruthy(isComplete) || isTruthy(isClaimed)) {
          var realId = nbtGet(qq, 'questID') || kv[0];
          addId(realId);
        }
      });
    }

    // --- UserProgress / PartyProgress ---
    var progress = nbtGet(obj, 'UserProgress') || nbtGet(obj, 'PartyProgress');
    if (progress && typeof progress === 'object') {
      Object.entries(progress).forEach(function (kv) {
        var userData = kv[1];
        if (!userData || typeof userData !== 'object') return;
        var uQuests = nbtGet(userData, 'quests');
        if (uQuests && typeof uQuests === 'object') {
          Object.entries(uQuests).forEach(function (qkv) {
            var st = qkv[1];
            if (!st || typeof st !== 'object') return;
            var ss = st.value && typeof st.value === 'object' ? st.value : st;
            if (isTruthy(nbtGet(ss, 'completed')) || isTruthy(nbtGet(ss, 'claimed'))) addId(qkv[0]);
          });
        }
      });
    }

    // Recurse into ALL child keys to find nested progress structures
    // BUT skip keys we already processed and skip deep task/userProgress internals
    if (typeof obj === 'object' && !Array.isArray(obj)) {
      Object.keys(obj).forEach(function (key) {
        var baseKey = key.split(':')[0];
        // Skip keys already handled above
        if (['completedQuests', 'completedQuestIds', 'questProgress', 'UserProgress', 'PartyProgress', 'quests'].indexOf(baseKey) !== -1) return;
        // Skip internal quest progress fields that aren't progress containers
        if (['tasks', 'userProgress', 'completeUsers', 'data', 'completed', 'claimed', 'timestamp', 'uuid', 'taskID', 'index', 'questID'].indexOf(baseKey) !== -1) return;
        if (obj[key] && typeof obj[key] === 'object') {
          findCompletedQuests(obj[key], (path ? path + '.' : '') + key, next);
        }
      });
    }
  }

  findCompletedQuests(playerData, '', 0);
  } // end else if (playerData)
  console.log('Found completed quest IDs:', completedIds.size, Array.from(completedIds).slice(0, 20));
  
  if (playerData) {
  window._playerDataDebug = {
    completedCount: completedIds.size,
    sampleIds: Array.from(completedIds).slice(0, 20),
    playerDataKeys: playerData ? Object.keys(playerData) : [],
    playerDataStructure: (function summarize(o, d) {
      if (!o || typeof o !== 'object' || d > 3) return typeof o;
      if (Array.isArray(o)) return 'Array(' + o.length + ')' + (o.length > 0 ? ' of ' + summarize(o[0], d + 1) : '');
      var keys = Object.keys(o);
      var summary = {};
      keys.slice(0, 20).forEach(function (k) { summary[k] = summarize(o[k], d + 1); });
      if (keys.length > 20) summary['...'] = '(' + (keys.length - 20) + ' more keys)';
      return summary;
    })(playerData, 0)
  };
  console.log('Player data debug:', window._playerDataDebug);
  }

  // Resolve quest database: try known keys first, then discover from root
  let questDB = root.questDatabase || root.questDB || root['questDatabase:9'] || root.defaultQuests || root.quests;
  if ((!questDB || (typeof questDB === 'object' && Object.keys(questDB).length === 0)) && root && typeof root === 'object') {
    // Fallback: pick root key whose value looks like a quest map (object with many entries, entries have properties/name-like fields)
    var rootKeys = Object.keys(root);
    var best = null;
    var bestSize = 0;
    for (var i = 0; i < rootKeys.length; i++) {
      var val = root[rootKeys[i]];
      if (!val || typeof val !== 'object') continue;
      var size = Array.isArray(val) ? val.length : Object.keys(val).length;
      if (size > bestSize && size > 0) {
        var sample = Array.isArray(val) ? val[0] : val[Object.keys(val)[0]];
        if (sample && typeof sample === 'object') {
          var inner = sample.value && typeof sample.value === 'object' ? sample.value : sample;
          if (inner.properties != null || inner['properties:10'] != null || inner.name != null || inner.questID != null) {
            best = val;
            bestSize = size;
          }
        }
      }
    }
    if (best) questDB = best;
  }
  if (!questDB) questDB = root;

  // Handle different BetterQuesting formats (including NBT-style list of { key, value })
  // Use quest's own ID when present so chapter references (Early Game, Late Game, etc.) match
  if (Array.isArray(questDB)) {
    questDB.forEach((entry, index) => {
      var quest = entry && entry.value && typeof entry.value === 'object' ? entry.value : entry;
      var keyId = (entry && 'key' in entry) ? entry.key : index;
      var id = quest.questID ?? quest.id ?? quest['questID:3'] ?? keyId;
      processQuest({ ...quest, questID: id }, completedIds);
    });
  } else if (typeof questDB === 'object') {
    Object.entries(questDB).forEach(([key, quest]) => {
      var q = quest && quest.value && typeof quest.value === 'object' ? quest.value : quest;
      var id = q.questID ?? q.id ?? q['questID:3'] ?? key;
      processQuest({ ...q, questID: id }, completedIds);
    });
  }

  console.log('Merged quests:', mergedQuests.length);
}

// Process individual quest entry
function processQuest(quest, completedIds) {
  const rawId = quest.questID !== undefined ? quest.questID : (quest.id !== undefined ? quest.id : quest['questID:3']);
  const questId = rawId !== undefined && rawId !== null ? String(rawId) : '';
  if (questId === '' || questId === 'undefined') return; // skip non-quest entries (e.g. from wrong root key)
  const properties = quest.properties || quest['properties:10'] || {};
  const betterQuestingProps = properties.betterquesting || properties['betterquesting:10'] || properties;
  var rawName = betterQuestingProps.name || betterQuestingProps['name:8'] || quest.name || '';
  var displayName = rawName && rawName.indexOf('.') !== -1 ? translationKeyToDisplayName(rawName) : (rawName || `Quest ${questId}`);
  var rawDesc = betterQuestingProps.desc || betterQuestingProps['desc:8'] || quest.description || '';
  var displayDesc = (typeof rawDesc === 'string' && rawDesc.indexOf('.') !== -1 && rawDesc.indexOf(' ') === -1) ? translationKeyToDisplayName(rawDesc) : (rawDesc || '');

  // Filter out quests that have no name and no description
  if ((!rawName || rawName.trim() === '') && (!rawDesc || rawDesc.trim() === '')) {
    return;
  }

  const mergedQuest = {
    id: questId,
    name: displayName,
    description: displayDesc,
    icon: extractIcon(quest),
    rewards: extractRewards(quest),
    chapterId: quest.chapterId || quest.lineId || null,
    // Raw BetterQuesting prerequisites for dependency graphs (e.g. Genesis chapter)
    preRequisites: extractPreRequisites(quest),
    // Exact coordinates for graph layout
    x: quest.x ?? quest['x:3'] ?? 0,
    y: quest.y ?? quest['y:3'] ?? 0,
    sizeX: quest.sizeX ?? quest['sizeX:3'] ?? 24,
    sizeY: quest.sizeY ?? quest['sizeY:3'] ?? 24,
    completed: completedIds.has(questId)
  };

  mergedQuests.push(mergedQuest);
}

// Extract prerequisite quest IDs from a BetterQuesting quest entry
function extractPreRequisites(quest) {
  if (!quest || typeof quest !== 'object') return [];
  var raw = quest.preRequisites || quest['preRequisites:11'] || quest['preRequisites:9'] || [];
  var out = [];

  if (Array.isArray(raw)) {
    raw.forEach(function (id) {
      if (id === undefined || id === null) return;
      out.push(String(id));
    });
  } else if (typeof raw === 'object') {
    Object.values(raw).forEach(function (id) {
      if (id === undefined || id === null) return;
      if (typeof id === 'object' && id.value !== undefined) {
        out.push(String(id.value));
      } else {
        out.push(String(id));
      }
    });
  }

  return out;
}

// Extract icon information from quest
function extractIcon(quest) {
  const icon = quest.icon || quest['icon:10'] || {};
  const properties = quest.properties || quest['properties:10'] || {};
  const bqProps = properties.betterquesting || properties['betterquesting:10'] || {};
  const questIcon = bqProps.icon || bqProps['icon:10'] || icon;
  
  const itemId = questIcon.id || questIcon['id:8'] || 'minecraft:book';
  const damage = questIcon.Damage || questIcon['Damage:2'] || 0;
  const count = questIcon.Count || questIcon['Count:3'] || 1;
  
  // Special handling for fluids (forge:bucketfilled with NBT FluidName)
  if (itemId === 'forge:bucketfilled') {
    const tag = questIcon.tag || questIcon['tag:10'] || {};
    const fluidName = tag.FluidName || tag['FluidName:8'];
    if (fluidName) {
      // Return special fluid icon ID format
      return {
        id: `fluid:${fluidName}`,
        damage: 0,
        count: count,
        isFluid: true,
        fluidName: fluidName
      };
    }
  }
  
  return {
    id: itemId,
    damage: damage,
    count: count
  };
}

// Extract rewards from quest
function extractRewards(quest) {
  const rewards = quest.rewards || quest['rewards:9'] || [];
  const rewardList = [];

  const processRewardEntry = (reward) => {
    if (reward.rewardID === 'bq_standard:item' || reward['rewardID:8'] === 'bq_standard:item') {
      const raw = reward.rewards || reward['rewards:9'] || [];
      const items = Array.isArray(raw) ? raw : (typeof raw === 'object' ? Object.values(raw) : []);
      items.forEach(item => {
        const itemId = item?.id || item?.['id:8'] || 'unknown';
        const count = item?.Count ?? item?.['Count:3'] ?? 1;
        rewardList.push(`${count}x ${formatItemName(itemId)}`);
      });
    } else if (reward.rewardID === 'bq_standard:xp' || reward['rewardID:8'] === 'bq_standard:xp') {
      const xp = reward.amount || reward['amount:3'] || 0;
      if (xp > 0) rewardList.push(`${xp} XP`);
    }
  };

  if (Array.isArray(rewards)) {
    rewards.forEach(processRewardEntry);
  } else if (typeof rewards === 'object') {
    Object.values(rewards).forEach(processRewardEntry);
  }

  return rewardList.length > 0 ? rewardList.join(', ') : 'No rewards';
}

// Format item name for display
function formatItemName(itemId) {
  // Remove mod prefix if present
  const name = itemId.includes(':') ? itemId.split(':')[1] : itemId;
  // Convert snake_case to Title Case
  return name.split('_').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

// Convert translation key to readable name (e.g. "nomifactory.quest.normal.vacuum_freezer" -> "Vacuum Freezer")
function translationKeyToDisplayName(key) {
  if (!key || typeof key !== 'string') return key;
  
  // Try to use NOMI_LANG if available to resolve the key directly
  if (window.NOMI_LANG && window.NOMI_LANG[key]) return window.NOMI_LANG[key];

  var trimmed = key.trim();
  if (trimmed.indexOf('.') === -1) return trimmed;
  var segments = trimmed.split('.');
  var last = segments[segments.length - 1];
  // Simple heuristic for fallback name
  return last.split('_').map(function (w) {
    return w.charAt(0).toUpperCase() + (w.slice(1) || '').toLowerCase();
  }).join(' ');
}
// Extract chapters from quest data
function extractChapters(root) {
  chapters = [];
  if (!root) root = questData;
  // BetterQuesting stores chapters in questLines or questLines:9
  const questLines = root.questLines || root['questLines:9'] || {};
  
  function chapterName(line, fallback, id) {
    if (!line) return fallback;
    var props = line.properties || line['properties:10'] || {};
    var bq = props.betterquesting || props['betterquesting:10'] || {};
    var rawName = line.name || line['name:8'] || bq.name || bq['name:8'] || fallback;

    // Try to resolve localized chapter name from NOMI_LANG
    // 1. Try raw name as key
    if (window.NOMI_LANG && window.NOMI_LANG[rawName]) {
      return window.NOMI_LANG[rawName];
    }
    // 2. Try constructing key from ID (nomifactory.quest.normal.line.ID.title)
    if (window.NOMI_LANG && id !== undefined && id !== null) {
      // In Nomi, IDs are numbers but sometimes stored as strings. We need the numeric ID usually.
      // But the key format is usually nomifactory.quest.normal.line.{id}.title
      var possibleKey = 'nomifactory.quest.normal.line.' + id + '.title';
      if (window.NOMI_LANG[possibleKey]) {
        return window.NOMI_LANG[possibleKey];
      }
    }

    return rawName;
  }

  function unwrapLine(entry) {
    return entry && entry.value && typeof entry.value === 'object' ? entry.value : entry;
  }

  if (Array.isArray(questLines)) {
    questLines.forEach((entry, index) => {
      var line = unwrapLine(entry);
      var lineId = String(line.lineID ?? line.id ?? (entry && 'key' in entry ? entry.key : index));
      chapters.push({
        id: lineId,
        name: chapterName(line, `Chapter ${index + 1}`, lineId),
        quests: getQuestsForChapter(line, lineId)
      });
    });
  } else if (typeof questLines === 'object') {
    Object.entries(questLines).forEach(([id, entry]) => {
      var line = unwrapLine(entry); // Ensure we get the value if it's a wrapper
      chapters.push({
        id: id,
        name: chapterName(line, `Chapter ${id}`, id),
        quests: getQuestsForChapter(line, id)
      });
    });
  }

  // Reorder chapters to match ORDERED_CHAPTER_NAMES (case-insensitive; use aliases so "Simulation Resources" matches)
  function normalizeName(n) { return (n || '').trim().toLowerCase(); }
  function chapterNormForMatch(name) {
    var n = normalizeName(name);
    return CHAPTER_NAME_ALIASES[n] || n;
  }
  var ordered = [];
  var used = new Set();
  ORDERED_CHAPTER_NAMES.forEach(function (want) {
    var wantNorm = normalizeName(want);
    for (var i = 0; i < chapters.length; i++) {
      if (used.has(i)) continue;
      var cNorm = chapterNormForMatch(chapters[i].name);
      if (cNorm === wantNorm) {
        ordered.push(chapters[i]);
        used.add(i);
        break;
      }
    }
  });
  // Append any remaining chapters not in the ordered list
  for (var j = 0; j < chapters.length; j++) {
    if (!used.has(j)) ordered.push(chapters[j]);
  }
  chapters = ordered;

  console.log('Chapters extracted:', chapters.length);
}

// Get quest IDs for a chapter/quest line (must match merged quest IDs for filtering)
// externalKey: the chapter ID used in the chapters array (e.g. "0:10" from Object.entries key)
function getQuestsForChapter(line, externalKey) {
  if (!line || typeof line !== 'object') return [];
  const questIds = [];
  const raw = line.quests || line['quests:9'] || {}; // Should be an object or array

  // Use the external key passed from extractChapters so the coord map key
  // matches chapter.id used later in renderGenesisGraph
  var lineID = externalKey != null ? String(externalKey) : String(line.lineID ?? line['lineID:3'] ?? 'unknown');

  if (!window._chapterCoords) window._chapterCoords = {};
  window._chapterCoords[lineID] = {};

  const processEntry = (val) => {
    if (!val || typeof val !== 'object') return;
    
    // val is like { "id:3": 0, "x:3": -536, ... }
    var qId = val.id ?? val['id:3'];
    
    if (qId !== undefined && qId !== null) {
      try {
        var coords = {
          x: val.x ?? val['x:3'] ?? 0,
          y: val.y ?? val['y:3'] ?? 0,
          sizeX: val.sizeX ?? val['sizeX:3'] ?? 24,
          sizeY: val.sizeY ?? val['sizeY:3'] ?? 24
        };
        
        // Store in chapter-specific map
        window._chapterCoords[lineID][String(qId)] = coords;
        
        // Fallback global for backward compat (though we should deprecate this usage)
        if (!window._questCoords) window._questCoords = {};
        window._questCoords[String(qId)] = coords;

        questIds.push(String(qId));
      } catch (e) {
        console.error('Error processing quest coord entry:', val, e);
      }
    }
  };

  if (Array.isArray(raw)) {
    raw.forEach(processEntry);
  } else if (raw && typeof raw === 'object') {
    Object.values(raw).forEach(processEntry);
  }

  return questIds;
}

// Chapter icon filename from display name (e.g. "Early Game" -> "Early_Game.png")
function chapterIconPath(name) {
  if (!name || name === 'All Quests') return '';
  
  // Try to match ORDERED_CHAPTER_NAMES for Screenshot_X.png
  // Case-insensitive match just in case
  var idx = -1;
  var normName = (name || '').trim().toLowerCase();
  for (var i = 0; i < ORDERED_CHAPTER_NAMES.length; i++) {
    var check = ORDERED_CHAPTER_NAMES[i].toLowerCase();
    if (check === normName || CHAPTER_NAME_ALIASES[normName] === check) {
      idx = i;
      break;
    }
  }
  
  if (idx !== -1) {
    // Found in ordered list! Map to Screenshot_{idx+1}.png
    return 'icons/Screenshot_' + (idx + 1) + '.png';
  }

  // Fallback: Sanitize name: replace spaces with underscores, remove special chars
  // Handle "Fusion & Research" -> "Fusion_Research" or similar
  var safeName = (name || '').trim()
    .replace(/&/g, '') // Remove ampersand
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars
    .replace(/\s+/g, '_'); // Spaces to underscores
  return 'icons/' + safeName + '.png';
}

// Render chapter list in sidebar
function renderChapters() {
  chapterNav.innerHTML = '';
  
  chapters.forEach(chapter => {
    const li = document.createElement('li');
    li.dataset.chapterId = chapter.id;

    var iconPath = chapterIconPath(chapter.name);
    if (iconPath) {
      var iconImg = document.createElement('img');
      iconImg.src = iconPath;
      iconImg.alt = '';
      iconImg.className = 'chapter-icon';
      iconImg.onerror = function () { this.style.display = 'none'; };
      li.appendChild(iconImg);
    }
    var label = document.createElement('span');
    label.className = 'chapter-label';
    label.textContent = chapter.name;
    li.appendChild(label);
    
    // Add chapter progress
    const chapterQuests = mergedQuests.filter(q => chapter.quests.includes(q.id));
    const completedCount = chapterQuests.filter(q => q.completed).length;
    const totalCount = chapterQuests.length;
    
    if (totalCount > 0) {
      const progressSpan = document.createElement('div');
      progressSpan.className = 'chapter-progress';
      const percentage = Math.round((completedCount / totalCount) * 100);
      progressSpan.textContent = completedCount + '/' + totalCount + ' completed (' + percentage + '%)';
      if (completedCount === totalCount) {
        progressSpan.style.color = '#00e08a';
        progressSpan.innerHTML = '✓ ' + progressSpan.textContent;
      } else if (completedCount > 0) {
        progressSpan.style.color = '#ffd700';
      }
      li.appendChild(progressSpan);
    }

    li.addEventListener('click', () => selectChapter(chapter.id));
    chapterNav.appendChild(li);
  });
}

// Select and display a chapter
function selectChapter(chapterId) {
  currentChapter = chapterId;
  
  // Update active state in sidebar
  document.querySelectorAll('#chapterNav li').forEach(li => {
    li.classList.toggle('active', li.dataset.chapterId === chapterId);
  });
  
  // Get quests for this chapter and sort by numeric id (progression order)
  const chapter = chapters.find(c => c.id === chapterId);
  if (chapter) {
    var chapterQuests = mergedQuests.filter(q => chapter.quests.includes(q.id));
    chapterQuests = chapterQuests.slice().sort(function (a, b) { return (Number(a.id) || 0) - (Number(b.id) || 0); });
    
    // Update chapter title and icon
    if (currentChapterTitle) {
      currentChapterTitle.textContent = chapter.name || `Chapter ${chapterId}`;
    }
    
    // Update chapter icon
    if (currentChapterIcon) {
      var iconPath = chapterIconPath(chapter.name);
      if (iconPath) {
        currentChapterIcon.src = iconPath;
        currentChapterIcon.style.display = 'block';
        currentChapterIcon.onerror = function () { 
          this.style.display = 'none'; 
        };
      } else {
        currentChapterIcon.style.display = 'none';
      }
    }
    
    // Update quest stats
    const completedQuests = chapterQuests.filter(q => q.completed);
    if (questStats) {
      questStats.style.display = 'flex';
      if (completedCount) completedCount.textContent = completedQuests.length;
      if (totalCount) totalCount.textContent = chapterQuests.length;
    }

    // For Genesis, render a dependency graph instead of a simple grid
    var chapterNameLower = (chapter.name || '').trim().toLowerCase();
    if (chapterNameLower === 'genesis') {
      renderGenesisGraph(chapter, chapterQuests);
    } else {
      renderQuests(chapterQuests);
    }
  }
}

// Render quest cards in main panel (grid of square tiles, GTNH-style)
function renderQuests(quests) {
  const questContentContainer = questContent || document.querySelector('.quest-content');
  if (!questContentContainer) {
    console.error('Quest content container not found');
    return;
  }
  
  questContentContainer.innerHTML = '';
  if (quests.length === 0) {
    questContentContainer.innerHTML = '<p class="placeholder">No quests found in this chapter</p>';
    return;
  }
  
  const grid = document.createElement('div');
  grid.className = 'quest-grid';
  quests.forEach(quest => {
    grid.appendChild(createQuestCard(quest));
  });
  questContentContainer.appendChild(grid);
}

// Render a graph-style layout for the Genesis chapter, using prerequisites as edges
function renderGenesisGraph(chapter, chapterQuests) {
  const questContentContainer = questContent || document.querySelector('.quest-content');
  if (!questContentContainer) {
    console.error('Quest content container not found for Genesis graph');
    return;
  }

  questContentContainer.innerHTML = '';
  if (!chapterQuests || !chapterQuests.length) {
    questContentContainer.innerHTML = '<p class="placeholder">No quests found in Genesis</p>';
    return;
  }

  // Build quick lookup map and dependency edges within this chapter
  var questMap = {};
  chapterQuests.forEach(function (q) { questMap[q.id] = q; });

  var edges = [];
  chapterQuests.forEach(function (q) {
    var pre = Array.isArray(q.preRequisites) ? q.preRequisites : [];
    pre.forEach(function (pid) {
      if (questMap[pid]) {
        edges.push({ from: pid, to: q.id });
      }
    });
  });

  // Calculate bounding box of all quests to center the graph
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  var positions = {};
  
  // Use _chapterCoords if available, otherwise fallback to global
  // Note: 'chapter' object here has an ID which corresponds to the lineID we used in getQuestsForChapter
  var chapterCoords = null;
  if (window._chapterCoords) {
    chapterCoords = window._chapterCoords[chapter.id];
    // Fallback: try numeric lineID if the key format didn't match
    if (!chapterCoords) {
      var numericId = String(chapter.id).replace(/:.*$/, '');
      chapterCoords = window._chapterCoords[numericId];
    }
  }
  if (!chapterCoords) chapterCoords = window._questCoords || {};
  
  chapterQuests.forEach(function (q) {
    var coords = chapterCoords[q.id] || { x: 0, y: 0, sizeX: 24, sizeY: 24 };
    
    // BetterQuesting coordinates are often scaled differently, we'll try 1.0 first but double check
    // The reference image shows a large spread, so let's stick to 1.5 or adjust if needed.
    // Actually, usually 1 unit = 1 pixel at 100% zoom in BQ, but let's see.
    // Smaller scale to keep genesis graph compact
    var scale = 2.0; 
    var x = coords.x * scale;
    var y = coords.y * scale;
    var w = coords.sizeX * scale;
    var h = coords.sizeY * scale;
    
    positions[q.id] = { x: x, y: y, w: w, h: h };
    
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  });

  // Safety check if no coordinates found
  if (minX === Infinity) {
    renderQuests(chapterQuests); // Fallback to grid
    return;
  }

  // Add padding to accommodate nodes
  var padding = 130;
  var totalWidth = (maxX - minX) + padding * 2;
  var totalHeight = (maxY - minY) + padding * 2;

  // Adjust all positions to be positive relative to the bounding box
  Object.keys(positions).forEach(function(id) {
    positions[id].x = positions[id].x - minX + padding;
    positions[id].y = positions[id].y - minY + padding;
  });

  var wrapper = document.createElement('div');
  wrapper.className = 'genesis-graph-wrapper';
  wrapper.style.width = totalWidth + 'px';
  wrapper.style.height = totalHeight + 'px';

  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'genesis-graph-edges');
  svg.setAttribute('width', String(totalWidth));
  svg.setAttribute('height', String(totalHeight));

  var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  var marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.setAttribute('id', 'genesis-arrow');
  marker.setAttribute('markerWidth', '10');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('refX', '10');
  marker.setAttribute('refY', '3.5');
  marker.setAttribute('orient', 'auto');
  marker.setAttribute('markerUnits', 'strokeWidth');
  var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('points', '0 0, 10 3.5, 0 7');
  marker.appendChild(poly);
  defs.appendChild(marker);
  svg.appendChild(defs);

  var nodesLayer = document.createElement('div');
  nodesLayer.className = 'genesis-graph-nodes';

  chapterQuests.forEach(function (q) {
    var pos = positions[q.id];
    var node = document.createElement('div');
    node.className = 'genesis-node ' + (q.completed ? 'completed' : 'incomplete');
    
    // Node size is now controlled by CSS (64x64)
    // Position top-left
    node.style.left = pos.x + 'px';
    node.style.top = pos.y + 'px';
    
    node.addEventListener('click', function () { showQuestModal(q); });

    var iconDiv = document.createElement('div');
    iconDiv.className = 'genesis-node-icon';

    var img = document.createElement('img');
    img.alt = q.icon && q.icon.id ? q.icon.id : 'quest icon';
    img.style.imageRendering = 'pixelated';

    if (q.icon && q.icon.id) {
      const iconId = q.icon.id.replace(':', '_');

      function showFallbackEmoji() {
        img.onerror = null;
        img.style.display = 'none';
        var fallback = document.createElement('span');
        fallback.className = 'fallback-icon';
        fallback.textContent = q.completed ? '✅' : '📋';
        iconDiv.appendChild(fallback);
      }

      function applyPngFallback() {
        img.style.display = '';
        img.src = 'icons_nomi/' + iconId + '.png';
        img.onerror = function () {
          img.onerror = null;
          showFallbackEmoji();
        };
      }

      img.style.display = 'none';
      (async function () {
        var atlasFound = await setNomiQuestIcon(img, q.id);
        if (atlasFound) return;

        await initNomiIconMap();
        var dmg = q.icon.damage || 0;
        var isFluid = q.icon.id && q.icon.id.indexOf('fluid:') === 0;
        var fullId = (!isFluid && dmg !== 0) ? (q.icon.id + ':' + dmg) : q.icon.id;
        var mappedPath = nomiIconMap ? nomiIconMap[fullId] : null;
        if (!mappedPath && !isFluid && dmg !== 0) {
          mappedPath = nomiIconMap ? nomiIconMap[q.icon.id] : null;
        }

        if (mappedPath) {
          img.style.display = '';
          img.src = mappedPath;
          img.onerror = function () {
            img.onerror = null;
            applyPngFallback();
          };
          return;
        }

        applyPngFallback();
      })();
    } else {
      img.style.display = 'none';
      var fb = document.createElement('span');
      fb.className = 'fallback-icon';
      fb.textContent = q.completed ? '✅' : '📋';
      iconDiv.appendChild(fb);
    }

    iconDiv.appendChild(img);

    // Only show label if the node is large enough, or show it on hover
    // We already have CSS for hover zoom so skipping inline styles here
    // But let's add the label div
    var label = document.createElement('div');
    label.className = 'genesis-node-label';
    var displayName = q.langTitle != null ? q.langTitle : q.name;
    // Just grab first few words if too long
    // label.textContent = displayName || ('Quest ' + q.id);
    if (displayName && displayName.indexOf('§') !== -1) label.innerHTML = mcColorToHtml(displayName);
    else label.textContent = displayName || ('Quest ' + q.id);

    if (q.completed) {
      var badge = document.createElement('div');
      badge.className = 'genesis-node-badge';
      badge.textContent = '✓';
      node.appendChild(badge);
    }

    node.appendChild(iconDiv);
    node.appendChild(label);
    nodesLayer.appendChild(node);
  });

  // Draw edges after positions are known
  edges.forEach(function (e) {
    var fromPos = positions[e.from];
    var toPos = positions[e.to];
    if (!fromPos || !toPos) return;
    var fromQuest = questMap[e.from];
    var toQuest = questMap[e.to];

    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    
    // Connect centers of the nodes, accounting for margins and padding
    // The visual center is offset by margins (8px) and internal padding (12px)
    var marginOffset = 8;
    var actualNodeWidth = Math.max(64, fromPos.w);
    var actualNodeHeight = Math.max(64, fromPos.h);
    
    var x1 = fromPos.x + marginOffset + actualNodeWidth / 2;
    var y1 = fromPos.y + marginOffset + actualNodeHeight / 2;
    
    var actualNodeWidth2 = Math.max(64, toPos.w);
    var actualNodeHeight2 = Math.max(64, toPos.h);
    
    var x2 = toPos.x + marginOffset + actualNodeWidth2 / 2;
    var y2 = toPos.y + marginOffset + actualNodeHeight2 / 2;
    
    // Filter out left-pointing edges (problematic connections)
    if (x2 < x1) return;
    
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    
    // No marker-end to avoid clutter
    
    var allCompleted = fromQuest && toQuest && fromQuest.completed && toQuest.completed;
    line.setAttribute('class', 'genesis-edge ' + (allCompleted ? 'completed' : 'incomplete'));
    svg.appendChild(line);
  });

  wrapper.appendChild(svg);
  wrapper.appendChild(nodesLayer);
  
  // Add a pan/zoom container that respects the flex layout
  var panZoomContainer = document.createElement('div');
  panZoomContainer.className = 'genesis-pan-zoom-container';
  panZoomContainer.style.position = 'relative';
  panZoomContainer.style.flex = '1';
  panZoomContainer.style.minHeight = '0'; // Allow flex item to shrink
  panZoomContainer.style.backgroundColor = '#1e2430';
  
  panZoomContainer.appendChild(wrapper);
  questContentContainer.appendChild(panZoomContainer);
  
  // Add pan and zoom functionality
  var scale = 0.4; // Start zoomed out so all content is visible and chapters can be seen
  var panX = 0;
  var panY = 0;
  var isDragging = false;
  var lastMouseX = 0;
  var lastMouseY = 0;
  
  function updateTransform() {
    wrapper.style.transform = 'translate(' + panX + 'px, ' + panY + 'px) scale(' + scale + ')';
  }
  
  // Mouse wheel zoom
  panZoomContainer.addEventListener('wheel', function(e) {
    e.preventDefault();
    var rect = panZoomContainer.getBoundingClientRect();
    var mouseX = e.clientX - rect.left;
    var mouseY = e.clientY - rect.top;
    
    var delta = e.deltaY > 0 ? 0.9 : 1.1;
    var newScale = Math.min(Math.max(scale * delta, 0.1), 3);
    
    if (newScale !== scale) {
      // Zoom towards mouse position
      panX = mouseX - (mouseX - panX) * (newScale / scale);
      panY = mouseY - (mouseY - panY) * (newScale / scale);
      scale = newScale;
      updateTransform();
    }
  });
  
  // Mouse drag pan
  panZoomContainer.addEventListener('mousedown', function(e) {
    if (e.button === 0) { // Left mouse button
      isDragging = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      panZoomContainer.classList.add('panning');
      e.preventDefault();
    }
  });
  
  document.addEventListener('mousemove', function(e) {
    if (isDragging) {
      var deltaX = e.clientX - lastMouseX;
      var deltaY = e.clientY - lastMouseY;
      panX += deltaX;
      panY += deltaY;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      updateTransform();
    }
  });
  
  document.addEventListener('mouseup', function(e) {
    if (isDragging) {
      isDragging = false;
      panZoomContainer.classList.remove('panning');
    }
  });
  
  // Center view on start
  setTimeout(() => {
    var containerRect = panZoomContainer.getBoundingClientRect();
    panX = (containerRect.width - totalWidth * scale) / 2;
    panY = (containerRect.height - totalHeight * scale) / 2;
    updateTransform();
  }, 100);
}

// Show quest description modal
function showQuestModal(quest) {
  var modal = document.getElementById('questModal');
  var titleEl = document.getElementById('questModalTitle');
  var descEl = document.getElementById('questModalDesc');
  if (!modal || !titleEl || !descEl) return;
  var titleStr = quest.langTitle != null ? quest.langTitle : quest.name;
  var descStr = quest.langDesc != null ? quest.langDesc : (quest.description || 'No description.');
  if (titleStr.indexOf('§') !== -1) titleEl.innerHTML = mcColorToHtml(titleStr);
  else titleEl.textContent = titleStr;
  if (descStr.indexOf('§') !== -1 || descStr.indexOf('%n') !== -1) descEl.innerHTML = mcColorToHtml(descStr);
  else descEl.textContent = descStr;
  descEl.style.whiteSpace = 'pre-wrap';
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function hideQuestModal() {
  var modal = document.getElementById('questModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function initQuestModal() {
  var modal = document.getElementById('questModal');
  var backdrop = modal && modal.querySelector('.quest-modal-backdrop');
  var closeBtn = modal && modal.querySelector('.quest-modal-close');
  if (backdrop) backdrop.addEventListener('click', hideQuestModal);
  if (closeBtn) closeBtn.addEventListener('click', hideQuestModal);
}

// Create a quest card element — square tile: icon center, name bottom, checkmark top-right (GTNH-style)
function createQuestCard(quest) {
  const card = document.createElement('div');
  card.className = 'quest-card ' + (quest.completed ? 'completed' : 'incomplete');
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.addEventListener('click', function () { showQuestModal(quest); });
  card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showQuestModal(quest); } });

  if (quest.completed) {
    const badge = document.createElement('div');
    badge.className = 'quest-completion-badge';
    badge.innerHTML = '✓';
    badge.title = 'Completed';
    card.appendChild(badge);
  }

  const iconDiv = document.createElement('div');
  iconDiv.className = 'quest-icon';

  // Tier badges disabled - icons now have specific textures for each variant
  // (e.g. Vibrant Alloy Conduit uses enderio__item_endergy_conduit__2.png)
  
  const iconImg = document.createElement('img');
  iconImg.alt = quest.icon && quest.icon.id ? quest.icon.id : 'quest icon';

  if (quest.icon && quest.icon.id) {
    const iconId = quest.icon.id.replace(':', '_');

    // Helper: emoji fallback when all sources fail
    function showFallbackEmoji() {
      iconImg.onerror = null;
      iconImg.style.display = 'none';
      const fallback = document.createElement('span');
      fallback.className = 'fallback-icon';
      fallback.textContent = quest.completed ? '✅' : '📋';
      iconDiv.appendChild(fallback);
    }

    // Helper: old fallback chain (icons_nomi → icons/ → CDN → emoji)
    function applyOldPngFallback() {
      iconImg.style.display = '';
      iconImg.src = 'icons_nomi/' + iconId + '.png';
      iconImg.onerror = function () {
        iconImg.onerror = function () {
          if (ICON_CDN_BASE) {
            iconImg.onerror = function () { showFallbackEmoji(); };
            iconImg.src = ICON_CDN_BASE + iconId + '.png';
          } else {
            showFallbackEmoji();
          }
        };
        iconImg.src = 'icons/' + iconId + '.png';
      };
    }

    // Main resolution: atlas first (best quality), then icon map, then old fallback
    iconImg.style.display = 'none'; // hide until a source is confirmed
    (async function () {
      // 1. Try atlas first (GTNH-style .gtbl) — has properly sized icons
      const atlasFound = await setNomiQuestIcon(iconImg, quest.id);
      if (atlasFound) return;

      // 2. Check pre-built icon map (filtered-textures/ exact match)
      await initNomiIconMap();
      // Build full icon ID with metadata for items like gregtech:machine:80
      // For fluids (fluid:name), don't append damage
      const iconDamageForLookup = quest.icon.damage || 0;
      const isFluid = quest.icon.id && quest.icon.id.startsWith('fluid:');
      const iconIdWithDamage = (!isFluid && iconDamageForLookup !== 0)
        ? `${quest.icon.id}:${iconDamageForLookup}` 
        : quest.icon.id;
      let mappedPath = nomiIconMap ? nomiIconMap[iconIdWithDamage] : null;
      
      // Fallback: if no metadata-specific match, try without metadata (skip for fluids)
      if (!mappedPath && !isFluid && iconDamageForLookup !== 0) {
        mappedPath = nomiIconMap ? nomiIconMap[quest.icon.id] : null;
      }
      
      if (mappedPath) {
        iconImg.style.display = '';
        iconImg.src = mappedPath;
        iconImg.onerror = function () {
          // Map entry failed? Fall to old chain
          iconImg.onerror = null;
          applyOldPngFallback();
        };
        return;
      }

      // 3. Fall back to icons_nomi/ → icons/ → CDN → emoji
      applyOldPngFallback();
    })();
  } else {
    iconImg.style.display = 'none';
    const fallback = document.createElement('span');
    fallback.className = 'fallback-icon';
    fallback.textContent = quest.completed ? '✅' : '📋';
    iconDiv.appendChild(fallback);
  }

  iconDiv.appendChild(iconImg);

  const infoDiv = document.createElement('div');
  infoDiv.className = 'quest-info';

  const nameDiv = document.createElement('div');
  nameDiv.className = 'quest-name';
  var displayName = quest.langTitle != null ? quest.langTitle : quest.name;
  if (displayName.indexOf('§') !== -1) nameDiv.innerHTML = mcColorToHtml(displayName);
  else nameDiv.textContent = displayName;

  infoDiv.appendChild(nameDiv);
  card.appendChild(iconDiv);
  card.appendChild(infoDiv);

  return card;
}

// Update overall progress bar
function updateProgressBar() {
  const totalQuests = mergedQuests.length;
  const completedQuests = mergedQuests.filter(q => q.completed).length;
  
  if (totalQuests === 0) {
    progressContainer.style.display = 'none';
    return;
  }
  
  const rawPercent = totalQuests > 0 ? (completedQuests / totalQuests) * 100 : 0;
  const percentage = Math.round(rawPercent);
  if (_leaderboardProgress) {
    _leaderboardProgress.total = totalQuests;
    _leaderboardProgress.completed = completedQuests;
    _leaderboardProgress.percent = rawPercent;
  }
  
  progressContainer.style.display = 'flex';
  progressFill.style.width = `${percentage}%`;
  progressText.textContent = `${completedQuests}/${totalQuests} (${percentage}%)`;
}

// Show error message
function showError(message) {
  questList.innerHTML = `<div class="error-message">${message}</div>`;
  console.error(message);
}

// ========== SHARING FEATURE ==========
// Encode completed quest IDs into a URL-safe compressed string
function encodeShareData() {
  var ids = mergedQuests.filter(q => q.completed).map(q => q.id);
  if (ids.length === 0) return null;
  var json = JSON.stringify(ids);
  var compressed = pako.deflate(json);
  // Convert Uint8Array to base64url
  var binary = '';
  for (var i = 0; i < compressed.length; i++) {
    binary += String.fromCharCode(compressed[i]);
  }
  var b64 = btoa(binary);
  // Make URL-safe: + -> -, / -> _, remove trailing =
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Decode shared data from URL hash
function decodeShareData(encoded) {
  try {
    // Undo URL-safe base64
    var b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    // Add back padding
    while (b64.length % 4 !== 0) b64 += '=';
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    var json = pako.inflate(bytes, { to: 'string' });
    return JSON.parse(json);
  } catch (e) {
    console.error('Failed to decode share data:', e);
    return null;
  }
}

// Generate share URL and show banner
function generateShareLink() {
  var encoded = encodeShareData();
  if (!encoded) {
    alert('No completed quests to share.');
    return;
  }
  var url = window.location.origin + window.location.pathname + '#share=' + encoded;
  // Append player name if available
  if (window._playerDisplayName) {
    url += '&player=' + encodeURIComponent(window._playerDisplayName);
  }
  var banner = document.getElementById('shareBanner');
  var urlInput = document.getElementById('shareUrl');
  if (banner && urlInput) {
    urlInput.value = url;
    banner.style.display = 'flex';
    // Auto-copy
    navigator.clipboard.writeText(url).catch(function() {});
  }
}

// Check URL for shared progress on page load
function checkForSharedProgress() {
  var hash = window.location.hash;
  if (!hash || !hash.startsWith('#share=')) return false;
  var hashContent = hash.slice(7); // remove '#share='
  // Split on '&' to separate share data from player name
  var parts = hashContent.split('&');
  var encoded = parts[0];
  var sharedPlayerName = null;
  for (var p = 1; p < parts.length; p++) {
    if (parts[p].startsWith('player=')) {
      sharedPlayerName = decodeURIComponent(parts[p].slice(7));
    }
  }
  if (!encoded) return false;
  var ids = decodeShareData(encoded);
  if (!ids || !Array.isArray(ids) || ids.length === 0) return false;

  // Build a fake playerData so tryMergeAndRender works
  // We create a minimal structure that the completedIds parser can find
  var completedSet = new Set(ids.map(String));
  window._sharedCompletedIds = completedSet;
  playerData = { _shared: true, completedQuests: ids.map(id => ({ id: id })) };

  // Hide file upload, show shared-mode banner
  var fileInputs = document.querySelector('.file-inputs');
  if (fileInputs) fileInputs.style.display = 'none';
  var header = document.querySelector('header');
  if (header) {
    var banner = document.createElement('div');
    banner.className = 'shared-mode-banner';
    var bannerText = '👁️ Viewing shared progress (read-only) — ' + ids.length + ' completed quests';
    if (sharedPlayerName) bannerText = '👁️ Viewing ' + sharedPlayerName + "'s progress (read-only) — " + ids.length + ' completed quests';
    banner.textContent = bannerText;
    header.appendChild(banner);
  }

  // Show shared player name in the corner
  if (sharedPlayerName) {
    showPlayerName(sharedPlayerName, null);
  }

  console.log('Loaded shared progress:', ids.length, 'completed quests');
  return true;
}

// Wire up share button and copy button
(function initSharing() {
  // Check for shared link on load
  var isShared = checkForSharedProgress();

  var shareBtn = document.getElementById('shareBtn');
  var copyBtn = document.getElementById('shareCopyBtn');

  if (shareBtn) {
    shareBtn.addEventListener('click', generateShareLink);
  }
  if (copyBtn) {
    copyBtn.addEventListener('click', function() {
      var urlInput = document.getElementById('shareUrl');
      if (urlInput) {
        navigator.clipboard.writeText(urlInput.value).then(function() {
          copyBtn.textContent = 'Copied!';
          setTimeout(function() { copyBtn.textContent = 'Copy'; }, 2000);
        });
      }
    });
  }

  // Show share button after quests are rendered
  var origUpdateProgressBar = updateProgressBar;
  updateProgressBar = function() {
    origUpdateProgressBar();
    if (mergedQuests.length > 0 && shareBtn && !window._sharedCompletedIds) {
      shareBtn.style.display = 'inline-block';
    }
  };

  // If shared, trigger merge once quest data finishes loading
  if (isShared) {
    tryMergeAndRender();
  }
})();

// ========== LEADERBOARD FEATURE (Supabase-backed) ==========

function buildLeaderboardPayload() {
  const total = _leaderboardProgress.total || mergedQuests.length;
  const completed = _leaderboardProgress.completed || mergedQuests.filter(q => q.completed).length;
  const percent = total > 0 ? (_leaderboardProgress.percent || (completed / total * 100)) : 0;
  const playerName = window._playerDisplayName || null;
  const playerUuid = window._playerUuid || null;

  return {
    pack_id: LEADERBOARD_PACK_ID,
    player_name: playerName,
    player_uuid: playerUuid,
    completed_count: completed,
    total_quests: total,
    percent_complete: percent,
    submitted_at: new Date().toISOString()
  };
}

async function submitLeaderboardEntry() {
  if (!LEADERBOARD_ENABLED) return;
  if (!leaderboardStatus) return;

  if (!LEADERBOARD_SUPABASE_URL || !LEADERBOARD_SUPABASE_KEY) {
    leaderboardStatus.textContent = 'Leaderboard backend not configured yet.';
    return;
  }

  if (!mergedQuests.length || !_leaderboardProgress.total) {
    leaderboardStatus.textContent = 'Load your progress first, then submit.';
    return;
  }

  if (window._sharedCompletedIds) {
    leaderboardStatus.textContent = 'Cannot submit while viewing a shared read-only link.';
    return;
  }

  const payload = buildLeaderboardPayload();
  if (!payload.player_name) {
    const fallbackName = prompt("[v2] We couldn't detect your player name from the file. Please enter your exact Minecraft username to verify:");
    if (!fallbackName || !fallbackName.trim()) {
      leaderboardStatus.textContent = 'Cannot submit: player name is required.';
      return;
    }
    leaderboardStatus.textContent = 'Verifying Minecraft username...';
    if (leaderboardSubmitBtn) leaderboardSubmitBtn.disabled = true;
    try {
      const verifyRes = await fetch('https://api.ashcon.app/mojang/v2/user/' + encodeURIComponent(fallbackName.trim()));
      if (!verifyRes.ok) throw new Error('Username not found');
      const verifyData = await verifyRes.json();
      payload.player_name = verifyData.username;
      payload.player_uuid = verifyData.uuid.replace(/-/g, '');
      window._playerDisplayName = payload.player_name;
      window._playerUuid = payload.player_uuid;
      showPlayerName(payload.player_name, payload.player_uuid);
    } catch (err) {
      leaderboardStatus.textContent = 'Cannot submit: Invalid Minecraft username.';
      if (leaderboardSubmitBtn) leaderboardSubmitBtn.disabled = false;
      return;
    }
  }

  try {
    if (leaderboardSubmitBtn) leaderboardSubmitBtn.disabled = true;
    leaderboardStatus.textContent = 'Submitting to leaderboard...';

    // delete any stale null-UUID row for this player; prevents duplicates
    if (payload.player_uuid) {
      try {
        const baseUrl = LEADERBOARD_SUPABASE_URL.replace(/\/$/, '');
        const delUrl = baseUrl + '/rest/v1/leaderboard_entries' +
                       '?pack_id=eq.' + encodeURIComponent(payload.pack_id) +
                       '&player_name=eq.' + encodeURIComponent(payload.player_name) +
                       '&player_uuid=is.null';
        await fetch(delUrl, {
          method: 'DELETE',
          headers: { 'apikey': LEADERBOARD_SUPABASE_KEY }
        });
      } catch (cleanupErr) {
        console.warn('Failed to clean up old null-UUID row', cleanupErr);
      }
    }

    let res;
    if (LEADERBOARD_USE_RPC) {
      const rpcUrl = LEADERBOARD_SUPABASE_URL.replace(/\/$/, '') +
                     '/rest/v1/rpc/upsert_leaderboard_entry';
      res = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': LEADERBOARD_SUPABASE_KEY
        },
        body: JSON.stringify({
          p_pack_id: payload.pack_id,
          p_player_name: payload.player_name,
          p_player_uuid: payload.player_uuid,
          p_completed_count: payload.completed_count,
          p_total_quests: payload.total_quests
        })
      });
    } else {
      res = await fetch(
        LEADERBOARD_SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/leaderboard_entries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': LEADERBOARD_SUPABASE_KEY,
            'Prefer': 'return=representation,resolution=merge-duplicates'
          },
          body: JSON.stringify(payload)
        }
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.log('Upsert failed with body:', text);
      if (res.status === 409) {
        // Conflict on the unique key – try to recover by patching the existing row
        // instead of giving up.  Supabase should handle this automatically when
        // `Prefer: resolution=merge-duplicates` is sent, but some configurations
        // (missing header, RPC using the wrong conflict target, etc.) can still
        // result in a 409.  The fallback here keeps the leaderboard usable.
        if (!LEADERBOARD_USE_RPC && payload.player_uuid) {
          try {
            const baseUrl = LEADERBOARD_SUPABASE_URL.replace(/\/$/, '');
            const updUrl = baseUrl +
              '/rest/v1/leaderboard_entries' +
              '?pack_id=eq.' + encodeURIComponent(payload.pack_id) +
              '&player_uuid=eq.' + encodeURIComponent(payload.player_uuid);
            const patchRes = await fetch(updUrl, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'apikey': LEADERBOARD_SUPABASE_KEY
              },
              body: JSON.stringify(payload)
            });
            if (patchRes.ok) {
              leaderboardStatus.textContent =
                'Existing entry updated (resolved conflict). Refreshing leaderboard...';
              await loadLeaderboard();
              leaderboardStatus.textContent = 'Progress submitted successfully!';
              return;
            }
            console.warn('Patch after conflict also failed', patchRes.status, await patchRes.text());
          } catch (patchErr) {
            console.error('Patch-after-conflict failed', patchErr);
          }
        }

        leaderboardStatus.textContent =
          'Database constraint issue detected. Check that the unique index on (pack_id, player_uuid) exists and that the upsert header is being sent.';
        return;
      }
      throw new Error('HTTP ' + res.status + (text ? ': ' + text : ''));
    }

    leaderboardStatus.textContent = 'Submission saved! Refreshing leaderboard...';
    await loadLeaderboard();
    leaderboardStatus.textContent = 'Progress submitted successfully!';
  } catch (err) {
    console.error('Failed to submit leaderboard entry:', err);
    leaderboardStatus.textContent = 'Failed to submit leaderboard entry: ' + (err && err.message ? err.message : err);
  } finally {
    if (leaderboardSubmitBtn) leaderboardSubmitBtn.disabled = false;
  }
}

async function loadLeaderboard() {
  if (!LEADERBOARD_ENABLED) return;
  if (!leaderboardBody || !leaderboardStatus) return;

  if (!LEADERBOARD_SUPABASE_URL || !LEADERBOARD_SUPABASE_KEY) {
    leaderboardStatus.textContent = 'Leaderboard backend not configured yet.';
    return;
  }

  try {
    leaderboardStatus.textContent = 'Loading leaderboard...';

    const baseUrl = LEADERBOARD_SUPABASE_URL.replace(/\/$/, '');
    const params = new URLSearchParams();
    params.set('select', 'pack_id,player_name,player_uuid,completed_count,total_quests,percent_complete,submitted_at');
    params.set('pack_id', 'eq.' + LEADERBOARD_PACK_ID);
    params.set('order', 'percent_complete.desc');
    params.set('limit', String(LEADERBOARD_MAX_ROWS));

    const res = await fetch(baseUrl + '/rest/v1/leaderboard_entries?' + params.toString(), {
      headers: {
        'apikey': LEADERBOARD_SUPABASE_KEY
      }
    });

    if (!res.ok) {
      const text = await res.text().catch(function () { return ''; });
      throw new Error('HTTP ' + res.status + (text ? ': ' + text : ''));
    }

    const entries = await res.json();

    leaderboardBody.innerHTML = '';

    if (!entries || !entries.length) {
      const row = document.createElement('tr');
      row.className = 'leaderboard-empty-row';
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.textContent = 'No entries yet. Be the first to submit!';
      row.appendChild(cell);
      leaderboardBody.appendChild(row);
      leaderboardStatus.textContent = 'No leaderboard entries yet.';
      return;
    }

    entries.forEach(function (entry, index) {
      const tr = document.createElement('tr');
      const rankTd = document.createElement('td');
      rankTd.textContent = String(index + 1);
      tr.appendChild(rankTd);

      const nameTd = document.createElement('td');
      nameTd.textContent = entry.player_name || '(unknown)';
      tr.appendChild(nameTd);

      const completedTd = document.createElement('td');
      completedTd.textContent = String(entry.completed_count || 0);
      tr.appendChild(completedTd);

      const totalTd = document.createElement('td');
      totalTd.textContent = String(entry.total_quests || 0);
      tr.appendChild(totalTd);

      const pctTd = document.createElement('td');
      const pctVal = typeof entry.percent_complete === 'number' ? entry.percent_complete : (entry.total_quests ? (entry.completed_count / entry.total_quests * 100) : 0);
      pctTd.textContent = Math.round(pctVal) + '%';
      tr.appendChild(pctTd);

      const dateTd = document.createElement('td');
      if (entry.submitted_at) {
        var d = new Date(entry.submitted_at);
        if (!isNaN(d.getTime())) {
          dateTd.textContent = d.toLocaleString();
        } else {
          dateTd.textContent = entry.submitted_at;
        }
      } else {
        dateTd.textContent = '-';
      }
      tr.appendChild(dateTd);

      if (window._playerDisplayName && entry.player_name === window._playerDisplayName) {
        tr.className += (tr.className ? ' ' : '') + 'leaderboard-row-self';
      }

      leaderboardBody.appendChild(tr);
    });

    leaderboardStatus.textContent = 'Leaderboard loaded.';
  } catch (err) {
    console.error('Failed to load leaderboard:', err);
    leaderboardStatus.textContent = 'Failed to load leaderboard: ' + (err && err.message ? err.message : err);
  }
}

(function initLeaderboard() {
  if (!LEADERBOARD_ENABLED) return;
  if (!leaderboardPanel || !leaderboardBody || !leaderboardStatus) return;

  // If backend URL/key are not configured yet, show a helpful message and stop.
  if (!LEADERBOARD_SUPABASE_URL || !LEADERBOARD_SUPABASE_KEY) {
    leaderboardStatus.textContent = 'Leaderboard backend not configured yet.';
    if (leaderboardSubmitBtn) {
      leaderboardSubmitBtn.disabled = true;
      leaderboardSubmitBtn.title = 'Leaderboard backend is not configured yet.';
    }
    return;
  }

  if (leaderboardSubmitBtn) {
    leaderboardSubmitBtn.addEventListener('click', function () {
      submitLeaderboardEntry();
    });
  }

  // Wrap updateProgressBar so we can show/hide the submit button when progress exists
  var origUpdate = updateProgressBar;
  updateProgressBar = function () {
    origUpdate();
    if (!leaderboardSubmitBtn) return;
    if (mergedQuests.length > 0 && !window._sharedCompletedIds) {
      leaderboardSubmitBtn.style.display = 'inline-block';
      leaderboardSubmitBtn.disabled = false;
    } else {
      leaderboardSubmitBtn.style.display = 'none';
    }
  };

  // Initial load of leaderboard data
  loadLeaderboard();
})();
