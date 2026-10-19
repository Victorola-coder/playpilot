# PlaylistPilot

*Navigating your music taste, one replay at a time.*

PlaylistPilot watches what you play on Spotify and saves the songs you keep coming back to into playlists, so you don't have to remember to save them yourself.

It also measures how much of each song you actually hear, so a song left looping in the background overnight doesn't get mistaken for a favourite.

Examples of what it can do:

- Save any song you've **listened to 7+ times, hearing at least 80% each time, across 2+ separate sessions** into *PlaylistPilot · Keepers*
- Put any song you played **3+ times in a row** into *PlaylistPilot · On Repeat*
- Put any song you played **5+ times** that isn't in Liked Songs or any of your playlists into *PlaylistPilot · Heavy Rotation*
- Build one playlist per **genre** (*PlaylistPilot · Afrobeats*, *PlaylistPilot · Rap*, …) out of your most-played songs

Everything runs on your own computer. Your play history stays in a local SQLite file.

## Setup

You need Node.js 22.13 or newer and a Spotify **Premium** account. Spotify requires Premium for the owner of a developer app.

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app.
   - Redirect URI: `http://127.0.0.1:8888/callback`
   - API: tick **Web API**
2. Copy your app's **Client ID**, then:
   ```sh
   cp .env.example .env        # paste the Client ID into SPOTIFY_CLIENT_ID
   cp rules.example.json rules.json
   npm run login
   ```
3. Start it:
   ```sh
   npm start
   ```
   This measures what you're playing every few seconds, records Spotify's play history every 15 minutes, and applies your rules every hour. Leave it running (see [Keep it running](#keep-it-running)).

### Optional: import your past listening

Spotify only shows apps your **last 50 plays**, so PlaylistPilot starts counting from when you first run it. To get your full history:

1. Go to Spotify **Account → Privacy settings** and request **Extended streaming history**. It takes a few days to arrive by email.
2. Unzip it, then:
   ```sh
   node src/cli.js import ~/Downloads/Spotify\ Extended\ Streaming\ History
   ```

## Web page

There's also a web app (Next.js + TypeScript) in [web/](web/). It shows what's playing now, your most-played songs and your rules. It has buttons to sync, preview and apply, and a Settings page for editing rules without touching JSON. It uses the same `.env`, `rules.json` and database as the commands below.

1. In your Spotify app settings, add a second Redirect URI: `http://127.0.0.1:3000/api/auth/callback`
2. Then:
   ```sh
   cd web
   npm install
   npm run dev
   ```
3. Open **http://127.0.0.1:3000**. Use `127.0.0.1`, not `localhost`: Spotify only accepts `127.0.0.1`.

While the web server is running, it does the same background work as `npm start`, so you only need one of them. If both are running, only one does the tracking. Set `PLAYLISTPILOT_BACKGROUND=off` to stop the web server from doing it.

## Commands

| Command | What it does |
| --- | --- |
| `npm run login` | Connect your Spotify account |
| `npm run sync` | Record your latest plays now |
| `npm run preview` | Show what each rule *would* add, without changing anything |
| `npm run apply` | Apply your rules now |
| `npm run stats` | Show your 25 most-played songs, with their best streaks |
| `npm start` | Keep measuring, syncing and applying on a timer |

Run `npm run preview` after changing your rules to see what they would do.

## Writing rules

Edit rules on the web app's **Settings** page, or directly in `rules.json`. Each rule picks songs and puts them in a playlist:

```json
{
  "name": "Keepers",
  "playlist": "PlaylistPilot · Keepers",
  "match": { "minPlays": 7, "minCompletion": 80, "minSessions": 2 },
  "onlyUnsaved": true
}
```

**Conditions in `match`.** All the conditions you list must be true:

| Condition | Meaning |
| --- | --- |
| `minPlays` | Listened at least this many times |
| `minCompletion` | Only count listens where you heard at least this % of the song (1–100) |
| `minSessions` | The listens must be spread across at least this many separate sessions |
| `maxPerSession` | Count at most this many listens from any one session |
| `withinDays` | Only count listens from the last N days |
| `minStreak` | Played at least this many times back to back (this is how "on repeat" is detected) |
| `artists` | By one of these artists, e.g. `["Burna Boy", "Tems"]` |
| `genres` | In one of these genres. Partial matches count, so `"afro"` matches "afrobeats" |

To match songs that meet **any** of several conditions, make `match` a list:

```json
"match": [{ "minStreak": 3 }, { "minPlays": 4, "withinDays": 30 }]
```

**Other options:**

| Option | Default | Meaning |
| --- | --- | --- |
| `saveTo` | `"playlist"` | `"liked"` saves to Liked Songs instead of a playlist (then `playlist` isn't needed) |
| `onlyUnsaved` | `true` | Skip songs already in Liked Songs or in one of your own playlists |
| `groupBy` | none | `"genre"` or `"artist"`: one playlist per group. Put `{group}` in the playlist name |
| `minGroupSize` | `1` | Don't create a group playlist for fewer songs than this |
| `maxTracks` | none | Only take the top N most-played matches |
| `enabled` | `true` | Set to `false` to switch a rule off without deleting it |

**Settings for every rule** go in a `settings` section at the top of `rules.json`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `sessionGapMinutes` | `60` | Listens of the same song further apart than this count as separate sessions |
| `unmeasuredPlays` | `"ignore"` | For rules with `minCompletion`: `"count"` treats plays nobody measured as full listens |
| `autoApply` | `true` | Add songs automatically every hour. Set to `false` to only add when you press Apply |

### How it decides

- **A play** is any listen Spotify counts, which means about 30 seconds or more. Skips don't count.
- **% listened** is measured while PlaylistPilot is running: it checks what's playing every 10 seconds. Skipping forward doesn't count as listening, and pausing doesn't add time. Plays it didn't see, like ones on your phone while your laptop was off, are *unmeasured*. Imported history counts as measured, because Spotify's export includes how long each play lasted.
- **Sessions** are counted per song. If you loop a song seven times in one sitting, that's one session. With `minSessions: 2` it won't be saved yet, but as soon as you come back to it another time, it qualifies.
- **In a row** means the same song played consecutively, with no more than 30 minutes between the plays.
- **Saved** means the song is in Liked Songs or in a playlist you own or collaborate on. Spotify doesn't let apps read playlists you only follow, so those don't count.
- PlaylistPilot **only adds** songs on its own; it never removes them. If you delete a song from a PlaylistPilot playlist, it won't be added back.
- To take a song back out, use **⋯ → Remove from my collection** on the dashboard. **⋯ → Never add this song** stops it from ever being added again. You can undo that under **Settings → Never add**.
- If you already have a playlist with exactly the same name as a rule's playlist, PlaylistPilot uses that playlist instead of creating a new one.

## Keep it running

`npm start` only works while the terminal is open, and Spotify's 50-play limit means it needs to check at least every hour or so. On a Mac, the easiest way to keep it running is a LaunchAgent. Save this as `~/Library/LaunchAgents/com.playpilot.plist`, changing the paths to match your machine:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.playpilot</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/node</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>/Users/you/playpilot/src/cli.js</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/playpilot.log</string>
  <key>StandardErrorPath</key><string>/tmp/playpilot.log</string>
</dict></plist>
```

Then run `launchctl load ~/Library/LaunchAgents/com.playpilot.plist`. While your Mac is asleep, PlaylistPilot can't see plays from your phone. Anything beyond the last 50 plays is lost, so for heavy listening you may want to host it on a small always-on server.

## Limits

- Spotify developer apps are limited to the app owner plus a few users you add by hand. This works for personal use. A public app would need Spotify's approval.
- Genres come from artists, not songs, and some artists have no genres listed. Those songs are left out of genre playlists.
