# Sharing Your Quest Progress

You can share your quest progress with friends by generating a link. No accounts or servers required — everything is encoded directly in the URL.

## How to Share
1. Go to a modpack tracker page (e.g. Nomifactory CEu).
2. Upload your **PlayerData** file as usual.
3. Once your quests load, click the **"Share Progress"** button in the header.
4. A link is automatically generated and copied to your clipboard.
5. Send the link to anyone — they can view your progress without uploading anything.

## How it Works
- When you click "Share Progress", the tracker collects your completed quest IDs.
- Those IDs are compressed (using gzip/pako) and encoded into a URL-safe string.
- The string is added to the page URL as a hash fragment: `#share=...`
- When someone opens that link, the tracker decodes the data and displays your progress — read-only, no file upload needed.

## Viewing a Shared Link
- Just open the link in any browser.
- The file upload section is hidden — the page automatically loads the shared progress.
- A banner at the top shows you're viewing someone else's progress.

## Privacy
- Only your **completed quest IDs** are included in the link (just numbers, no usernames or personal data).
- The data lives entirely in the URL — nothing is uploaded to any server.
- If you stop sharing the link, no one new can access it.

## Example Link
```
https://yourusername.github.io/your-repo/nomifactory.html#share=eJzLKC0u...
```

## Limitations
- Very long URLs (thousands of completed quests) may hit browser URL length limits (~2000 chars for some browsers). In practice, Nomifactory's ~400 quests compress well within this.
- The link is a snapshot — it doesn't update if you complete more quests later. Generate a new link to share updated progress.
