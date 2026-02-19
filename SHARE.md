# Sharing Your Quest Progress

You can share your quest progress with others by generating a special link that encodes your PlayerData file. Here’s how:

## How to Share
1. **Upload your PlayerData file** on the tracker page for your modpack.
2. After your progress loads, click the **"Share Progress"** button (coming soon to all modpacks).
3. A link will be generated. Copy and send this link to your friends or post it online.
4. Anyone with the link can view your quest progress (read-only).

## How it Works
- The tracker encodes your PlayerData as a compact string in the URL (or uploads it to a temporary server, if enabled).
- When someone opens the link, the tracker loads your progress and displays it, but does not allow editing.

## Privacy
- Only the data in your PlayerData file is shared.
- No account or login is required.
- You can delete the link or clear your browser history to remove access.

## Example Link
```
https://your-tracker-site.com/nomifactory.html?share=eyJjb21wbGV0ZWRRdWVzdElkcyI6WyIxIiwiMiIsIjMiXX0=
```

## Coming Soon
- Share progress for all supported modpacks
- Optional upload to a public leaderboard
- QR code sharing

---
If you have feedback or want to request more sharing features, open an issue on GitHub or contact the site maintainer.
