# GregTech: New Horizons Quest Tracker

## Overview
This tracker is based on the [Better_Online_QuestBook](https://github.com/MCTBL/Better_Online_QuestBook) project but adapted to support quest completion tracking.

## How It Works

### Data Files
- **gtnh/quest_line.json** - Contains the list of all quest chapters/lines
- **gtnh/quest_json_en.json** - Contains all quest data with descriptions and requirements
- **gtnh/quests_icons/** - Contains compressed icon files for quest items

### Features
1. **Quest Line Selection** - Dropdown to select different quest categories (46 total)
2. **Visual Quest Display** - Grid view of all quests in the selected line
3. **Completion Tracking** - Upload your quest progress file to see which quests are completed
4. **Progress Bar** - Shows completion percentage for the current quest line
5. **Quest Details Modal** - Click any quest to see detailed information
6. **Share Progress** - Generate a shareable link to show your progress to others

### File Requirements
The tracker expects quest progress data in JSON format from:
- `questprogress.json` (BetterQuesting mod format)
- Any JSON file containing `completedQuests` or `questProgress` data

### Quest Progress File Location
In your Minecraft instance:
```
<minecraft>/saves/<worldname>/betterquesting/questprogress.json
```

### Differences from Original GTNH Setup
- Original uses DefaultQuests.json (not available in GTNH)
- This version uses the preprocessed quest_json files from Better_Online_QuestBook
- Icons are stored as compressed .gtbl files instead of individual PNGs
- Quest data is already organized by quest lines

## Technical Details

### Quest Data Structure
```json
{
  "AndSoItBegins": {
    "data": [
      {
        "quest_id": "1495",
        "title": "Quest Title",
        "data": "Quest description",
        "symbol": "image://path/to/icon.png",
        "x": 100,
        "y": 100
      }
    ],
    "links": []
  }
}
```

### Completion Detection
The tracker looks for:
- `completedQuests` array
- `completedQuestIds` array
- `questProgress` with `completed` or `claimed` flags
- NBT-tagged variants (e.g., `completedQuests:9`)

## Credits
- **Better_Online_QuestBook** by MCTBL & Grievous_Rain - Original quest data and icons
- **BetterQuesting** mod - Quest system and data format
- **GregTech: New Horizons** modpack team - Quest content
