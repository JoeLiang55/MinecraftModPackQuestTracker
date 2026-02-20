/*
  GregTech: New Horizons Quest Tracker (New)
  Based on Better_Online_QuestBook structure with completion tracking
*/

// ── Global State ─────────────────────────────────────────────────────
let questLines = [];
let questData = {};
let playerProgress = null;
let completedQuestIds = new Set();
let currentQuestLine = null;

// Icon system
let iconMapping = {}; // Maps quest IDs to their atlas category
let loadedAtlases = {}; // Cache of loaded icon data {atlasName: {iconId: base64data}}
let iconLoadQueue = {}; // Queue of images waiting for atlas to load

// ── DOM Elements ─────────────────────────────────────────────────────
const questLineSelect = document.getElementById('questLineSelect');
const questContainer = document.getElementById('questContainer');
const playerFileInput = document.getElementById('playerFile');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const overallProgressContainer = document.getElementById('overallProgressContainer');
const overallProgressFill = document.getElementById('overallProgressFill');
const overallProgressText = document.getElementById('overallProgressText');

// ── Initialize ───────────────────────────────────────────────────────
async function init() {
  try {
    // Check for shared progress first
    checkForSharedProgress();
    
    // Load icon mapping
    await loadIconMapping();
    
    // Load quest lines
    await loadQuestLines();
    
    // Load quest data
    await loadQuestData();
    
    // Setup event listeners
    questLineSelect.addEventListener('change', handleQuestLineChange);
    playerFileInput.addEventListener('change', handlePlayerFileUpload);
    initQuestModal();
    initSharing();
    
    // Select first quest line by default
    if (questLines.length > 0) {
      questLineSelect.value = questLines[0].quest;
      handleQuestLineChange();
    }
  } catch (error) {
    showError('Failed to initialize: ' + error.message);
    console.error(error);
  }
}

// ── Base64 to Decimal Conversion ────────────────────────────────────
function processBase64ToDecimal(strId) {
  // Convert URL-safe base64 to standard base64
  const std = strId
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(strId.length + ((4 - (strId.length % 4)) % 4), '=');
  
  // Decode base64 to bytes
  const bin = atob(std);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  
  // Convert to hex and take last 16 chars (lower 64 bits)
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const last16 = hex.slice(-16);
  const u64 = BigInt('0x' + last16);
  
  // Handle signed conversion
  return u64 >> 63n ? String(u64 - (1n << 64n)) : String(u64);
}

// ── Load Icon Mapping ────────────────────────────────────────────────
async function loadIconMapping() {
  try {
    const response = await fetch('gtnh/quests_icons.json');
    if (!response.ok) throw new Error('Failed to load icon mapping');
    const mapping = await response.json();
    
    // Build reverse mapping: questId -> atlasName
    for (const [atlasPath, questIds] of Object.entries(mapping)) {
      // atlasPath looks like "QuestIcon/AndSoItBegins"
      const atlasName = atlasPath.split('/')[1]; // Extract "AndSoItBegins"
      
      if (Array.isArray(questIds)) {
        questIds.forEach(questId => {
          iconMapping[String(questId)] = atlasName;
        });
      }
    }
    
    console.log('Loaded icon mapping for', Object.keys(iconMapping).length, 'quests');
  } catch (error) {
    console.error('Error loading icon mapping:', error);
    // Non-fatal, continue without icons
  }
}

// ── Load Icon Atlas (GTBL file) ──────────────────────────────────────
async function loadIconAtlas(atlasName) {
  // Check if already loaded or loading
  if (loadedAtlases[atlasName]) return loadedAtlases[atlasName];
  if (iconLoadQueue[atlasName] === 'loading') {
    // Wait for it to finish loading
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (loadedAtlases[atlasName]) {
          clearInterval(checkInterval);
          resolve(loadedAtlases[atlasName]);
        }
      }, 100);
    });
  }
  
  iconLoadQueue[atlasName] = 'loading';
  
  try {
    const response = await fetch(`gtnh/quests_icons/QuestIcon/${atlasName}.gtbl`);
    if (!response.ok) throw new Error(`Failed to load ${atlasName}`);
    
    const arrayBuffer = await response.arrayBuffer();
    const decompressed = pako.ungzip(new Uint8Array(arrayBuffer), { to: 'string' });
    const iconData = JSON.parse(decompressed);
    
    // Cache the loaded icons
    loadedAtlases[atlasName] = iconData;
    
    console.log(`Loaded ${atlasName} atlas with ${Object.keys(iconData).length} icons`);
    
    // Process any queued images for this atlas
    if (iconLoadQueue[atlasName] && Array.isArray(iconLoadQueue[atlasName])) {
      iconLoadQueue[atlasName].forEach(({ img, numericId }) => {
        if (iconData[numericId]) {
          img.src = `data:image/webp;base64,${iconData[numericId]}`;
        }
      });
    }
    
    delete iconLoadQueue[atlasName];
    return iconData;
    
  } catch (error) {
    console.error(`Error loading atlas ${atlasName}:`, error);
    delete iconLoadQueue[atlasName];
    return null;
  }
}

// ── Set Quest Icon ───────────────────────────────────────────────────
async function setQuestIcon(img, questId) {
  // Convert base64 quest ID to decimal number for icon lookup
  let numericId;
  try {
    numericId = processBase64ToDecimal(questId);
  } catch (error) {
    console.warn('Failed to convert quest ID:', questId, error);
    img.style.display = 'none';
    return false;
  }
  
  const atlasName = iconMapping[numericId];
  
  if (!atlasName) {
    // No icon found, show fallback
    img.style.display = 'none';
    return false;
  }
  
  // Check if atlas is already loaded
  if (loadedAtlases[atlasName]) {
    const iconData = loadedAtlases[atlasName][numericId];
    if (iconData) {
      img.src = `data:image/webp;base64,${iconData}`;
      return true;
    }
  }
  
  // Queue this image and load the atlas
  if (!iconLoadQueue[atlasName]) {
    iconLoadQueue[atlasName] = [];
  }
  if (Array.isArray(iconLoadQueue[atlasName])) {
    iconLoadQueue[atlasName].push({ img, numericId });
  }
  
  // Load the atlas
  const atlas = await loadIconAtlas(atlasName);
  if (atlas && atlas[numericId]) {
    img.src = `data:image/webp;base64,${atlas[numericId]}`;
    return true;
  }
  
  return false;
}

// ── Load Quest Lines ─────────────────────────────────────────────────
async function loadQuestLines() {
  try {
    const response = await fetch('gtnh/quest_line.json');
    if (!response.ok) throw new Error('Failed to load quest lines');
    questLines = await response.json();
    
    // Populate select dropdown
    questLineSelect.innerHTML = '';
    questLines.forEach(line => {
      const option = document.createElement('option');
      option.value = line.quest;
      option.textContent = line.title;
      questLineSelect.appendChild(option);
    });
    
    console.log('Loaded', questLines.length, 'quest lines');
  } catch (error) {
    console.error('Error loading quest lines:', error);
    throw error;
  }
}

// ── Load Quest Data ──────────────────────────────────────────────────
async function loadQuestData() {
  try {
    const response = await fetch('gtnh/quest_json_en.json');
    if (!response.ok) throw new Error('Failed to load quest data');
    questData = await response.json();
    
    console.log('Loaded quest data:', Object.keys(questData).length, 'quest lines');
  } catch (error) {
    console.error('Error loading quest data:', error);
    throw error;
  }
}

// ── Handle Quest Line Selection ──────────────────────────────────────
function handleQuestLineChange() {
  const selectedLine = questLineSelect.value;
  if (!selectedLine) return;
  
  currentQuestLine = selectedLine;
  renderQuestLine(selectedLine);
  updateProgressBar();
}

// ── Render Quest Line ────────────────────────────────────────────────
function renderQuestLine(questLineName) {
  const lineData = questData[questLineName];
  
  if (!lineData || !lineData.data) {
    questContainer.innerHTML = '<div class="loading-message">No quests found for this line</div>';
    return;
  }
  
  // Create grid container
  questContainer.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'quest-grid';
  
  // Render each quest
  lineData.data.forEach(quest => {
    const questNode = createQuestNode(quest);
    grid.appendChild(questNode);
  });
  
  questContainer.appendChild(grid);
}

// ── Create Quest Node ────────────────────────────────────────────────
function createQuestNode(quest) {
  const node = document.createElement('div');
  const questId = quest.quest_id || quest.name;
  
  // Try to match quest ID in multiple formats
  let isCompleted = completedQuestIds.has(String(questId));
  
  // If not found, try converting base64 to decimal and check
  if (!isCompleted && questId && questId.length > 10) {
    try {
      const decimalId = processBase64ToDecimal(questId);
      isCompleted = completedQuestIds.has(decimalId);
    } catch (e) {
      // Not a base64 ID, ignore
    }
  }
  
  node.className = 'quest-node' + (isCompleted ? ' completed' : '');
  node.addEventListener('click', () => showQuestModal(quest));
  
  // Add completion badge for completed quests
  if (isCompleted) {
    const badge = document.createElement('div');
    badge.className = 'quest-completion-badge';
    badge.innerHTML = '✓';
    badge.title = 'Completed';
    node.appendChild(badge);
  }
  
  // Icon container
  const iconDiv = document.createElement('div');
  iconDiv.className = 'quest-node-icon';
  
  // Create image element and try to load icon
  const img = document.createElement('img');
  img.alt = quest.title || 'Quest icon';
  img.style.imageRendering = 'pixelated';
  
  // Try to load the icon from atlas
  setQuestIcon(img, questId).then(success => {
    if (!success) {
      // Show fallback emoji
      img.style.display = 'none';
      const fallback = document.createElement('span');
      fallback.textContent = isCompleted ? '✅' : '📋';
      fallback.style.fontSize = '24px';
      iconDiv.appendChild(fallback);
    }
  });
  
  iconDiv.appendChild(img);
  
  // Title
  const title = document.createElement('div');
  title.className = 'quest-node-title';
  title.innerHTML = mcColorToHtml(quest.title || quest.name || 'Unknown Quest');
  
  node.appendChild(iconDiv);
  node.appendChild(title);
  
  return node;
}

// ── Minecraft Color Codes ────────────────────────────────────────────
function mcColorToHtml(str) {
  if (!str || typeof str !== 'string') return '';
  
  const mcColors = {
    '0': '#000000', '1': '#0000aa', '2': '#00aa00', '3': '#00aaaa',
    '4': '#aa0000', '5': '#aa00aa', '6': '#ffaa00', '7': '#aaaaaa',
    '8': '#555555', '9': '#5555ff', 'a': '#55ff55', 'b': '#55ffff',
    'c': '#ff5555', 'd': '#ff55ff', 'e': '#ffff55', 'f': '#ffffff'
  };
  
  let result = '';
  let i = 0;
  let openTags = [];
  
  // Replace newline markers
  str = str.replace(/%n%n/g, '\n\n').replace(/%n/g, '\n');
  
  while (i < str.length) {
    if (str.charAt(i) === '§' && i + 1 < str.length) {
      const code = str.charAt(i + 1).toLowerCase();
      i += 2;
      
      if (code === 'r') {
        while (openTags.length) {
          result += '</span>';
          openTags.pop();
        }
        continue;
      }
      
      if (mcColors[code]) {
        while (openTags.length) {
          result += '</span>';
          openTags.pop();
        }
        result += '<span style="color:' + mcColors[code] + '">';
        openTags.push('span');
      }
      continue;
    }
    
    if (str.charAt(i) === '\n') {
      result += '<br>';
      i++;
      continue;
    }
    
    result += str.charAt(i).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    i++;
  }
  
  while (openTags.length) {
    result += '</span>';
    openTags.pop();
  }
  
  return result;
}

// ── Player File Upload ───────────────────────────────────────────────
async function handlePlayerFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  try {
    const text = await file.text();
    let data;
    
    try {
      data = JSON.parse(text);
    } catch (e) {
      showError('Invalid JSON file. Please upload a valid quest progress file.');
      return;
    }
    
    playerProgress = data;
    parsePlayerProgress(data);
    
    // Re-render current quest line
    if (currentQuestLine) {
      renderQuestLine(currentQuestLine);
      updateProgressBar();
    }
    
    // Show share button
    const shareBtn = document.getElementById('shareBtn');
    if (shareBtn) shareBtn.style.display = 'inline-block';
    
    console.log('Player progress loaded. Completed quests:', completedQuestIds.size);
    console.log('Sample completed IDs:', Array.from(completedQuestIds).slice(0, 10));
  } catch (error) {
    showError('Error loading player file: ' + error.message);
    console.error(error);
  }
}

// ── Parse Player Progress ────────────────────────────────────────────
function parsePlayerProgress(data) {
  completedQuestIds.clear();
  
  console.log('=== Parsing Player Progress (BetterQuesting Format) ===');
  console.log('Player data structure:', Object.keys(data));
  
  // Helper to convert two 64-bit integers to base64 quest ID
  function combineQuestId(high, low) {
    // Convert signed integers to unsigned
    const highU = BigInt.asUintN(64, BigInt(high));
    const lowU = BigInt.asUintN(64, BigInt(low));
    
    // Combine into 128-bit value (high << 64 | low)
    const combined = (highU << 64n) | lowU;
    
    // Convert to 16-byte array
    const bytes = new Uint8Array(16);
    for (let i = 15; i >= 0; i--) {
      bytes[i] = Number(combined >> BigInt((15 - i) * 8) & 0xFFn);
    }
    
    // Convert to base64
    const binary = String.fromCharCode.apply(null, Array.from(bytes));
    return btoa(binary);
  }
  
  // Parse BetterQuesting questProgress:9 format
  const questProgress = data['questProgress:9'];
  
  if (!questProgress) {
    console.warn('No questProgress:9 found in data');
    return;
  }
  
  console.log('Found questProgress with', Object.keys(questProgress).length, 'entries');
  
  // Iterate through quest progress entries
  for (const [key, entry] of Object.entries(questProgress)) {
    if (!entry || typeof entry !== 'object') continue;
    
    // Extract quest ID components
    const questIDHigh = entry['questIDHigh:4'];
    const questIDLow = entry['questIDLow:4'];
    
    // Check if quest is completed
    const completed = entry['completed:9'];
    const isCompleted = completed && typeof completed === 'object' && Object.keys(completed).length > 0;
    
    if (isCompleted && questIDHigh !== undefined && questIDLow !== undefined) {
      try {
        // Convert to base64 format to match quest_json_en.json
        const questIdBase64 = combineQuestId(questIDHigh, questIDLow);
        completedQuestIds.add(questIdBase64);
        console.log(`Quest ${key}: High=${questIDHigh}, Low=${questIDLow} -> ${questIdBase64}`);
      } catch (error) {
        console.error(`Failed to convert quest ID for entry ${key}:`, error);
      }
    }
  }
  
  console.log('=== Parsing Complete ===');
  console.log('Total completed quest IDs found:', completedQuestIds.size);
  console.log('Sample IDs:', Array.from(completedQuestIds).slice(0, 5));
}

// ── Quest Modal ──────────────────────────────────────────────────────
function showQuestModal(quest) {
  const modal = document.getElementById('questModal');
  const title = document.getElementById('questModalTitle');
  const desc = document.getElementById('questModalDesc');
  const icon = document.getElementById('questModalIcon');
  const questIdEl = document.getElementById('questModalId');
  
  if (!modal || !title || !desc) return;
  
  const questId = quest.quest_id || quest.name;
  const isCompleted = completedQuestIds.has(String(questId));
  
  title.innerHTML = mcColorToHtml(quest.title || quest.name || 'Unknown Quest');
  if (isCompleted) {
    title.style.color = '#00e08a';
    title.innerHTML = '✓ ' + title.innerHTML;
  } else {
    title.style.color = '#e0e0e0';
  }
  
  desc.innerHTML = mcColorToHtml(quest.data || 'No description available.');
  
  // Show completion status instead of quest ID
  if (isCompleted) {
    questIdEl.innerHTML = '<span style="color: #00e08a; font-weight: bold;">✓ COMPLETED</span>';
    questIdEl.style.textAlign = 'center';
    questIdEl.style.fontSize = '1rem';
  } else {
    questIdEl.innerHTML = '';
  }
  
  // Show icon
  icon.innerHTML = '';
  const img = document.createElement('img');
  img.style.maxWidth = '64px';
  img.style.maxHeight = '64px';
  img.style.imageRendering = 'pixelated';
  
  setQuestIcon(img, questId).then(success => {
    if (!success) {
      img.style.display = 'none';
      const fallback = document.createElement('span');
      fallback.textContent = isCompleted ? '✅' : '📋';
      fallback.style.fontSize = '48px';
      icon.appendChild(fallback);
    }
  });
  
  icon.appendChild(img);
  
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function hideQuestModal() {
  const modal = document.getElementById('questModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function initQuestModal() {
  const modal = document.getElementById('questModal');
  const backdrop = modal?.querySelector('.quest-modal-backdrop');
  const closeBtn = modal?.querySelector('.quest-modal-close');
  
  if (backdrop) backdrop.addEventListener('click', hideQuestModal);
  if (closeBtn) closeBtn.addEventListener('click', hideQuestModal);
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideQuestModal();
  });
}

// ── Progress Bar ─────────────────────────────────────────────────────
function updateProgressBar() {
  // Update overall progress (all quest lines)
  updateOverallProgress();
  
  // Update current quest line progress
  if (!currentQuestLine || !questData[currentQuestLine]) {
    progressContainer.style.display = 'none';
    return;
  }
  
  const lineData = questData[currentQuestLine];
  const quests = lineData.data || [];
  const total = quests.length;
  const completed = quests.filter(q => {
    const qid = q.quest_id || q.name;
    return completedQuestIds.has(String(qid));
  }).length;
  
  if (total === 0) {
    progressContainer.style.display = 'none';
    return;
  }
  
  const percentage = Math.round((completed / total) * 100);
  
  progressContainer.style.display = 'flex';
  progressFill.style.width = percentage + '%';
  progressText.textContent = completed + '/' + total + ' (' + percentage + '%)';
}

function updateOverallProgress() {
  if (!questData || Object.keys(questData).length === 0) {
    overallProgressContainer.style.display = 'none';
    return;
  }
  
  let totalQuests = 0;
  let completedQuests = 0;
  
  // Count all quests across all quest lines
  for (const [lineName, lineData] of Object.entries(questData)) {
    if (lineData && lineData.data && Array.isArray(lineData.data)) {
      lineData.data.forEach(quest => {
        totalQuests++;
        const qid = quest.quest_id || quest.name;
        if (completedQuestIds.has(String(qid))) {
          completedQuests++;
        }
      });
    }
  }
  
  if (totalQuests === 0) {
    overallProgressContainer.style.display = 'none';
    return;
  }
  
  const percentage = Math.round((completedQuests / totalQuests) * 100);
  
  overallProgressContainer.style.display = 'flex';
  overallProgressFill.style.width = percentage + '%';
  overallProgressText.textContent = completedQuests + '/' + totalQuests + ' (' + percentage + '%)';
}

// ── Sharing ──────────────────────────────────────────────────────────
function initSharing() {
  const shareBtn = document.getElementById('shareBtn');
  const copyBtn = document.getElementById('shareCopyBtn');
  
  if (shareBtn) shareBtn.addEventListener('click', generateShareLink);
  if (copyBtn) copyBtn.addEventListener('click', copyShareLink);
}

function generateShareLink() {
  if (completedQuestIds.size === 0) {
    alert('No completed quests to share.');
    return;
  }
  
  const ids = Array.from(completedQuestIds);
  const json = JSON.stringify(ids);
  const compressed = pako.deflate(json);
  const binary = String.fromCharCode.apply(null, compressed);
  const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  
  const url = window.location.origin + window.location.pathname + '#share=' + b64;
  
  const banner = document.getElementById('shareBanner');
  const urlInput = document.getElementById('shareUrl');
  
  if (banner && urlInput) {
    urlInput.value = url;
    banner.style.display = 'flex';
    navigator.clipboard.writeText(url).catch(() => {});
  }
}

function copyShareLink() {
  const urlInput = document.getElementById('shareUrl');
  const copyBtn = document.getElementById('shareCopyBtn');
  
  if (urlInput) {
    navigator.clipboard.writeText(urlInput.value).then(() => {
      if (copyBtn) {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = originalText;
        }, 2000);
      }
    });
  }
}

function checkForSharedProgress() {
  const hash = window.location.hash;
  if (!hash || !hash.startsWith('#share=')) return false;
  
  try {
    const encoded = hash.slice(7);
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - b64.length % 4) % 4);
    const binary = atob(b64 + padding);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    
    const json = pako.inflate(bytes, { to: 'string' });
    const ids = JSON.parse(json);
    
    if (Array.isArray(ids)) {
      ids.forEach(id => completedQuestIds.add(String(id)));
      
      // Hide file input and show banner
      const fileInputs = document.querySelector('.file-inputs');
      if (fileInputs) fileInputs.style.display = 'none';
      
      const header = document.querySelector('header');
      if (header) {
        const banner = document.createElement('div');
        banner.className = 'shared-mode-banner';
        banner.textContent = '👁️ Viewing shared progress (read-only) — ' + ids.length + ' completed quests';
        header.appendChild(banner);
      }
      
      console.log('Loaded shared progress:', ids.length, 'quests');
      return true;
    }
  } catch (error) {
    console.error('Failed to decode shared progress:', error);
  }
  
  return false;
}

// ── Error Display ────────────────────────────────────────────────────
function showError(message) {
  questContainer.innerHTML = '<div class="error-banner">' + message + '</div>';
  console.error(message);
}

// ── Initialize on Load ───────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);
