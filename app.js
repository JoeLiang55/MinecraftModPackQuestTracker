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

// Lang file entries (key -> value). Filled automatically from Nomifactory CEU Quests.txt in same folder.
window.NOMI_LANG = {};

// DOM elements
const playerFileInput = document.getElementById('playerFile');
const chapterNav = document.getElementById('chapterNav');
const questList = document.getElementById('questList');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

// Event listeners for file inputs
playerFileInput.addEventListener('change', handlePlayerFile);
initQuestModal();

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

// DefaultQuests.json is bundled in the repo — fetch it automatically.
function loadQuestFileFromUrl() {
  fetch('defaultquests/DefaultQuests.json')
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
      // #region agent log
      fetch('http://127.0.0.1:7625/ingest/1e1b655b-08d3-49a3-8143-37203c10b8bb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3f59d1'},body:JSON.stringify({sessionId:'3f59d1',location:'app.js:handleQuestFile',message:'questData root keys',data:{rootKeys:window._debugRootKeys},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
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

// Handle PlayerData.dat file upload (NBT format)
function handlePlayerFile(event) {
  const file = event.target.files[0];
  if (!file) return;

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
          tryMergeAndRender();
          return;
        }
      } catch (jsonError) {
        // Not JSON, continue with NBT parsing
      }
      
      // Parse as NBT (binary format)
      playerData = await parseNBT(arrayBuffer);
      console.log('Player data loaded from NBT:', playerData);
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
      case 12: return readLongArray(); // TAG_Long_Array
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

// Try to merge data and render if both files are loaded
function tryMergeAndRender() {
  if (!questData || !playerData) {
    return; // Wait for both files
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
    
    // Visible debug for diagnosis
    var debugEl = document.getElementById('debugLine');
    if (debugEl) {
      debugEl.style.display = 'block';
      var completedCount = mergedQuests.filter(function(q){ return q.completed; }).length;
      var pdbg = window._playerDataDebug || {};
      debugEl.textContent = 'Debug: merged=' + mergedQuests.length + 
        ' completed=' + completedCount +
        ' playerCompletedIds=' + (pdbg.completedCount || 0) +
        ' playerKeys=[' + (pdbg.playerDataKeys || []).join(',') + ']' +
        ' sampleCompletedIds=[' + (pdbg.sampleIds || []).join(',') + ']';
    }

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
  } else {
  
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
  } // end of else (non-shared path)
  console.log('Found completed quest IDs:', completedIds.size, Array.from(completedIds).slice(0, 20));
  
  // Debug: dump player data structure to help diagnose issues
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

  // #region agent log
  var _dbKeys = questDB && typeof questDB === 'object' && !Array.isArray(questDB) ? Object.keys(questDB).slice(0, 15) : null;
  var _dbLen = Array.isArray(questDB) ? questDB.length : (questDB && typeof questDB === 'object' ? Object.keys(questDB).length : 0);
  var _logPayload = {sessionId:'3f59d1',location:'app.js:mergeQuestData',message:'questDB resolved',data:{isArray:Array.isArray(questDB),size:_dbLen,sampleKeys:_dbKeys},timestamp:Date.now(),hypothesisId:'H2'};
  fetch('http://127.0.0.1:7625/ingest/1e1b655b-08d3-49a3-8143-37203c10b8bb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3f59d1'},body:JSON.stringify(_logPayload)}).catch(function(){ console.log('[DEBUG]', JSON.stringify(_logPayload)); });
  // #endregion
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
  // #region agent log
  var _logPayload2 = {sessionId:'3f59d1',location:'app.js:mergeQuestData',message:'after process',data:{mergedCount:mergedQuests.length,firstIds:mergedQuests.slice(0,3).map(function(q){return q.id;})},timestamp:Date.now(),hypothesisId:'H2'};
  fetch('http://127.0.0.1:7625/ingest/1e1b655b-08d3-49a3-8143-37203c10b8bb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3f59d1'},body:JSON.stringify(_logPayload2)}).catch(function(){ console.log('[DEBUG]', JSON.stringify(_logPayload2)); });
  var completedArr = Array.from(completedIds);
  var mergedCompletedCount = mergedQuests.filter(function(q){ return q.completed; }).length;
  var _logComplete = { sessionId: '3f59d1', location: 'app.js:mergeQuestData', message: 'player completion', data: { completedIdsCount: completedIds.size, sampleCompletedIds: completedArr.slice(0, 10), mergedQuestCount: mergedQuests.length, mergedCompletedCount: mergedCompletedCount, sampleMergedIds: mergedQuests.slice(0, 5).map(function(q){ return { id: q.id, completed: q.completed }; }) }, timestamp: Date.now(), hypothesisId: 'H5' };
  fetch('http://127.0.0.1:7625/ingest/1e1b655b-08d3-49a3-8143-37203c10b8bb', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '3f59d1' }, body: JSON.stringify(_logComplete) }).catch(function () { console.log('[DEBUG completion]', JSON.stringify(_logComplete)); });
  // #endregion
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

  const mergedQuest = {
    id: questId,
    name: displayName,
    description: displayDesc,
    icon: extractIcon(quest),
    rewards: extractRewards(quest),
    chapterId: quest.chapterId || quest.lineId || null,
    completed: completedIds.has(questId)
  };

  mergedQuests.push(mergedQuest);
}

// Extract icon information from quest
function extractIcon(quest) {
  const icon = quest.icon || quest['icon:10'] || {};
  const properties = quest.properties || quest['properties:10'] || {};
  const bqProps = properties.betterquesting || properties['betterquesting:10'] || {};
  const questIcon = bqProps.icon || bqProps['icon:10'] || icon;
  
  return {
    id: questIcon.id || questIcon['id:8'] || 'minecraft:book',
    damage: questIcon.Damage || questIcon['Damage:2'] || 0,
    count: questIcon.Count || questIcon['Count:3'] || 1
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
        quests: getQuestsForChapter(line)
      });
    });
  } else if (typeof questLines === 'object') {
    Object.entries(questLines).forEach(([id, entry]) => {
      var line = unwrapLine(entry); // Ensure we get the value if it's a wrapper
      chapters.push({
        id: id,
        name: chapterName(line, `Chapter ${id}`, id),
        quests: getQuestsForChapter(line)
      });
    });
  }

  // Always add "All Quests" first so user can see every quest (even if chapter IDs don't match)
  const allQuestIds = mergedQuests.map(q => q.id);
  chapters.unshift({
    id: 'all',
    name: 'All Quests',
    quests: allQuestIds
  });

  // Reorder chapters to match ORDERED_CHAPTER_NAMES (case-insensitive; use aliases so "Simulation Resources" matches)
  function normalizeName(n) { return (n || '').trim().toLowerCase(); }
  function chapterNormForMatch(name) {
    var n = normalizeName(name);
    return CHAPTER_NAME_ALIASES[n] || n;
  }
  var ordered = [{ id: 'all', name: 'All Quests', quests: allQuestIds }];
  var used = new Set();
  ORDERED_CHAPTER_NAMES.forEach(function (want) {
    var wantNorm = normalizeName(want);
    for (var i = 1; i < chapters.length; i++) {
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
  for (var j = 1; j < chapters.length; j++) {
    if (!used.has(j)) ordered.push(chapters[j]);
  }
  chapters = ordered;

  console.log('Chapters extracted:', chapters.length);
  // #region agent log
  var _ch0 = chapters.length > 0 ? {id: chapters[0].id, name: chapters[0].name, questCount: chapters[0].quests.length, sampleQuestIds: chapters[0].quests.slice(0, 5)} : null;
  var _logPayload3 = {sessionId:'3f59d1',location:'app.js:extractChapters',message:'chapters built',data:{chapterCount:chapters.length,firstChapter:_ch0},timestamp:Date.now(),hypothesisId:'H3'};
  fetch('http://127.0.0.1:7625/ingest/1e1b655b-08d3-49a3-8143-37203c10b8bb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3f59d1'},body:JSON.stringify(_logPayload3)}).catch(function(){ console.log('[DEBUG]', JSON.stringify(_logPayload3)); });
  // #endregion
}

// Get quest IDs for a chapter/quest line (must match merged quest IDs for filtering)
function getQuestsForChapter(line) {
  const questIds = [];
  const raw = line.quests || line['quests:9'] || [];
  const quests = Array.isArray(raw) ? raw : (typeof raw === 'object' ? Object.values(raw) : []);

  function pushQuestId(ref) {
    if (!ref || typeof ref !== 'object') return;
    var inner = ref.value && typeof ref.value === 'object' ? ref.value : ref;
    var id = inner.id ?? inner['id:3'] ?? inner.questID ?? ref.key;
    if (id !== undefined && id !== null) questIds.push(String(id));
  }

  quests.forEach(pushQuestId);
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
      progressSpan.textContent = `${completedCount}/${totalCount} completed`;
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
    // #region agent log
    fetch('http://127.0.0.1:7625/ingest/1e1b655b-08d3-49a3-8143-37203c10b8bb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3f59d1'},body:JSON.stringify({sessionId:'3f59d1',location:'app.js:selectChapter',message:'filter result',data:{chapterId:chapterId,chapterQuestIdsCount:chapter.quests.length,renderedCount:chapterQuests.length},timestamp:Date.now(),hypothesisId:'H4'})}).catch(()=>{});
    // #endregion
    renderQuests(chapterQuests);
  }
}

// Render quest cards in main panel
function renderQuests(quests) {
  questList.innerHTML = '';
  
  if (quests.length === 0) {
    questList.innerHTML = '<p class="placeholder">No quests found in this chapter</p>';
    return;
  }
  
  quests.forEach(quest => {
    const card = createQuestCard(quest);
    questList.appendChild(card);
  });
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

// Create a quest card element
function createQuestCard(quest) {
  const card = document.createElement('div');
  card.className = `quest-card ${quest.completed ? 'completed' : 'incomplete'}`;
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.addEventListener('click', function () { showQuestModal(quest); });
  card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showQuestModal(quest); } });

  // Quest icon
  const iconDiv = document.createElement('div');
  iconDiv.className = 'quest-icon';

  const iconImg = document.createElement('img');
  const iconId = quest.icon.id.replace(':', '_');
  iconImg.src = `icons/${iconId}.png`;
  iconImg.alt = quest.icon.id;
  iconImg.onerror = function() {
    this.style.display = 'none';
    const fallback = document.createElement('span');
    fallback.className = 'fallback-icon';
    fallback.textContent = quest.completed ? '✅' : '📋';
    iconDiv.appendChild(fallback);
  };
  iconDiv.appendChild(iconImg);

  const infoDiv = document.createElement('div');
  infoDiv.className = 'quest-info';

  const nameDiv = document.createElement('div');
  nameDiv.className = 'quest-name';
  var displayName = quest.langTitle != null ? quest.langTitle : quest.name;
  if (displayName.indexOf('§') !== -1) nameDiv.innerHTML = mcColorToHtml(displayName);
  else nameDiv.textContent = displayName;

  const rewardDiv = document.createElement('div');
  rewardDiv.className = 'quest-reward';
  rewardDiv.textContent = `🎁 ${quest.rewards}`;

  const statusDiv = document.createElement('div');
  statusDiv.className = 'quest-status';
  statusDiv.textContent = quest.completed ? '✓ Completed' : '○ Incomplete';

  infoDiv.appendChild(nameDiv);
  infoDiv.appendChild(rewardDiv);
  infoDiv.appendChild(statusDiv);

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
  
  const percentage = Math.round((completedQuests / totalQuests) * 100);
  
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
  var encoded = hash.slice(7); // remove '#share='
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
    banner.textContent = '👁️ Viewing shared progress (read-only) — ' + ids.length + ' completed quests';
    header.appendChild(banner);
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
