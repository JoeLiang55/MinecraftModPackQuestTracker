Nomifactory icon atlases (GTNH-style)

This folder is optional. If you add the files below, the Nomifactory tracker will render per-quest icons from atlases (same idea as the GTNH page).

Expected structure:
- nomi/quests_icons.json
- nomi/quests_icons/QuestIcon/<AtlasName>.gtbl   (or .json)

Mapping format (quests_icons.json):
{
  "QuestIcon/Genesis": ["0", "1", "2"],
  "QuestIcon/EarlyGame": ["120", "121"]
}

Atlas format (<AtlasName>.gtbl):
- gzip-compressed JSON object:
  { "0": "<base64 WEBP>", "1": "<base64 WEBP>", ... }

How to generate (using the tools you already have in temp_gtnh_repo/tools):
1) Put per-quest icon PNGs into folders under `nomi/quests_icons/QuestIcon/<AtlasName>/` named by quest id, e.g. `0.png`, `1.png`.
2) Run PackSprite.js on each <AtlasName> folder to produce <AtlasName>.gtbl.
3) Run MakeFileConfig.js on `nomi/quests_icons` to generate `nomi/quests_icons.json`.
