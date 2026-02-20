# How the Icon System Works

## Overview
The Better_Online_QuestBook uses a very efficient icon loading system that **doesn't use individual PNG files**. Instead, it uses compressed "atlas" files.

## The Icon Storage System

### 1. **GTBL Files (.gtbl)**
- **What they are**: Gzip-compressed JSON files containing base64-encoded images
- **Location**: `gtnh/quests_icons/QuestIcon/AndSoItBegins.gtbl`, `Tier1LV.gtbl`, etc.
- **Format**: When unzipped, contains structure like:
```json
{
  "1495": "iVBORw0KGgoAAAANSUhEUgAA...", // base64 PNG/WEBP data
  "1501": "iVBORw0KGgoAAAANSUhEUgAA...",
  "442": "iVBORw0KGgoAAAANSUhEUgAA..."
}
```

### 2. **Icon Index (quests_icons.json)**
- Maps quest categories to quest IDs
- Example structure:
```json
{
  "QuestIcon/AndSoItBegins": ["1495", "1501", "442", "946", ...],
  "QuestIcon/Tier1LV": ["1653", "608", "116", ...]
}
```

### 3. **How Icons Are Loaded**

```
User clicks quest line → App loads quest data → For each quest:
   ↓
Check quest ID (e.g., "1495")
   ↓
Look up in quests_icons.json → Find it's in "AndSoItBegins"
   ↓
Load gtnh/quests_icons/QuestIcon/AndSoItBegins.gtbl
   ↓
Decompress with pako.ungzip() → Get JSON with base64 images
   ↓
Set img.src = "data:image/webp;base64,<base64data>"
   ↓
Browser displays image (no extra HTTP request!)
```

## Why This System?

**Advantages:**
- ✅ **Efficiency**: Download one file containing 50+ icons instead of 50 separate files
- ✅ **Speed**: After first load, icons cached in memory (no more downloads)
- ✅ **No CORS issues**: Data URIs work everywhere
- ✅ **Compression**: Gzip makes files much smaller

**How Icons Were Created:**
1. Minecraft item/block textures extracted from game files
2. Converted to PNG/WEBP format
3. Base64 encoded
4. Grouped by quest line into JSON
5. Compressed with gzip → .gtbl files

## Technical Flow

```javascript
// 1. Load the gtbl file
fetch('gtnh/quests_icons/QuestIcon/AndSoItBegins.gtbl')
  .then(res => res.arrayBuffer())
  
// 2. Decompress with pako
  .then(buffer => {
    const json = pako.ungzip(new Uint8Array(buffer), { to: 'string' });
    return JSON.parse(json);
  })
  
// 3. Use the base64 data
  .then(icons => {
    img.src = `data:image/webp;base64,${icons['1495']}`;
  });
```

## Where Icons Come From

The original icons are **Minecraft textures** from:
- Items (e.g., minecraft:iron_ingot, gregtech:circuit_integrated)
- Blocks (e.g., minecraft:stone, gregtech:machine_casing)
- Mod items (EnderIO, Thaumcraft, Forestry, etc.)

They were extracted using tools like:
- **ResourcePack extractors**
- **Minecraft asset dumpers**
- **Manual texture ripping from mod .jar files**

Then processed into this efficient atlas format for web delivery.
