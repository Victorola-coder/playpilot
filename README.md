# PlaylistPilot

*Navigating your music taste, one replay at a time.*

PlaylistPilot watches what you play on Spotify and saves the songs you keep coming back to into playlists, so you don't have to remember to save them yourself.

Examples of what it can do:

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
   This records your plays every 15 minutes and applies your rules every hour. Leave it running (see [Keep it running](#keep-it-running)).

### Optional: import your past listening

Spotify only shows apps your **last 50 plays**, so PlaylistPilot starts counting from when you first run it. To get your full history:

1. Go to Spotify **Account → Privacy settings** and request **Extended streaming history**. It takes a few days to arrive by email.
2. Unzip it, then:
   ```sh
   node src/cli.js import ~/Downloads/Spotify\ Extended\ Streaming\ History
   ```

## Web page

There's also a simple web page (Next.js + TypeScript) in [web/](web/). It shows your stats and rules, and has buttons to sync, preview and apply. It uses the same `.env`, `rules.json` and database as the commands below.

1. In your Spotify app settings, add a second Redirect URI: `http://127.0.0.1:3000/api/auth/callback`
2. Then:
   ```sh
   cd web
   npm install
   npm run dev
   ```
3. Open **http://127.0.0.1:3000**. Use `127.0.0.1`, not `localhost`: Spotify only accepts `127.0.0.1`.

The page only runs things when you click a button. To keep plays recording in the background, also leave `npm start` (or the LaunchAgent below) running.

## Commands

| Command | What it does |
| --- | --- |
| `npm run login` | Connect your Spotify account |
| `npm run sync` | Record your latest plays now |
| `npm run preview` | Show what each rule *would* add, without changing anything |
| `npm run apply` | Apply your rules now |
| `npm run stats` | Show your 25 most-played songs, with their best streaks |
| `npm start` | Keep syncing and applying on a timer |

Run `npm run preview` after changing your rules to see what they would do.

## Writing rules

Rules live in `rules.json`. Each rule picks songs and puts them in a playlist:

```json
{
  "name": "Heavy rotation",
  "playlist": "PlaylistPilot · Heavy Rotation",
  "match": { "minPlays": 5 },
  "onlyUnsaved": true
}
```

**Conditions in `match`.** All the conditions you list must be true:

| Condition | Meaning |
| --- | --- |
| `minPlays` | Played at least this many times in total |
| `withinDays` | Used with `minPlays`: only count plays from the last N days |
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
| `onlyUnsaved` | `true` | Skip songs already in Liked Songs or in one of your own playlists |
| `groupBy` | none | `"genre"` or `"artist"`: one playlist per group. Put `{group}` in the playlist name |
| `minGroupSize` | `1` | Don't create a group playlist for fewer songs than this |
| `maxTracks` | none | Only take the top N most-played matches |
| `enabled` | `true` | Set to `false` to switch a rule off without deleting it |

### How it decides

- **A play** is any listen Spotify counts, which means about 30 seconds or more. Skips don't count.
- **In a row** means the same song played consecutively, with no more than 30 minutes between the plays.
- **Saved** means the song is in Liked Songs or in a playlist you own or collaborate on. Spotify doesn't let apps read playlists you only follow, so those don't count.
- PlaylistPilot **only adds** songs; it never removes them. If you delete a song from a PlaylistPilot playlist, it won't be added back.
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
