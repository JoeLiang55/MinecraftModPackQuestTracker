import json
import os

# -----------------------------
# CONFIG: Update this path
# -----------------------------
QUESTS_JSON = r"C:\Users\lanx7\AppData\Roaming\PrismLauncher\instances\Nomifactory CEu\minecraft\config\betterquesting\DefaultQuests.json"
# -----------------------------

# Load the quest database
with open(QUESTS_JSON, "r", encoding="utf-8") as f:
    quests_data = json.load(f)

# Get quest database
quest_db = quests_data.get("questDatabase:9", {})

# Iterate over each quest
for quest_id, quest_entry in quest_db.items():
    # The properties object contains name and desc keys
    properties = quest_entry.get("properties:10", {}).get("betterquesting:10", {})
    
    # Get the localization keys (or fallback to empty string)
    quest_name_key = properties.get("name:8", "")
    quest_desc_key = properties.get("desc:8", "")
    
    # Print output
    print(f"Quest ID: {quest_id}")
    print(f"Name Key: {quest_name_key}")
    print(f"Description Key: {quest_desc_key}")
    print("-" * 50)
