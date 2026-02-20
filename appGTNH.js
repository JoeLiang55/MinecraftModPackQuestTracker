/*
  GregTech: New Horizons – Quest Tracker
  Based on appE2E.js but loads quest database from user file upload.
  Player progress read from questprogress.json (BetterQuesting format).
*/

// ── Global state ─────────────────────────────────────────────────────
let questData = null;
let playerData = null;
let mergedQuests = [];
let chapters = [];
let currentChapter = null;

// ── DOM elements ─────────────────────────────────────────────────────
const questFileInput = document.getElementById('questFile');
const playerFileInput = document.getElementById('playerFile');
const chapterNav = document.getElementById('chapterNav');
const questList = document.getElementById('questList');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

questFileInput.addEventListener('change', handleQuestFile);
playerFileInput.addEventListener('change', handlePlayerFile);
initQuestModal();

// ── Quest database upload ────────────────────────────────────────────
function handleQuestFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      questData = JSON.parse(e.target.result);
      console.log('GTNH quest data loaded from file');
      tryMergeAndRender();
    } catch (err) {
      showError('Failed to parse DefaultQuests.json: ' + err.message);
    }
  };
  reader.onerror = function () { showError('Error reading DefaultQuests.json'); };
  reader.readAsText(file, 'utf-8');
}

// ── Minecraft § color-code → HTML ────────────────────────────────────
function mcColorToHtml(str) {
  if (!str || typeof str !== 'string') return '';
  var s = str.replace(/%n%n/g, '\n\n').replace(/%n/g, '\n');
  var out = '';
  var i = 0;
  var openTags = [];
  var mcColors = { '0': '#000000', '1': '#0000aa', '2': '#00aa00', '3': '#00aaaa', '4': '#aa0000', '5': '#aa00aa', '6': '#ffaa00', '7': '#aaaaaa', '8': '#555555', '9': '#5555ff', 'a': '#55ff55', 'b': '#55ffff', 'c': '#ff5555', 'd': '#ff55ff', 'e': '#ffff55', 'f': '#ffffff' };
  while (i < s.length) {
    if (s.charAt(i) === '\u00a7' && i + 1 < s.length) {
      var code = s.charAt(i + 1).toLowerCase();
      i += 2;
      if (code === 'r') { while (openTags.length) { out += '</span>'; openTags.pop(); } continue; }
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

// ── Player file upload (questprogress.json) ──────────────────────────
function handlePlayerFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const text = e.target.result;
      playerData = JSON.parse(text);
      console.log('GTNH quest progress loaded');
      tryMergeAndRender();
    } catch (err) {
      showError('Error parsing questprogress.json: ' + err.message);
    }
  };
  reader.onerror = function () { showError('Error reading questprogress.json'); };
  reader.readAsText(file, 'utf-8');
}

// ── Merge & render ───────────────────────────────────────────────────
function tryMergeAndRender() {
  if (!questData || !playerData) return;
  try {
    var root = questData;
    if (root && typeof root === 'object') {
      if (root.betterquesting) root = root.betterquesting;
      else if (root.data) root = root.data;
      else { var k = Object.keys(root); if (k.length === 1 && typeof root[k[0]] === 'object') root = root[k[0]]; }
    }
    mergeQuestData(root);
    extractChapters(root);
    renderChapters();
    updateProgressBar();
    if (chapters.length > 0) selectChapter(chapters[0].id);
    else renderQuests(mergedQuests);
  } catch (error) {
    showError('Error processing quest data: ' + error.message);
    console.error(error);
  }
}

// ── Merge quest definitions with player completion ───────────────────
function mergeQuestData(root) {
  mergedQuests = [];
  if (!root) root = questData;
  let completedIds = new Set();

  if (window._sharedCompletedIds) {
    window._sharedCompletedIds.forEach(id => completedIds.add(String(id)));
  } else {
    // NBT helper
    function nbtGet(obj, baseName) {
      if (!obj || typeof obj !== 'object') return undefined;
      if (obj[baseName] !== undefined) return obj[baseName];
      var suffixes = [':1',':2',':3',':4',':5',':6',':7',':8',':9',':10',':11',':12'];
      for (var s = 0; s < suffixes.length; s++) { var key = baseName + suffixes[s]; if (obj[key] !== undefined) return obj[key]; }
      return undefined;
    }
    function isTruthy(val) {
      if (val === 1 || val === true || val === '1') return true;
      if (Array.isArray(val) && val.length > 0) return true;
      if (val && typeof val === 'object' && Object.keys(val).length > 0) return true;
      return false;
    }
    function findCompletedQuests(obj, path, depth) {
      if (!obj || typeof obj !== 'object') return;
      if (depth == null) depth = 0;
      if (depth > 20) return;
      var next = depth + 1;
      const addId = (id) => completedIds.add(String(id));

      var cq = nbtGet(obj, 'completedQuests');
      if (cq) { if (Array.isArray(cq)) cq.forEach(id => addId(id)); else if (typeof cq === 'object') Object.keys(cq).forEach(id => addId(id)); }
      var cqi = nbtGet(obj, 'completedQuestIds');
      if (cqi && Array.isArray(cqi)) cqi.forEach(id => addId(id));

      var qp = nbtGet(obj, 'questProgress');
      if (qp && typeof qp === 'object') {
        var qpEntries = Array.isArray(qp) ? qp : Object.values(qp);
        qpEntries.forEach(function (entry) {
          if (!entry || typeof entry !== 'object') return;
          var e = entry.value && typeof entry.value === 'object' ? entry.value : entry;
          var qid = nbtGet(e, 'questID'); if (qid === undefined || qid === null) qid = nbtGet(e, 'id'); if (qid === undefined || qid === null) qid = entry.key; if (qid === undefined || qid === null) return;
          var completedVal = nbtGet(e, 'completed');
          if (isTruthy(completedVal)) { addId(qid); return; }
          var claimedVal = nbtGet(e, 'claimed');
          if (isTruthy(claimedVal)) { addId(qid); return; }
          var tasks = nbtGet(e, 'tasks');
          if (tasks && typeof tasks === 'object') {
            var taskEntries = Array.isArray(tasks) ? tasks : Object.values(tasks);
            var allDone = taskEntries.length > 0;
            taskEntries.forEach(function (task) {
              if (!task || typeof task !== 'object') { allDone = false; return; }
              var t = task.value && typeof task.value === 'object' ? task.value : task;
              var cu = nbtGet(t, 'completeUsers');
              if (!cu || (typeof cu === 'object' && Object.keys(cu).length === 0)) allDone = false;
            });
            if (allDone) addId(qid);
          }
        });
      }

      var qs = nbtGet(obj, 'quests');
      if (qs && typeof qs === 'object' && qs !== qp) {
        Object.entries(qs).forEach(function (kv) {
          var q = kv[1]; if (!q || typeof q !== 'object') return;
          var qq = q.value && typeof q.value === 'object' ? q.value : q;
          if (isTruthy(nbtGet(qq, 'completed')) || isTruthy(nbtGet(qq, 'claimed'))) { addId(nbtGet(qq, 'questID') || kv[0]); }
        });
      }

      var progress = nbtGet(obj, 'UserProgress') || nbtGet(obj, 'PartyProgress');
      if (progress && typeof progress === 'object') {
        Object.entries(progress).forEach(function (kv) {
          var userData = kv[1]; if (!userData || typeof userData !== 'object') return;
          var uQuests = nbtGet(userData, 'quests');
          if (uQuests && typeof uQuests === 'object') {
            Object.entries(uQuests).forEach(function (qkv) {
              var st = qkv[1]; if (!st || typeof st !== 'object') return;
              var ss = st.value && typeof st.value === 'object' ? st.value : st;
              if (isTruthy(nbtGet(ss, 'completed')) || isTruthy(nbtGet(ss, 'claimed'))) addId(qkv[0]);
            });
          }
        });
      }

      if (typeof obj === 'object' && !Array.isArray(obj)) {
        Object.keys(obj).forEach(function (key) {
          var baseKey = key.split(':')[0];
          if (['completedQuests','completedQuestIds','questProgress','UserProgress','PartyProgress','quests'].indexOf(baseKey) !== -1) return;
          if (['tasks','userProgress','completeUsers','data','completed','claimed','timestamp','uuid','taskID','index','questID'].indexOf(baseKey) !== -1) return;
          if (obj[key] && typeof obj[key] === 'object') findCompletedQuests(obj[key], (path ? path + '.' : '') + key, next);
        });
      }
    }
    findCompletedQuests(playerData, '', 0);
  }

  console.log('Completed quest IDs:', completedIds.size);

  // Resolve quest database
  let questDB = root.questDatabase || root.questDB || root['questDatabase:9'] || root.defaultQuests || root.quests;
  if ((!questDB || (typeof questDB === 'object' && Object.keys(questDB).length === 0)) && root && typeof root === 'object') {
    var rootKeys = Object.keys(root); var best = null; var bestSize = 0;
    for (var i = 0; i < rootKeys.length; i++) {
      var val = root[rootKeys[i]]; if (!val || typeof val !== 'object') continue;
      var size = Array.isArray(val) ? val.length : Object.keys(val).length;
      if (size > bestSize && size > 0) {
        var sample = Array.isArray(val) ? val[0] : val[Object.keys(val)[0]];
        if (sample && typeof sample === 'object') {
          var inner = sample.value && typeof sample.value === 'object' ? sample.value : sample;
          if (inner.properties != null || inner['properties:10'] != null || inner.name != null || inner.questID != null) { best = val; bestSize = size; }
        }
      }
    }
    if (best) questDB = best;
  }
  if (!questDB) questDB = root;

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

function processQuest(quest, completedIds) {
  const rawId = quest.questID !== undefined ? quest.questID : (quest.id !== undefined ? quest.id : quest['questID:3']);
  const questId = rawId !== undefined && rawId !== null ? String(rawId) : '';
  if (questId === '' || questId === 'undefined') return;
  const properties = quest.properties || quest['properties:10'] || {};
  const bqProps = properties.betterquesting || properties['betterquesting:10'] || properties;
  var rawName = bqProps.name || bqProps['name:8'] || quest.name || '';
  var displayName = rawName || ('Quest ' + questId);
  var rawDesc = bqProps.desc || bqProps['desc:8'] || quest.description || '';
  mergedQuests.push({
    id: questId,
    name: displayName,
    description: rawDesc,
    icon: extractIcon(quest),
    rewards: extractRewards(quest),
    chapterId: quest.chapterId || quest.lineId || null,
    completed: completedIds.has(questId)
  });
}

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
        rewardList.push(count + 'x ' + formatItemName(itemId));
      });
    } else if (reward.rewardID === 'bq_standard:xp' || reward['rewardID:8'] === 'bq_standard:xp') {
      const xp = reward.amount || reward['amount:3'] || 0;
      if (xp > 0) rewardList.push(xp + ' XP');
    }
  };
  if (Array.isArray(rewards)) rewards.forEach(processRewardEntry);
  else if (typeof rewards === 'object') Object.values(rewards).forEach(processRewardEntry);
  return rewardList.length > 0 ? rewardList.join(', ') : 'No rewards';
}

function formatItemName(itemId) {
  const name = itemId.includes(':') ? itemId.split(':')[1] : itemId;
  return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ── Chapters ─────────────────────────────────────────────────────────
function extractChapters(root) {
  chapters = [];
  if (!root) root = questData;
  const questLines = root.questLines || root['questLines:9'] || {};

  function chapterName(line, fallback) {
    if (!line) return fallback;
    var props = line.properties || line['properties:10'] || {};
    var bq = props.betterquesting || props['betterquesting:10'] || {};
    return line.name || line['name:8'] || bq.name || bq['name:8'] || fallback;
  }
  function unwrapLine(entry) { return entry && entry.value && typeof entry.value === 'object' ? entry.value : entry; }

  if (Array.isArray(questLines)) {
    questLines.forEach((entry, index) => {
      var line = unwrapLine(entry);
      var lineId = String(line.lineID ?? line.id ?? (entry && 'key' in entry ? entry.key : index));
      chapters.push({ id: lineId, name: chapterName(line, 'Chapter ' + (index + 1)), quests: getQuestsForChapter(line) });
    });
  } else if (typeof questLines === 'object') {
    Object.entries(questLines).forEach(([id, entry]) => {
      var line = unwrapLine(entry);
      chapters.push({ id: id, name: chapterName(line, 'Chapter ' + id), quests: getQuestsForChapter(line) });
    });
  }

  const allQuestIds = mergedQuests.map(q => q.id);
  chapters.unshift({ id: 'all', name: 'All Quests', quests: allQuestIds });
  console.log('GTNH chapters:', chapters.length);
}

function getQuestsForChapter(line) {
  const questIds = [];
  const raw = line.quests || line['quests:9'] || [];
  const quests = Array.isArray(raw) ? raw : (typeof raw === 'object' ? Object.values(raw) : []);
  quests.forEach(function (ref) {
    if (!ref || typeof ref !== 'object') return;
    var inner = ref.value && typeof ref.value === 'object' ? ref.value : ref;
    var id = inner.id ?? inner['id:3'] ?? inner.questID ?? ref.key;
    if (id !== undefined && id !== null) questIds.push(String(id));
  });
  return questIds;
}

// ── Render sidebar ───────────────────────────────────────────────────
function renderChapters() {
  chapterNav.innerHTML = '';
  chapters.forEach(chapter => {
    const li = document.createElement('li');
    li.dataset.chapterId = chapter.id;
    var label = document.createElement('span');
    label.className = 'chapter-label';
    label.textContent = chapter.name;
    li.appendChild(label);
    const chapterQuests = mergedQuests.filter(q => chapter.quests.includes(q.id));
    const completedCount = chapterQuests.filter(q => q.completed).length;
    if (chapterQuests.length > 0) {
      const prog = document.createElement('div');
      prog.className = 'chapter-progress';
      prog.textContent = completedCount + '/' + chapterQuests.length + ' completed';
      li.appendChild(prog);
    }
    li.addEventListener('click', () => selectChapter(chapter.id));
    chapterNav.appendChild(li);
  });
}

function selectChapter(chapterId) {
  currentChapter = chapterId;
  document.querySelectorAll('#chapterNav li').forEach(li => {
    li.classList.toggle('active', li.dataset.chapterId === chapterId);
  });
  const chapter = chapters.find(c => c.id === chapterId);
  if (chapter) {
    var chapterQuests = mergedQuests.filter(q => chapter.quests.includes(q.id));
    chapterQuests.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
    renderQuests(chapterQuests);
  }
}

function renderQuests(quests) {
  questList.innerHTML = '';
  if (quests.length === 0) { questList.innerHTML = '<p class="placeholder">No quests found in this chapter</p>'; return; }
  quests.forEach(quest => questList.appendChild(createQuestCard(quest)));
}

// ── Quest modal ──────────────────────────────────────────────────────
function showQuestModal(quest) {
  var modal = document.getElementById('questModal');
  var titleEl = document.getElementById('questModalTitle');
  var descEl = document.getElementById('questModalDesc');
  if (!modal || !titleEl || !descEl) return;
  var titleStr = quest.name;
  var descStr = quest.description || 'No description.';
  if (titleStr.indexOf('\u00a7') !== -1) titleEl.innerHTML = mcColorToHtml(titleStr); else titleEl.textContent = titleStr;
  if (descStr.indexOf('\u00a7') !== -1 || descStr.indexOf('%n') !== -1) descEl.innerHTML = mcColorToHtml(descStr); else descEl.textContent = descStr;
  descEl.style.whiteSpace = 'pre-wrap';
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}
function hideQuestModal() {
  var modal = document.getElementById('questModal');
  if (modal) { modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); }
}
function initQuestModal() {
  var modal = document.getElementById('questModal');
  var backdrop = modal && modal.querySelector('.quest-modal-backdrop');
  var closeBtn = modal && modal.querySelector('.quest-modal-close');
  if (backdrop) backdrop.addEventListener('click', hideQuestModal);
  if (closeBtn) closeBtn.addEventListener('click', hideQuestModal);
}

// ── Quest card ───────────────────────────────────────────────────────
function createQuestCard(quest) {
  const card = document.createElement('div');
  card.className = 'quest-card ' + (quest.completed ? 'completed' : 'incomplete');
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.addEventListener('click', function () { showQuestModal(quest); });
  card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showQuestModal(quest); } });

  const iconDiv = document.createElement('div');
  iconDiv.className = 'quest-icon';
  const iconImg = document.createElement('img');
  iconImg.src = 'icons/' + quest.icon.id.replace(':', '_') + '.png';
  iconImg.alt = quest.icon.id;
  iconImg.onerror = function () {
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
  if (quest.name.indexOf('\u00a7') !== -1) nameDiv.innerHTML = mcColorToHtml(quest.name); else nameDiv.textContent = quest.name;

  const rewardDiv = document.createElement('div');
  rewardDiv.className = 'quest-reward';
  rewardDiv.textContent = '\uD83C\uDF81 ' + quest.rewards;

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

// ── Progress bar ─────────────────────────────────────────────────────
function updateProgressBar() {
  const total = mergedQuests.length;
  const done = mergedQuests.filter(q => q.completed).length;
  if (total === 0) { progressContainer.style.display = 'none'; return; }
  const pct = Math.round((done / total) * 100);
  progressContainer.style.display = 'flex';
  progressFill.style.width = pct + '%';
  progressText.textContent = done + '/' + total + ' (' + pct + '%)';
}

function showError(message) {
  questList.innerHTML = '<div class="error-message">' + message + '</div>';
  console.error(message);
}

// ── Sharing ──────────────────────────────────────────────────────────
function encodeShareData() {
  var ids = mergedQuests.filter(q => q.completed).map(q => q.id);
  if (ids.length === 0) return null;
  var json = JSON.stringify(ids);
  var compressed = pako.deflate(json);
  var binary = '';
  for (var i = 0; i < compressed.length; i++) binary += String.fromCharCode(compressed[i]);
  var b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeShareData(encoded) {
  try {
    var b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return JSON.parse(pako.inflate(bytes, { to: 'string' }));
  } catch (e) { console.error('Failed to decode share data:', e); return null; }
}

function generateShareLink() {
  var encoded = encodeShareData();
  if (!encoded) { alert('No completed quests to share.'); return; }
  var url = window.location.origin + window.location.pathname + '#share=' + encoded;
  if (window._playerDisplayName) url += '&player=' + encodeURIComponent(window._playerDisplayName);
  var banner = document.getElementById('shareBanner');
  var urlInput = document.getElementById('shareUrl');
  if (banner && urlInput) { urlInput.value = url; banner.style.display = 'flex'; navigator.clipboard.writeText(url).catch(function () {}); }
}

function checkForSharedProgress() {
  var hash = window.location.hash;
  if (!hash || !hash.startsWith('#share=')) return false;
  var parts = hash.slice(7).split('&');
  var encoded = parts[0];
  var sharedPlayerName = null;
  for (var p = 1; p < parts.length; p++) { if (parts[p].startsWith('player=')) sharedPlayerName = decodeURIComponent(parts[p].slice(7)); }
  if (!encoded) return false;
  var ids = decodeShareData(encoded);
  if (!ids || !Array.isArray(ids) || ids.length === 0) return false;
  window._sharedCompletedIds = new Set(ids.map(String));
  playerData = { _shared: true, completedQuests: ids.map(id => ({ id: id })) };
  var fileInputs = document.querySelector('.file-inputs');
  if (fileInputs) fileInputs.style.display = 'none';
  var header = document.querySelector('header');
  if (header) {
    var banner = document.createElement('div');
    banner.className = 'shared-mode-banner';
    banner.textContent = sharedPlayerName
      ? ('\uD83D\uDC41\uFE0F Viewing ' + sharedPlayerName + "'s progress (read-only) \u2014 " + ids.length + ' completed quests')
      : ('\uD83D\uDC41\uFE0F Viewing shared progress (read-only) \u2014 ' + ids.length + ' completed quests');
    header.appendChild(banner);
  }
  if (sharedPlayerName) {
    var display = document.getElementById('playerNameDisplay');
    var textEl = document.getElementById('playerNameText');
    if (display && textEl) { textEl.textContent = sharedPlayerName; display.style.display = 'flex'; }
    window._playerDisplayName = sharedPlayerName;
  }
  console.log('Loaded shared progress:', ids.length, 'quests');
  return true;
}

(function initSharing() {
  checkForSharedProgress();
  var shareBtn = document.getElementById('shareBtn');
  var copyBtn = document.getElementById('shareCopyBtn');
  if (shareBtn) shareBtn.addEventListener('click', generateShareLink);
  if (copyBtn) copyBtn.addEventListener('click', function () {
    var urlInput = document.getElementById('shareUrl');
    if (urlInput) navigator.clipboard.writeText(urlInput.value).then(function () { copyBtn.textContent = 'Copied!'; setTimeout(function () { copyBtn.textContent = 'Copy'; }, 2000); });
  });
  var origUpdate = updateProgressBar;
  updateProgressBar = function () { origUpdate(); if (mergedQuests.length > 0 && shareBtn && !window._sharedCompletedIds) shareBtn.style.display = 'inline-block'; };
})();
