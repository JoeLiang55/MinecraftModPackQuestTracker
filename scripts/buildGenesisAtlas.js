const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Load quest data
const data = JSON.parse(fs.readFileSync('defaultquests/DefaultQuestsNomifactory.json', 'utf8'));
const questDB = data['questDatabase:9'];
const genesisLine = data['questLines:9']['6:10'];
const genesisQuestRefs = genesisLine['quests:9'];

// Get all Genesis quest IDs
const genesisQuestIds = [];
for (const [refKey, refData] of Object.entries(genesisQuestRefs)) {
  genesisQuestIds.push(refData['id:3']);
}

console.log(`Building Genesis atlas for ${genesisQuestIds.length} quests...`);

// Special mappings for items that need specific files
const specialMappings = {
  'thermalexpansion:satchel': {
    0: 'extracted-textures/assets/thermalexpansion/textures/items/satchel/satchel_0.png',
    1: 'extracted-textures/assets/thermalexpansion/textures/items/satchel/satchel_1.png',
    2: 'extracted-textures/assets/thermalexpansion/textures/items/satchel/satchel_2.png',
    3: 'extracted-textures/assets/thermalexpansion/textures/items/satchel/satchel_3.png',
    4: 'extracted-textures/assets/thermalexpansion/textures/items/satchel/satchel_4.png',
    100: 'extracted-textures/assets/thermalexpansion/textures/items/satchel/satchel_4.png' // using highest tier instead of void variant
  },
  'thermalexpansion:dynamo': {
    0: 'missingicons/steamdynamo.png' // User-provided custom icon
  },
  'thermalexpansion:capacitor': {
    0: 'extracted-textures/assets/thermalexpansion/textures/items/capacitor/capacitor_0.png',
    1: 'extracted-textures/assets/thermalexpansion/textures/items/capacitor/capacitor_1.png',
    2: 'extracted-textures/assets/thermalexpansion/textures/items/capacitor/capacitor_2.png',
    3: 'extracted-textures/assets/thermalexpansion/textures/items/capacitor/capacitor_3.png',
    4: 'extracted-textures/assets/thermalexpansion/textures/items/capacitor/capacitor_4.png'
  },
  'nomilabs:excitationcoil': {
    0: 'missingicons/exciationcoil.png' // User-provided custom icon
  }
};

function findTexture(iconId, damage) {
  // Check missingicons folder first (user-provided custom icons)
  const customPath = 'missingicons/' + iconId.replace(':', '_') + '.png';
  if (fs.existsSync(customPath)) {
    return customPath;
  }

  // Check special mappings
  if (specialMappings[iconId] && specialMappings[iconId][damage] !== undefined) {
    const specialPath = specialMappings[iconId][damage];
    if (fs.existsSync(specialPath)) {
      return specialPath;
    }
  }

  // Check icons_nomi (pre-extracted common items)
  const nomiPath = 'icons_nomi/' + iconId.replace(':', '_') + '.png';
  if (fs.existsSync(nomiPath)) {
    return nomiPath;
  }

  // Search extracted-textures
  const [modId, itemName] = iconId.split(':');
  const basePath = 'extracted-textures/assets/' + modId;
  
  if (!fs.existsSync(basePath)) {
    return null;
  }

  function searchDir(dir, depth = 0) {
    if (depth > 6) return null;
    
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        
        if (item.isDirectory()) {
          const result = searchDir(fullPath, depth + 1);
          if (result) return result;
        } else if (item.isFile() && item.name.endsWith('.png')) {
          const baseName = item.name.replace('.png', '');
          
          // Try exact match with damage value
          if (damage > 0 && baseName === `${itemName}_${damage}`) {
            return fullPath;
          }
          
          // Try exact match
          if (baseName === itemName) {
            return fullPath;
          }
          
          // Try case-insensitive match
          if (baseName.toLowerCase() === itemName.toLowerCase()) {
            return fullPath;
          }
        }
      }
    } catch (e) {
      // Ignore permission errors
    }
    
    return null;
  }

  return searchDir(basePath);
}

// Build the atlas
const atlasData = {};
let foundCount = 0;
const missingItems = [];

genesisQuestIds.forEach(qid => {
  for (const [key, quest] of Object.entries(questDB)) {
    if (quest['questID:3'] === qid) {
      const bq = quest['properties:10']['betterquesting:10'];
      const icon = bq['icon:10'];
      const iconId = icon['id:8'];
      const damage = icon['Damage:2'] || 0;
      
      const texturePath = findTexture(iconId, damage);
      
      if (texturePath) {
        try {
          const pngBuffer = fs.readFileSync(texturePath);
          const base64 = pngBuffer.toString('base64');
          atlasData[String(qid)] = base64;
          foundCount++;
          
          // Log special items
          if (iconId.includes('satchel') || iconId.includes('dynamo') || iconId.includes('excitation')) {
            console.log(`✓ Q${qid}: ${iconId}:${damage} -> ${path.basename(texturePath)}`);
          }
        } catch (error) {
          console.error(`Error reading ${texturePath}:`, error.message);
          missingItems.push(`${iconId}:${damage} (Quest ${qid})`);
        }
      } else {
        missingItems.push(`${iconId}${damage > 0 ? ':' + damage : ''} (Quest ${qid})`);
      }
      
      break;
    }
  }
});

console.log(`\n=== RESULTS ===`);
console.log(`Icons found: ${foundCount} / ${genesisQuestIds.length} (${Math.round(foundCount / genesisQuestIds.length * 100)}%)`);
console.log(`Missing: ${missingItems.length}`);

if (missingItems.length > 0 && missingItems.length <= 45) {
  console.log(`\nMissing icons:`);
  missingItems.forEach(item => console.log(`  - ${item}`));
}

// Compress and save
const jsonStr = JSON.stringify(atlasData);
const compressed = zlib.gzipSync(jsonStr);
fs.writeFileSync('nomi/quests_icons/QuestIcon/Genesis.gtbl', compressed);

console.log(`\n✓ Created Genesis.gtbl: ${compressed.length} bytes (${jsonStr.length} bytes uncompressed)`);
console.log(`✓ Atlas contains ${Object.keys(atlasData).length} quest icons`);
