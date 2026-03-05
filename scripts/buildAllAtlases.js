const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Load quest data
const data = JSON.parse(fs.readFileSync('defaultquests/DefaultQuestsNomifactory.json', 'utf8'));
const questDB = data['questDatabase:9'];
const questLines = data['questLines:9'];

// Load icon map
const iconMapData = JSON.parse(fs.readFileSync('nomi-icon-map.json', 'utf8'));
const iconMap = iconMapData.iconMap || {};

// Ensure output directories exist
const outputDir = 'nomi/quests_icons/QuestIcon';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const mapping = {};
let totalIconsFound = 0;
let totalQuests = 0;

// Helper to sanitize chapter names for filenames
function sanitizeName(name) {
  return (name || 'Unknown')
    .replace(/&/g, '')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_');
}

// Process each chapter
for (const [lineKey, lineData] of Object.entries(questLines)) {
  const line = lineData && lineData.value ? lineData.value : lineData;
  if (!line) continue;
  
  const props = line.properties || line['properties:10'] || {};
  const bq = props.betterquesting || props['betterquesting:10'] || {};
  const rawName = line.name || line['name:8'] || bq.name || bq['name:8'] || `Chapter_${lineKey}`;
  const atlasName = sanitizeName(rawName);
  
  const quests = line.quests || line['quests:9'] || [];
  const questRefs = Array.isArray(quests) ? quests : Object.values(quests);
  
  const questIds = [];
  questRefs.forEach(ref => {
    const inner = ref.value && typeof ref.value === 'object' ? ref.value : ref;
    const id = inner.id ?? inner['id:3'] ?? inner.questID ?? ref.key;
    if (id !== undefined && id !== null) questIds.push(String(id));
  });
  
  if (questIds.length === 0) continue;
  
  console.log(`Building atlas for ${atlasName} (${questIds.length} quests)...`);
  
  const atlasData = {};
  let foundCount = 0;
  
  questIds.forEach(qid => {
    totalQuests++;
    // Find quest in DB
    let quest = null;
    if (Array.isArray(questDB)) {
      const entry = questDB.find(e => {
        const q = e.value || e;
        return String(q.questID ?? q.id ?? q['questID:3'] ?? e.key) === qid;
      });
      if (entry) quest = entry.value || entry;
    } else {
      for (const [k, v] of Object.entries(questDB)) {
        const q = v.value || v;
        if (String(q.questID ?? q.id ?? q['questID:3'] ?? k) === qid) {
          quest = q;
          break;
        }
      }
    }
    
    if (!quest) return;
    
    const qProps = quest.properties || quest['properties:10'] || {};
    const qBq = qProps.betterquesting || qProps['betterquesting:10'] || {};
    const icon = qBq.icon || qBq['icon:10'] || quest.icon || quest['icon:10'] || {};
    
    const iconId = icon.id || icon['id:8'] || 'minecraft:book';
    const damage = icon.Damage || icon['Damage:2'] || 0;
    
    // Try to find in iconMap
    let texturePath = null;
    const isFluid = iconId.startsWith('fluid:');
    const fullId = (!isFluid && damage !== 0) ? `${iconId}:${damage}` : iconId;
    
    if (iconMap[fullId]) {
      texturePath = iconMap[fullId];
    } else if (!isFluid && damage !== 0 && iconMap[iconId]) {
      texturePath = iconMap[iconId];
    }
    
    // Fallback to old logic if not in map
    if (!texturePath) {
      const oldPath = 'icons_nomi/' + iconId.replace(':', '_') + '.png';
      if (fs.existsSync(oldPath)) {
        texturePath = oldPath;
      }
    }
    
    if (texturePath && fs.existsSync(texturePath)) {
      try {
        const pngBuffer = fs.readFileSync(texturePath);
        const base64 = pngBuffer.toString('base64');
        atlasData[qid] = base64;
        foundCount++;
        totalIconsFound++;
      } catch (e) {
        console.error(`Error reading ${texturePath}:`, e.message);
      }
    }
  });
  
  if (foundCount > 0) {
    // Compress and save
    const jsonStr = JSON.stringify(atlasData);
    const compressed = zlib.gzipSync(jsonStr);
    fs.writeFileSync(path.join(outputDir, `${atlasName}.gtbl`), compressed);
    
    mapping[`QuestIcon/${atlasName}`] = Object.keys(atlasData);
    console.log(`  -> Saved ${atlasName}.gtbl with ${foundCount} icons.`);
  } else {
    console.log(`  -> No icons found for ${atlasName}.`);
  }
}

// Save mapping
fs.writeFileSync('nomi/quests_icons.json', JSON.stringify(mapping, null, 2));

console.log(`\n=== DONE ===`);
console.log(`Total quests processed: ${totalQuests}`);
console.log(`Total icons encoded: ${totalIconsFound} (${Math.round(totalIconsFound / totalQuests * 100)}%)`);
console.log(`Mapping saved to nomi/quests_icons.json`);
