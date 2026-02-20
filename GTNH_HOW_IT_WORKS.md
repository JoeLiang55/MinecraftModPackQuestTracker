# GregTech: New Horizons Tracker - How It Works

## Icon System Explained

### The Problem
GTNH has **thousands** of quests, each needing an icon. Loading thousands of individual PNG files would be:
- Slow (thousands of HTTP requests)
- Inefficient (can't compress)
- Problematic (browser request limits)

### The Solution: Atlas System

#### 1. **Pre-packaged Icon Atlases (.gtbl files)**
Located in: `gtnh/quests_icons/QuestIcon/`

Example files:
- `AndSoItBegins.gtbl` (28 KB) - Contains ~45 quest icons
- `Tier1LV.gtbl` (varies) - Contains all Tier 1 quest icons
- `AppliedEnergisti.gtbl` (92 KB) - Contains ~150 AE2 quest icons

#### 2. **What's Inside a .gtbl File?**

```
.gtbl file → Gzip compressed → JSON object → Base64 encoded images
```

Example structure after decompression:
```json
{
  "1495": "iVBORw0KGgoAAAANSUhEUgAAAC...",  // Quest ID → Base64 WebP/PNG
  "1501": "UklGRkYHAABXRUJQVlA4ID...",
  "442": "iVBORw0KGgoAAAANSUhEUgAAAC..."
}
```

#### 3. **Icon Loading Flow**

```
User selects "Tier 1 - LV" quest line
         ↓
App displays ~100 quests
         ↓
For each quest icon needed:
  1. Look up quest ID (e.g., "1653") in quests_icons.json
  2. Find it belongs to "Tier1LV" atlas
  3. Load gtnh/quests_icons/QuestIcon/Tier1LV.gtbl (if not cached)
  4. Decompress with pako.ungzip()
  5. Parse JSON to get base64 data
  6. Set img.src = "data:image/webp;base64,[data]"
         ↓
Browser displays the icon (no extra HTTP request!)
```

#### 4. **Caching Strategy**
- **First quest icon from a line**: Downloads the .gtbl file (~20-120 KB)
- **Remaining icons from same line**: Instant (already in memory)
- **Result**: Download 1 file instead of 100+ files

### Quest Completion Colors

When a quest is marked as completed:
- ✅ **Icon border**: Turns green (#00c878)
- ✅ **Icon background**: Gets green glow
- ✅ **Quest title**: Turns green with text shadow
- ✅ **Completion badge**: Green checkmark appears

### How to Use

1. **Open**: [gtnh_tracker.html](gtnh_tracker.html)
2. **Select a quest line**: Dropdown has 46 categories
3. **Upload progress**: Your `questprogress.json` file
4. **View**: Completed quests show in green with checkmarks

### File Structure

```
gtnh/
├── quest_line.json          # List of 46 quest categories
├── quest_json_en.json       # All quest data (3.3 MB)
├── quests_icons.json        # Maps quest IDs → atlas names
└── quests_icons/
    └── QuestIcon/
        ├── AndSoItBegins.gtbl
        ├── Tier1LV.gtbl
        ├── AppliedEnergisti.gtbl
        └── ... (46 total atlas files)
```

### Technical Details

**Libraries Used:**
- **pako.min.js**: Gzip decompression for .gtbl files
- **jquery.min.js**: DOM manipulation

**Browser Requirements:**
- Modern browser with ES6 support
- JavaScript enabled
- Support for WebP images (all modern browsers)

### Credits
- **Better_Online_QuestBook** by MCTBL & Grievous_Rain
- Icons extracted from Minecraft textures & mod files
- Quest data from GregTech: New Horizons modpack
