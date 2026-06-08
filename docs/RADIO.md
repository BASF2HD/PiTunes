# Internet radio

PiTunes includes moOde/Volumio-style internet radio: browse saved stations, search a worldwide directory, favourite stations, and listen through **MPD** on your chosen audio output.

## Listen

1. Open **More → Radio**.
2. Choose **Favourite stations** or **All saved stations**.
3. Tap a station cover to play.

Playback uses MPD stream URLs, so radio works on USB DAC, HDMI, headphones, and DAC HAT — not only in the browser.

## Search

1. **More → Radio → Search stations** (or open Search while in Radio mode).
2. Type a station name, genre, or country keyword.
3. Tap a result to play.
4. Use the **heart** control to save a station to your favourites.

Search uses the public [Radio Browser](https://www.radio-browser.info/) directory via the PiTunes API proxy.

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/library/radio?scope=all\|favourites` | Saved stations |
| GET | `/api/library/radio/search?q=&country=&tag=` | Directory search |
| POST | `/api/library/radio/stations` | Add / save station |
| POST | `/api/library/radio/favourites` | Star / unstar |
| POST | `/api/library/radio/remove` | Remove saved station |
| POST | `/api/player/radio/play` | Play `{ stationId }` or `{ url, name }` |

Stations are stored in `/etc/pitunes/userdata.json`. New installs seed a few stations from `config/radio-stations.seed.json`.

## Requirements

- Network access for search and most streams.
- MPD must be running (`mpd.service`).
- Some BBC and regional streams may block non-UK networks or require HTTPS updates over time — remove and re-add from search if a stream stops working.
