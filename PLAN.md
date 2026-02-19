# GitHub Pages Quest Tracker – Plan for Manual Uploads

This plan makes the tracker work reliably when you **manually upload** both **DefaultQuests.json** and **PlayerData.json** (or PlayerData.dat), so that completed vs unfinished quests show correctly with icons, progress bars, and chapters.

---

## 1. How it’s supposed to work

1. **Upload two files**
   - **DefaultQuests.json** – quest definitions (names, icons, rewards, chapters).
   - **PlayerData.json** or **PlayerData.dat** – which quests the player has completed.

2. **Merge**
   - The app finds “completed” quest IDs in PlayerData and matches them to quest IDs in DefaultQuests (using normalized string IDs so numbers and strings match).

3. **Display**
   - **Chapters** – from DefaultQuests quest lines; sidebar shows chapter names and “X/Y completed”.
   - **Quest cards** – icon, name, rewards, and status (completed = green, incomplete = gray).
   - **Progress bar** – overall “completed / total (percentage)” at the top.

---

## 2. Why “I uploaded both and it didn’t work”

Common causes:

| Issue | What happens | Fix (in code / usage) |
|-------|----------------|-----------------------|
| **ID mismatch** | Quest IDs in DefaultQuests are numbers (e.g. `5`), in PlayerData they might be strings (`"5"`). `Set.has(5)` ≠ `Set.has("5")`. | Normalize every quest ID to **string** when building completed set and when matching. |
| **Wrong file** | Uploading a different JSON (e.g. only one of the two, or a different mod’s file). | Use **DefaultQuests.json** from `config/betterquesting/` and **PlayerData** from the same mod (BQ player data export or .dat). |
| **Different JSON shape** | BQ versions or exports use different key names (`questDatabase` vs `questDatabase:9`, or nested `properties:10`, etc.). | Parser already checks several variants; we add more and normalize IDs. |
| **Chapters empty** | Quest lines might be under a key we don’t read (e.g. `questLines:9` with different nesting). | Fallback: if no chapters found, show “All Quests” and list all quests. |
| **Icons 404** | Icon path is `icons/minecraft_book.png` but file is missing. | Fallback: show ✅/📋 emoji when image fails; optional: add an `icons/` folder with PNGs for your mod’s items. |

The main fix that often makes “uploaded both” start working is **normalizing quest IDs to strings** everywhere (completed set + when matching). The rest of this plan assumes that fix is in place.

---

## 3. Data shapes (what the app expects)

### 3.1 DefaultQuests.json

- **Quest list** – one of:
  - `questDatabase`
  - `questDB`
  - `questDatabase:9`
  - or root is the DB (object keyed by quest ID).
- **Each quest** – at least:
  - Quest ID: `questID`, `id`, or `questID:3` (may be number or string).
  - Name: under `properties.betterquesting.name` or `properties:10.betterquesting:10.name:8`, or `name`.
  - Icon: under `icon` or `properties.betterquesting.icon` (e.g. `id` = `minecraft:book`).
  - Optional: `rewards`, `rewards:9`, etc.
- **Chapters / quest lines** – one of:
  - `questLines`
  - `questLines:9`
  - Each line has `quests` or `quests:9` (array or object of quest references with `id` or `id:3` or `questID`).

### 3.2 PlayerData.json (or .dat)

- **Completed quests** – the app looks for:
  - `completedQuests` (array or object of IDs)
  - `completedQuestIds` (array)
  - `questProgress` – object keyed by quest ID, value has `completed` or `claimed`
  - `quests` – object keyed by quest ID, value has `completed: 1` or `claimed: 1`
  - `UserProgress` / `PartyProgress` → per-user `quests` → `completed`
  - Nested under `data`, `Data`, `ForgeCaps` for NBT-style data.

All of these are traversed and every “completed” ID is added to a **set of strings** so that numeric `5` and string `"5"` both match.

---

## 4. Merge logic (short version)

1. Parse **DefaultQuests.json** → `questData`.
2. Parse **PlayerData.json** (or .dat via NBT) → `playerData`.
3. Build **completed IDs**: walk `playerData` with the rules above; add each completed quest ID as **String(id)** to a `Set`.
4. Build **merged quests**: for each quest in DefaultQuests, set `completed: completedIds.has(String(questId))`.
5. **Chapters**: from `questLines` / `questLines:9`; each chapter’s quest list = IDs from that line; if none found, one chapter “All Quests” with every quest.
6. **Progress bar**: `completedCount / totalQuests`; same for per-chapter in sidebar.

---

## 5. Icons, progress bars, chapters (already in the app)

- **Icons**: Each quest card uses `quest.icon.id` (e.g. `minecraft:book`) → `icons/minecraft_book.png`. On error, fallback emoji is used. For GitHub Pages, add an `icons/` folder and PNGs if you want custom icons.
- **Progress bar**: Shown after both files are loaded; green bar + text “X/Y (Z%)”; chapters show “X/Y completed” in the sidebar.
- **Chapters**: Sidebar lists chapters; clicking a chapter filters the main list to that chapter’s quests.

---

## 6. Debugging when it still doesn’t work

1. **Open browser DevTools (F12) → Console.**
2. After uploading **DefaultQuests.json**: you should see `Quest data loaded:` and an object. Check that it has something like `questDatabase` or `questLines`.
3. After uploading **PlayerData**: you should see `Player data loaded as JSON:` (or “from NBT”) and an object. Check for any of the keys in §3.2.
4. After **both** are loaded: look for:
   - `Found completed quest IDs: N [ ... ]` – N should be &gt; 0 if you have completed quests.
   - `Merged quests: M` – M should match the number of quests in DefaultQuests.
   - `Chapters extracted: K` – K &gt; 0 if quest lines were found.
5. If “Merged quests: 0”, the quest database wasn’t found in DefaultQuests – check the root keys (e.g. `questDatabase`, `questDatabase:9`).
6. If “Found completed quest IDs: 0” but you have completed quests, your PlayerData shape isn’t matched yet – copy the JSON structure (root keys and one completed quest) and we can add support.

---

## 7. Checklist for “works with manual uploads”

- [x] Accept **DefaultQuests.json** and **PlayerData.json** (and .dat) via file inputs.
- [x] Normalize all quest IDs to **string** when building completed set and when matching.
- [x] Support multiple possible key names for quest DB, quest lines, and completion data.
- [x] Fallback: if no chapters, show “All Quests”.
- [x] Icons with fallback; progress bar; chapter progress in sidebar.
- [ ] (Optional) Add sample `icons/` or document where to get PNGs for your mod’s items.
- [ ] (Optional) If you have a concrete DefaultQuests.json + PlayerData.json that still fail, share their top-level structure (or a redacted sample) so we can add the exact keys.

---

## 8. File locations (for reference)

- **DefaultQuests.json**: typically `.minecraft/config/betterquesting/DefaultQuests.json`.
- **PlayerData**: BetterQuesting player save; might be inside a world save or exported as JSON; or the raw .dat from the same mod.

Once IDs are normalized and both files are loaded, the merge and display (completed vs unfinished, icons, progress bars, chapters) should work with manual uploads on GitHub Pages.
