/**
 * Filter Nomifactory Icons
 * 
 * This script processes 60,000+ exported icons and filters them down to only
 * the icons actually needed for Nomifactory quests.
 * 
 * Steps:
 * 1. Parse DefaultQuestsNomifactory.json to find all icon IDs used
 * 2. Map item IDs (e.g., "gregtech:machine:500") to exported filenames (e.g., "gregtech__machine__500.png")
 * 3. Copy relevant icons from icon-exports-x64/ to icons_nomi/
 * 4. Generate an updated nomi-icon-map.json with paths to all icons
 */

const fs = require('fs');
const path = require('path');

// Paths
const QUESTS_FILE = path.join(__dirname, '..', 'defaultquests', 'DefaultQuestsNomifactory.json');
const ICON_EXPORTS_DIR = path.join(__dirname, '..', 'icon-exports-x64');
const OUTPUT_DIR = path.join(__dirname, '..', 'icons_nomi');
const ICON_MAP_FILE = path.join(__dirname, '..', 'nomi-icon-map.json');

// Statistics
const stats = {
  totalQuests: 0,
  uniqueIconIds: new Set(),
  matched: 0,
  missing: [],
  copied: 0
};

/**
 * Convert a Minecraft item ID to its possible filename patterns in icon-exports-x64/
 * E.g., "gregtech:machine:500" -> ["gregtech__machine__500.png"]
 *      "minecraft:iron_ingot" -> ["minecraft__iron_ingot__0.png", "minecraft__iron_ingot.png"]
 */
function itemIdToFilenames(itemId, damage = 0) {
  if (!itemId) return [];
  
  // Split modid:itemname or modid:itemname:meta
  const parts = itemId.split(':');
  const modid = parts[0];
  const itemname = parts[1];
  const meta = parts.length > 2 ? parts[2] : damage;
  
  if (!modid || !itemname) return [];
  
  // Convert to filename pattern: modid__itemname__meta.png
  const baseName = `${modid}__${itemname}`;
  
  // Try multiple patterns in order of preference:
  // 1. With exact metadata: gregtech__machine__500.png
  // 2. With 0 metadata: gregtech__machine__0.png
  // 3. Without metadata: gregtech__machine.png
  const patterns = [];
  
  // Only add metadata pattern if it's not 0
  if (meta && meta !== 0 && meta !== '0') {
    patterns.push(`${baseName}__${meta}.png`);
  }
  
  patterns.push(`${baseName}__0.png`);
  patterns.push(`${baseName}.png`);
  
  return patterns;
}

/**
 * Find a matching file in the allFiles list
 */
function findMatchingFile(itemId, damage, allFiles) {
  const possibleNames = itemIdToFilenames(itemId, damage);
  
  // First try exact matches (highest priority)
  for (const filename of possibleNames) {
    if (allFiles.includes(filename)) {
      return filename;
    }
  }
  
  // CRITICAL: Never use fuzzy matching for gregtech:machine, thermalexpansion:machine, etc.
  // These have hundreds of variants with different metadata - we MUST match exact metadata
  // If no exact match exists, return null instead of picking wrong icon
  const itemsWithManyVariants = [
    'gregtech:machine',
    'gregtech:meta_item_1',
    'gregtech:meta_item_2',
    'nomilabs:meta_item'
  ];
  
  if (itemsWithManyVariants.includes(itemId)) {
    // No exact match found and this item has many variants - don't guess
    return null;
  }
  
  // If no exact match, try fuzzy matching ONLY for items with NBT data in filenames
  // (These are items where metadata is 0 but have complex NBT like {Energy:0, JetpackParticleType:0})
  const baseName = itemId.replace(':', '__');
  const damageStr = String(damage !== undefined && damage !== null ? damage : 0);
  
  // Pattern 1: base__damage__*.png (for items with NBT like energy, jetpack type, etc.)
  // Only use this for items where we EXPECT NBT data (not metadata variants)
  if (itemId.includes('jetpack') || itemId.includes('flux') || 
      itemId.includes('satchel') || itemId.includes('magnet') ||
      itemId.includes('capacitor') || itemId.includes('dynamo') ||
      itemId.includes('wrench_flux') || itemId.includes('device')) {
    const fuzzyPattern1 = `${baseName}__${damageStr}__`;
    const match1 = allFiles.find(f => f.startsWith(fuzzyPattern1));
    if (match1) {
      console.log(`  Fuzzy match (NBT): ${itemId}:${damage} -> ${match1}`);
      return match1;
    }
    
    // Pattern 2: base__0__*.png (items that always have 0 damage but complex NBT)
    if (damageStr !== '0') {
      const fuzzyPattern2 = `${baseName}__0__`;
      const match2 = allFiles.find(f => f.startsWith(fuzzyPattern2));
      if (match2) {
        console.log(`  Fuzzy match (0 damage): ${itemId}:${damage} -> ${match2}`);
        return match2;
      }
    }
  }
  
  // No match found
  return null;
}

/**
 * Extract all icon IDs from the quest database
 */
function extractIconIds(questData) {
  const iconIds = new Set();
  const fluidNames = new Set(); // Track fluids separately
  const questDB = questData['questDatabase:9'] || questData.questDatabase || {};
  
  Object.values(questDB).forEach(quest => {
    stats.totalQuests++;
    
    // Get icon from quest properties
    const props = quest['properties:10'] || quest.properties || {};
    const bq = props['betterquesting:10'] || props.betterquesting || {};
    const icon = bq['icon:10'] || bq.icon || {};
    
    if (icon['id:8'] || icon.id) {
      const itemId = icon['id:8'] || icon.id;
      const damage = icon['Damage:2'] || icon.Damage || 0;
      
      // Special handling for fluids (forge:bucketfilled with NBT FluidName)
      if (itemId === 'forge:bucketfilled') {
        const tag = icon['tag:10'] || icon.tag || {};
        const fluidName = tag['FluidName:8'] || tag.FluidName;
        if (fluidName) {
          // Use special fluid icon ID format: fluid:<fluidname>
          iconIds.add(`fluid:${fluidName}`);
          fluidNames.add(fluidName);
        } else {
          // Generic bucket without fluid name
          iconIds.add(itemId);
        }
      } else {
        // Store full ID with damage for better matching
        const fullId = damage !== 0 ? `${itemId}:${damage}` : itemId;
        iconIds.add(fullId);
      }
    }
  });
  
  console.log(`Found ${fluidNames.size} unique fluids in quests`);
  return iconIds;
}

/**
 * Find matching icon files in icon-exports-x64/
 */
function findIconFiles(iconIds) {
  console.log(`\nScanning ${ICON_EXPORTS_DIR} for matching icons...`);
  
  // Get all PNG files in icon-exports-x64/
  const allFiles = fs.readdirSync(ICON_EXPORTS_DIR).filter(f => f.endsWith('.png'));
  console.log(`Found ${allFiles.length} total PNG files in exports directory`);
  
  const iconMap = {}; // itemId -> relative path
  const missingIcons = [];
  
  // Manual overrides for problematic icons (icons that have bad textures in exports)
  const manualOverrides = {
    // Power Conduits - regular conduits show 4x4 grid, use endergy conduit single-piece versions
    'enderio:item_power_conduit': 'enderio__item_endergy_conduit__0.png',       // Conductive Iron
    'enderio:item_power_conduit:1': 'enderio__item_endergy_conduit__1.png',     // Aluminum  
    'enderio:item_power_conduit:2': 'enderio__item_endergy_conduit__2.png',     // Vibrant Alloy (green)
    
    // Liquid Conduits - also show 4x4 grid, but no endergy equivalents exist
    // Using data conduit as placeholder for now (single piece style)
    'enderio:item_liquid_conduit:1': 'enderio__item_data_conduit__0.png',       // Pressurized Fluid
    'enderio:item_liquid_conduit:2': 'enderio__item_data_conduit__0.png',       // Ender Fluid
    
    // Excitation Coil - use simpler icon without NBT data
    'nomilabs:excitationcoil': 'nomilabs__excitationcoil__0.png',
    
    // Thermal Expansion Dynamos - use simplified versions without NBT in filename
    'thermalexpansion:dynamo': 'thermalexpansion__dynamo__0.png',
    'thermalexpansion:dynamo:5': 'thermalexpansion__dynamo__5.png'
  };
  
  iconIds.forEach(fullId => {
    // Check manual overrides first
    if (manualOverrides[fullId]) {
      const overrideFilename = manualOverrides[fullId];
      if (allFiles.includes(overrideFilename)) {
        iconMap[fullId] = `icons_nomi/${overrideFilename}`;
        stats.matched++;
        console.log(`  Manual override: ${fullId} -> ${overrideFilename}`);
        return;
      }
    }
    
    // Special handling for fluids (format: fluid:<fluidname>)
    if (fullId.startsWith('fluid:')) {
      const fluidName = fullId.substring(6); // Remove 'fluid:' prefix
      const fluidFilename = `fluid__${fluidName}.png`;
      
      if (allFiles.includes(fluidFilename)) {
        iconMap[fullId] = `icons_nomi/${fluidFilename}`;
        stats.matched++;
      } else {
        console.log(`  Fluid not found: ${fluidName}`);
        missingIcons.push(fullId);
      }
      return;
    }
    
    // Parse itemId and damage for regular items
    const parts = fullId.split(':');
    let itemId, damage = 0;
    
    if (parts.length === 3) {
      // modid:item:damage
      itemId = `${parts[0]}:${parts[1]}`;
      damage = parseInt(parts[2]) || 0;
    } else {
      // modid:item (no damage)
      itemId = fullId;
      damage = 0;
    }
    
    // Find matching file
    const filename = findMatchingFile(itemId, damage, allFiles);
    
    if (filename) {
      // CRITICAL: Use fullId (with metadata) as key so different variants don't overwrite each other
      // e.g., "gregtech:machine:80" and "gregtech:machine:170" are separate entries
      iconMap[fullId] = `icons_nomi/${filename}`;
      stats.matched++;
    } else {
      missingIcons.push(fullId);
    }
  });
  
  stats.missing = missingIcons;
  return iconMap;
}

/**
 * Copy matched icons to icons_nomi/
 */
function copyIcons(iconMap) {
  console.log(`\nCopying ${Object.keys(iconMap).length} icons to ${OUTPUT_DIR}...`);
  
  // Create output directory if it doesn't exist
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  Object.entries(iconMap).forEach(([itemId, relativePath]) => {
    const filename = path.basename(relativePath);
    const sourcePath = path.join(ICON_EXPORTS_DIR, filename);
    const destPath = path.join(OUTPUT_DIR, filename);
    
    try {
      fs.copyFileSync(sourcePath, destPath);
      stats.copied++;
    } catch (err) {
      console.error(`Failed to copy ${filename}: ${err.message}`);
    }
  });
}

/**
 * Generate updated nomi-icon-map.json
 */
function generateIconMap(iconMap) {
  const output = {
    generatedAt: new Date().toISOString(),
    source: "icon-exports-x64/ (filtered by filterNomiIcons.js)",
    totalQuests: stats.totalQuests,
    totalUniqueIcons: stats.uniqueIconIds.size,
    matched: stats.matched,
    missed: stats.missing.length,
    missing: stats.missing.sort(),
    iconMap: iconMap
  };
  
  fs.writeFileSync(ICON_MAP_FILE, JSON.stringify(output, null, 2));
  console.log(`\nGenerated icon map: ${ICON_MAP_FILE}`);
}

/**
 * Main execution
 */
function main() {
  console.log('='.repeat(60));
  console.log('Nomifactory Icon Filtering Script');
  console.log('='.repeat(60));
  
  // 1. Load quest data
  console.log(`\nLoading quest data from ${QUESTS_FILE}...`);
  const questData = JSON.parse(fs.readFileSync(QUESTS_FILE, 'utf8'));
  
  // 2. Extract icon IDs
  console.log('\nExtracting icon IDs from quests...');
  const iconIds = extractIconIds(questData);
  stats.uniqueIconIds = iconIds;
  console.log(`Found ${stats.totalQuests} quests`);
  console.log(`Found ${iconIds.size} unique icon IDs`);
  
  // 3. Find matching files
  const iconMap = findIconFiles(iconIds);
  
  // 4. Copy icons
  copyIcons(iconMap);
  
  // 5. Generate icon map
  generateIconMap(iconMap);
  
  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total quests:        ${stats.totalQuests}`);
  console.log(`Unique icon IDs:     ${iconIds.size}`);
  console.log(`Icons matched:       ${stats.matched} (${Math.round(stats.matched/iconIds.size*100)}%)`);
  console.log(`Icons copied:        ${stats.copied}`);
  console.log(`Icons missing:       ${stats.missing.length}`);
  
  if (stats.missing.length > 0) {
    console.log(`\nMissing icons (first 20):`);
    stats.missing.slice(0, 20).forEach(id => console.log(`  - ${id}`));
    if (stats.missing.length > 20) {
      console.log(`  ... and ${stats.missing.length - 20} more`);
    }
  }
  
  console.log('\n✅ Done! Icons filtered and ready to use.');
  console.log(`\nNext steps:`);
  console.log(`1. Review the icon map in ${ICON_MAP_FILE}`);
  console.log(`2. The app.js already uses this icon map automatically`);
  console.log(`3. Test the website to see the icons loaded correctly`);
}

// Run the script
main();
