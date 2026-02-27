# Nomifactory Leaderboard – Design & Plan

This document describes how to add a Nomifactory-specific leaderboard to the existing static quest tracker (hosted on GitHub Pages) by introducing a minimal, free, database-backed API while keeping the frontend in vanilla JS. The leaderboard will rank players by percent of quests completed, using data derived from the existing in-memory `mergedQuests` model in [app.js](app.js) and integrated into the UI defined in [nomifactory.html](nomifactory.html). For the database layer, we will use a free Supabase (Postgres + REST) project as a simple, hosted DB with JSON over HTTP, so the static site can talk to it directly via `fetch`. The design is pack-aware (using a `pack_id` field) so it can be extended later to GTNH and others.

## 1. UX and placement in Nomifactory UI

- Add a new **Leaderboard** section in [nomifactory.html](nomifactory.html):
  - A visible panel on the right side or below the main quest list area, titled "Nomifactory Leaderboard".
  - Table-style layout with columns: **Rank**, **Player**, **Completed**, **Total**, **Percent**, **Last Updated**.
- Add a **"Submit to Leaderboard"** button near the existing share button:
  - Enabled only when valid progress is loaded (either via PlayerData upload or share link) and a player display name is known.
  - Disabled and visually indicated when viewing another player's shared progress in read-only mode.
- Include simple status messaging in the DOM (for example, a small area below the button) to show submission success/failure and the last submission time for the current player.

## 2. Client-side data model and submission conditions

- Reuse the in-memory data that already exists in [app.js](app.js):
  - `mergedQuests` (each quest has `completed` and belongs to a chapter).
  - Total quests and completed quests are already computed for the progress bar.
- Standardize a client-side model for leaderboard submissions:
  - `packId`: string, e.g., `"nomifactory"`.
  - `playerName`: display name derived from PlayerData (if available) or from the `player=` parameter in shared URLs.
  - `playerUuid`: optional; use Ashcon/Mojang resolver if available, otherwise null or omitted.
  - `completedCount`: number of quests with `completed = true`.
  - `totalQuests`: length of `mergedQuests` (or pack-specific total if some quests should not count).
  - `percentComplete`: computed as `completedCount / totalQuests * 100`, rounded to a reasonable precision.
  - `submittedAt`: timestamp in ISO 8601 format, generated client-side at submission time.
- Implement a pure helper that, given the current in-memory quest state and player identity, returns this JSON-ready object.

## 3. Database and schema (Supabase)

- Use a **Supabase free-tier Postgres** instance as the backing DB with REST interface:
  - Avoids building/hosting a custom backend; the static site talks directly to Supabase using `fetch`.
- Create a `leaderboard_entries` table with columns:
  - `id`: uuid, primary key, default generated.
  - `pack_id`: text, indexed; values like `"nomifactory"`, `"gtnh"`, etc.
  - `player_name`: text, indexed.
  - `player_uuid`: text, nullable.
  - `completed_count`: integer, not null.
  - `total_quests`: integer, not null.
  - `percent_complete`: double precision (or numeric), indexed for sorting.
  - `submitted_at`: timestamptz, default `now()`.
- Add a unique constraint for "one row per player per pack".  Use whichever identifier you plan to dedupe on:
  - **recommended:** a unique index on `(pack_id, player_uuid)` (UUID has fewer collisions). make sure the index is actually created in the database; if it is missing then upserts will fail with a 409 error.
  - fallback: `(pack_id, player_name)` if you don't have UUIDs.

  The client will perform an **upsert** instead of a blind insert, so the first submission creates a row and subsequent submissions for the same `(pack_id, player_uuid)` simply update the existing row.  (If the first submission lacked a UUID, the client now issues a small cleanup DELETE for any row with `player_uuid IS NULL` and the same `player_name` before doing the upsert; this removes stale 58% entries once the 60% submission includes a UUID.)

  In plain SQL the behaviour looks like:

```sql
insert into public.leaderboard_entries(
  pack_id,player_name,player_uuid,completed_count,total_quests,percent_complete
) values ( ... )
on conflict (pack_id, player_uuid) do update set
  player_name      = excluded.player_name,
  completed_count  = excluded.completed_count,
  total_quests     = excluded.total_quests,
  percent_complete = excluded.percent_complete,
  submitted_at     = now();
```

  The Supabase REST endpoint supports this via the `Prefer: resolution=merge-duplicates` header (and you may also include `return=representation` if you want the updated row back).

  If your project uses the RPC helper instead, be sure the `ON CONFLICT` clause in the function targets the same pair of columns (`pack_id, player_uuid`); mismatches here are the most common cause of the 409 error described in the user report.

  *Optional behaviour:* if you prefer each click of “Submit” to **add** to the existing completed count (accumulate progress) rather than overwrite it, create a tiny stored procedure on the database and call it with a RPC request.  For example:

  ```sql
  create function public.upsert_leaderboard_entry(
      p_pack_id text,
      p_player_name text,
      p_player_uuid text,
      p_completed_count integer,
      p_total_quests integer
  ) returns void language plpgsql as $$
  begin
      insert into public.leaderboard_entries(
        pack_id, player_name, player_uuid,
        completed_count, total_quests, percent_complete
      ) values (
        p_pack_id, p_player_name, p_player_uuid,
        p_completed_count, p_total_quests,
        (p_completed_count::double precision / p_total_quests) * 100
      )
      on conflict (pack_id, player_name) do update set
        completed_count = public.leaderboard_entries.completed_count + excluded.completed_count,
        total_quests = excluded.total_quests,
        percent_complete =
          (public.leaderboard_entries.completed_count + excluded.completed_count)::double precision
          / excluded.total_quests * 100,
        submitted_at = now();
  end;
  $$;
  ```

  The frontend would then POST to `/rest/v1/rpc/upsert_leaderboard_entry` instead of to the table endpoint.

### 3.1. Supabase project setup (concrete steps)

1. Create a free Supabase project at https://supabase.com/.
2. In the SQL editor, create the table:
  ```sql
  create table if not exists public.leaderboard_entries (
    id uuid primary key default gen_random_uuid(),
    pack_id text not null,
    player_name text not null,
    player_uuid text null,
    completed_count integer not null,
    total_quests integer not null,
    percent_complete double precision not null,
    submitted_at timestamptz not null default now()
  );

  create index if not exists leaderboard_pack_idx on public.leaderboard_entries (pack_id);
  create index if not exists leaderboard_percent_idx on public.leaderboard_entries (pack_id, percent_complete desc);

  -- one row per player per pack; uuid is preferred but may be null on first submit.
  -- we clean up any null-uuid row on the client when a real UUID becomes
  -- available, but you can also enforce it entirely in SQL with the
  -- COALESCE trick shown below.
  create unique index if not exists leaderboard_unique_player_per_pack
    on public.leaderboard_entries (pack_id, player_uuid);

  -- alternate version that treats NULL and the player's name equivalently:
  --
  -- create unique index if not exists leaderboard_unique_person_per_pack
  --   on public.leaderboard_entries (pack_id, COALESCE(player_uuid, player_name));
  --
  -- With the above, an insert with a name but no UUID will conflict against a
  -- later insert that carries the UUID (and vice‑versa), automatically
  -- updating the single row instead of leaving a stale 58% entry behind.
  ```
3. In **Authentication → Policies** (or Table editor → RLS), enable Row Level Security for `leaderboard_entries` and add policies:
  - `Allow anonymous select` – `using (true)`.
  - `Allow anonymous upsert` – `with check (true)` (sufficient for a casual, trust-based leaderboard).
4. Copy your **project URL** (e.g. `https://YOUR-PROJECT.supabase.co`) and **anon public key** from Project Settings → API.
5. In [app.js](app.js), fill in the placeholders:
  - `LEADERBOARD_SUPABASE_URL` – your project URL.
  - `LEADERBOARD_SUPABASE_KEY` – the anon public key.

## 4. Security and public API access

- Enable Row Level Security on `leaderboard_entries`.
- Create policies allowing the anonymous client role to:
  - **Insert / upsert** rows for any `pack_id` (or only selected pack IDs).
  - **Select** (read) rows for all packs.
  - Disallow arbitrary updates/deletes except via upsert constrained by the unique key.
- Accept that this is a **trust-based, for-fun** leaderboard (client can fake progress); focus on ease of use over anti-cheat.

## 5. REST contract between frontend and DB

- **Submit entry** – `POST /rest/v1/leaderboard_entries`
  - Body: single JSON object or array of `LeaderboardEntry` objects (fields from section 2).
  - Headers: `apikey` (Supabase anon key), `Content-Type: application/json`, and `Prefer: resolution=merge-duplicates` for upsert.
  - Behavior: insert or upsert based on the unique index.
  - Response: inserted row(s), including generated `id` and `submitted_at`.
- **Fetch leaderboard** – `GET /rest/v1/leaderboard_entries?pack_id=eq.nomifactory&order=percent_complete.desc&limit=50`
  - Returns top N players for a given pack sorted by percentage.
  - Used to populate the leaderboard panel in [nomifactory.html](nomifactory.html).

## 6. Frontend integration in Nomifactory (app.js)

- Add configuration constants near the top of [app.js](app.js) specific to Nomifactory:
  - `LEADERBOARD_ENABLED`: boolean flag.
  - `LEADERBOARD_PACK_ID`: `"nomifactory"`.
  - `LEADERBOARD_SUPABASE_URL`: placeholder to be filled with your project URL.
  - `LEADERBOARD_SUPABASE_KEY`: placeholder for the anon public key.
- Implement helpers:
  - `buildLeaderboardPayload()` – reads current `mergedQuests`, counts completed vs total, uses current player name/UUID, and returns a payload object.
  - `submitLeaderboardEntry(payload)` – sends a POST to Supabase REST, handles success/error, and updates a status message element.
  - `loadLeaderboard()` – sends a GET to fetch top entries for `pack_id = "nomifactory"`, then renders them into the leaderboard table.
- Wire up UI events:
  - Attach a click listener to the new **"Submit to Leaderboard"** button that:
    - Validates that progress is loaded and a player name is available.
    - Calls `buildLeaderboardPayload()` then `submitLeaderboardEntry()`.
  - On page initialization, call `loadLeaderboard()` to populate the table.
  - In shared-progress read-only mode, either disable the submit button or submit under the shared player name, depending on the chosen policy.

## 7. Reuse for other packs (future)

- Keep the design pack-agnostic by:
  - Always including `pack_id` in entries.
  - Isolating pack-specific configuration (IDs, labels, and DOM selectors) so GTNH/E2E can reuse the same logic in their own JS files.
- Potentially extract generic functions (still vanilla JS) into a shared module or utility section, while each pack’s script supplies its own config.

## 8. Verification checklist

- **Frontend**
  - Leaderboard panel renders correctly in [nomifactory.html](nomifactory.html) with an empty state.
  - Loading progress from PlayerData or a share link enables or disables the submit button as intended.
  - Clicking **"Submit to Leaderboard"** shows clear success/failure feedback.
  - The leaderboard table updates to show new/updated entries after submission.
- **Backend**
  - New rows appear in the `leaderboard_entries` table with correct `pack_id`, counts, and timestamps.
  - Repeated submissions from the same player update the same row (upsert) rather than creating duplicates.
- **Hosting**
  - GitHub Pages deployment can successfully call Supabase (CORS and anon key are configured correctly).

## 9. Decisions

- Backend/DB: Supabase free-tier Postgres + REST.
- Identity: primarily `player_name` with optional `player_uuid`; uniqueness per `(pack_id, player_name)` (or UUID when available).
- Data stored: aggregate progress (completed count, total, percent, timestamps); no per-quest ID list in the leaderboard table.
- Trust model: casual, for-fun leaderboard; no strict anti-cheat, but basic rate limiting and moderation are possible later if needed.
