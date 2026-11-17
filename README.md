# Wheel of Misfortune

A self-hosted spin-the-wheel party game for two adults. It's a kinky take on truth or dare: each player is named, a wheel of dares is chosen, and every spin lands on something the pair has agreed to play out. Wheels are edited in the browser, slots can carry a picture and a sound, and the result is read out loud by a text-to-speech voice.

It runs on any web server with PHP. There is no database, no build step and no account system.

**18+ only.** The six starter wheels are explicit BDSM and kink content (domination and submission, impact play, chastity, worship, humiliation). Don't host it where minors can reach it. Every visit starts with an age gate.

Topics: adult party game, couples game, kink and BDSM game, dare wheel, spin the wheel, random picker, truth or dare for adults, self-hosted web game, vanilla JavaScript, HTML5 canvas, PHP, Piper TTS.

## How to play

1. Confirm you're 18 or older. That click also starts the music.
2. Enter the two names. Player 1 is the Sovereign, player 2 is the subject, though a wheel can send a dare either way.
3. Pick a wheel on the Decree screen.
4. Spin with the button, the space bar, or by flicking the wheel. When it stops, the slot's sound plays, a voice reads the result, and the plaque shows the full dare with both names filled in.
5. Use the timer for anything that lasts a set time. It counts down from whatever you set, or runs as a stopwatch from zero. Hold + or - to move in bigger steps.
6. The Record lists every result so far.

The settings let you turn sound effects, music and the voice on or off.

## Wheels and the Workshop

The Workshop is the built-in wheel editor. A wheel has a name, a description and up to 48 slots. Each slot has:

- a label (what's spoken and shown on the wedge) and a longer description
- a weight from 1 (rare) to 10 (likely)
- an optional picture, which the server scales down and converts to WebP
- an optional sound: an upload (cut to 10 seconds and levelled) or a built-in gong, thunder or bell

Write `@Player1` and `@Player2` in a slot and the players' names appear in their place.

The result of a spin is drawn before the wheel starts turning, using the browser's secure random numbers and the slot weights. All wedges are the same size, so how the wheel looks has no effect on the odds. There is one shared set of wheels per installation: anyone who can open the game can play and edit them.

## How it works

```
browser ── public/  static page: HTML, ES modules, canvas, CSS, fonts, music
   │
   └── <url>/api/  ──► server/api.php (PHP-FPM) ──► $WOM_DATA/
                                                    ├── wheels/   one JSON file per wheel
                                                    ├── media/    pictures and sounds, served at <url>/media/
                                                    └── queue/    jobs for the worker
                       ops/worker.py (systemd, runs when queue/ has jobs)
                         ├── ffmpeg: uploaded sound → 10 s mp3
                         └── Piper:  slot label → spoken mp3 in media/tts/
```

The page uses relative URLs for everything, so it works under any path on any host. The first API request copies the six wheels from `server/starter-wheels.json` into the data directory. That happens once.

## Requirements

- A web server that can serve static files and pass `/api/` to PHP. Apache 2.4.26+ config is included and an nginx example is below.
- PHP 8.1+ under PHP-FPM, with `gd` (WebP support) and `mbstring`.
- For uploaded sounds and the spoken results: Python 3, ffmpeg with libmp3lame, systemd, and [Piper](https://github.com/rhasspy/piper/releases) with the `en_GB-cori-high` voice.
- On the machine you deploy from: bash, `php`, `node` and `python3`. `deploy.sh` syntax-checks the code before it installs anything.

Check PHP with:

```sh
php -r 'var_dump(gd_info()["WebP Support"] ?? false, extension_loaded("mbstring"));'
```

Both lines should say `true`.

## Try it locally

```sh
cd tools
php -S 127.0.0.1:8473 -t ../public dev-router.php
```

Then open http://127.0.0.1:8473/wheelofmisfortune/. The dev router serves the page and the real API, keeping data in `tools/.devdata/`. It sets `WOM_DEV=1`, which turns off the rate limits and the cross-site check, so never set that variable on a public server.

To render uploaded sounds and voices while testing, run the worker by hand:

```sh
WOM_DATA=$PWD/.devdata python3 ../ops/worker.py
```

## Configuration

`deploy.sh` reads its settings from `deploy.conf`. It looks for `$WOM_CONF` first, then `./deploy.conf`, then `~/.config/wom/deploy.conf`.

```sh
cp deploy.conf.example deploy.conf
```

| Setting | What it is | Example |
|---|---|---|
| `WOM_URL` | URL path of the game (`""` for a site root) | `/wheelofmisfortune` |
| `WOM_WEBROOT` | where `public/` goes | `/srv/http/example.org/wheelofmisfortune` |
| `WOM_APP` | where `api.php` goes, outside the web root | `/srv/http/example.org/wom` |
| `WOM_LIB` | where `worker.py` goes | `/usr/local/lib/wom` |
| `WOM_DATA` | wheels, media and the job queue | `/var/lib/wom` |
| `WOM_SOCK` | the PHP-FPM socket for the API | `/run/php-fpm/wom.sock` |
| `WOM_WEB_USER` | the web server's user and group | `http` on Arch, `www-data` on Debian |
| `WOM_PIPER` | folder holding `piper` and `voices/` | `/opt/piper` |

The files in `ops/` are templates. `./deploy.sh config DIR` writes copies with your settings filled in and changes nothing else.

The limits are constants at the top of `server/api.php`: 60 wheel changes and 30 uploads per IP per hour, 200 wheels, 48 slots a wheel, 12 MB per picture, 15 MB per sound, 1 GB of media in total, and at most 300 voice jobs waiting.

## Install

There are two ways to set it up. Both use the same code and the same `./deploy.sh`.

### Simple setup

The API runs in the PHP-FPM pool you already have, and the worker is left out. Pictures, rate limits and the cross-site check all work. Uploaded sounds won't play (they wait for a worker that never runs; the built-in sounds still work), and results are read by the browser's own voice instead of Piper.

1. In `deploy.conf`, set `WOM_SOCK` to your existing PHP-FPM socket (for example `/run/php/php8.3-fpm.sock` on Debian and Ubuntu, `/run/php-fpm/php-fpm.sock` on Arch) and `WOM_WEB_USER` to the user that pool runs as.
2. Create the data folder for that user:
   ```sh
   sudo install -d -o www-data -g www-data -m 750 /var/lib/wom
   ```
   If the pool sets `open_basedir`, add `$WOM_APP` and `$WOM_DATA` to it.
3. Add the web server config. For Apache, run `./deploy.sh config /tmp/wom-cfg` and paste `/tmp/wom-cfg/apache-wom.conf` into your site's `<VirtualHost>` (it needs `mod_proxy`, `mod_proxy_fcgi`, `mod_headers` and `mod_alias`). For nginx, see below.
4. Run `./deploy.sh`, reload the web server, and open the game.

#### nginx

This hasn't been tested, so check it with `nginx -t`:

```nginx
location /wheelofmisfortune/ {
    alias /srv/http/example.org/wheelofmisfortune/;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
    add_header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'; object-src 'none'" always;
}
location /wheelofmisfortune/api/ {
    client_max_body_size 16m;
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME /srv/http/example.org/wom/api.php;
    fastcgi_param WOM_DATA /var/lib/wom;
    fastcgi_pass unix:/run/php/php8.3-fpm.sock;
    add_header X-Content-Type-Options nosniff always;
    add_header Content-Security-Policy "default-src 'none'; frame-ancestors 'none'" always;
}
location /wheelofmisfortune/media/ {
    alias /var/lib/wom/media/;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
    add_header Content-Security-Policy "default-src 'none'; sandbox" always;
}
```

### Full setup (Apache and systemd)

This adds Piper voices, uploaded sounds, and tighter isolation:

- A `wom` system user is the only account that can write the data folder. The web server can only read `media/`.
- The API gets its own PHP-FPM pool. PHP is confined to the app and data folders, can't start other programs, send mail or open sockets, and has tight limits on uploads, input and memory. It starts on demand and runs at most two processes.
- Sound conversion and speech run in a separate worker, started by a systemd path unit only when there's work. It has no network access, a read-only view of the system apart from the data folder, no access to home folders or devices, a system-call filter and a memory cap.

**1. Packages**

```sh
sudo apt install apache2 php-fpm php-gd php-mbstring ffmpeg python3     # Debian / Ubuntu
sudo pacman -S apache php-fpm php-gd ffmpeg python                      # Arch
```

Enable `mod_proxy`, `mod_proxy_fcgi`, `mod_headers` and `mod_alias`.

**2. Piper and the voice**

```sh
sudo mkdir -p /opt/piper/voices
# piper_linux_<arch>.tar.gz from https://github.com/rhasspy/piper/releases
sudo tar -xzf piper_linux_x86_64.tar.gz -C /opt --no-same-owner       # creates /opt/piper/piper
cd /opt/piper/voices
sudo curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/cori/high/en_GB-cori-high.onnx
sudo curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/cori/high/en_GB-cori-high.onnx.json
echo 'Hello' | /opt/piper/piper --model en_GB-cori-high.onnx --output_file /tmp/t.wav
```

Any Piper voice works: put its `.onnx` and `.onnx.json` in `voices/` and change `VOICE` in `server/api.php`.

**3. Fill in the templates**

```sh
cp deploy.conf.example deploy.conf     # WOM_SOCK is the new pool's socket
./deploy.sh config /tmp/wom-cfg
```

**4. User, data folder, PHP pool and worker**

PHP-FPM pools live in `/etc/php/<version>/fpm/pool.d/` on Debian and `/etc/php/php-fpm.d/` on Arch.

```sh
sudo install -m 644 /tmp/wom-cfg/wom.sysusers /etc/sysusers.d/wom.conf
sudo install -m 644 /tmp/wom-cfg/wom.tmpfiles /etc/tmpfiles.d/wom.conf
sudo systemd-sysusers && sudo systemd-tmpfiles --create

sudo install -m 644 /tmp/wom-cfg/wom-fpm.conf /etc/php/php-fpm.d/wom.conf
sudo systemctl reload php-fpm

sudo install -m 644 /tmp/wom-cfg/wom-worker.path /tmp/wom-cfg/wom-worker.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now wom-worker.path
```

**5. Apache**

Paste `/tmp/wom-cfg/apache-wom.conf` into the site's `<VirtualHost *:443>`. It sets the page's security policy, sends `/api/` to the pool, and serves `media/` with its own locked-down policy.

```sh
sudo apachectl configtest && sudo systemctl reload httpd    # apache2 on Debian
```

**6. Deploy and check**

```sh
./deploy.sh
curl -s https://your-host/wheelofmisfortune/api/wheels | head -c 200
systemctl status wom-worker.path
```

The first command installs the game, the second should show the starter wheels, and the third should say `active (waiting)`. Spin a wheel and the spoken results appear in `$WOM_DATA/media/tts/` within a few seconds.

Run `./deploy.sh` after every change. It copies `public/` exactly, so anything you delete from `public/` is deleted from the server as well.

## Security

The app handles:

- **Cross-site writes.** Every change needs an `X-WoM: 1` header, which a form on another site can't send, and if the browser sends an `Origin` it has to match the host serving the page.
- **Abuse.** Rate limits per IP (HTTP 429), and caps on wheels, slots, upload sizes, total storage (HTTP 507) and queued jobs.
- **Uploads.** Pictures are decoded and re-encoded, which drops EXIF and other metadata. Sounds are re-encoded by the worker with their tags removed. Files get random names and are served with `nosniff` and a `sandbox` policy.
- **Injected markup.** Slot text is never inserted as HTML. Only `http` and `https` addresses become links.
- **The page itself** loads nothing from other sites and runs no inline script or style.
- **Privacy.** There are no accounts or cookies. The only thing kept about a visitor is a rate-limit counter, stored as a keyed hash of the IP address and deleted after a day.

You handle:

- **HTTPS, firewalling and backups.**
- **ModSecurity, if you use it.** The OWASP Core Rule Set mistakes some binary uploads for an attack (rule 200004). Switch that rule off for the upload address only:
  ```apache
  SecRule REQUEST_FILENAME "@streq /wheelofmisfortune/api/upload" "id:10031,phase:1,pass,nolog,ctl:ruleRemoveById=200004"
  ```
- **Who can play and edit.** Anyone who can open the game can change the wheels. Put it behind a password or a VPN if you want it private.

## Running it

- **Backups:** `$WOM_DATA/wheels/` and `$WOM_DATA/media/`. Everything else is a queue or a cache.
- **Back to the starter wheels:** delete `$WOM_DATA/wheels/*.json` and `$WOM_DATA/wheels/.seeded`.
- **Failed sounds or voices:** they end up in `$WOM_DATA/failed/`, and `journalctl -u wom-worker` says why.
- **Music:** `public/music/soundtrack.json` lists the tracks. The `opener` plays first, then everything shuffles without repeats until every track has played. Level new tracks so they match:
  ```sh
  ffmpeg -i in.mp3 -af loudnorm=I=-16:TP=-1.5 -c:a libmp3lame -q:a 4 out.mp3
  ```
- **Wallpapers:** `tools/wall.sh photo.jpg N` makes `public/img/wall-N.webp`. Add it to the list in `public/js/wall.js`.
- **Before changing `spin.js` or `rng.js`:** run `node tools/test-spin.mjs`.
- **A release tarball:** `./deploy.sh package`.

## Files

```
public/        the game page (installed to WOM_WEBROOT)
  js/          main (screens), game, wheel (canvas), spin and rng, editor (the Workshop),
               music, audio, timer, clock, ui, settings, api, intro, wall
  css/ fonts/ type/ img/ music/
  leave.html   where the age gate sends anyone under 18
server/        api.php and starter-wheels.json (installed to WOM_APP)
ops/           config templates: Apache, PHP-FPM pool, systemd units, sysusers, tmpfiles; worker.py
tools/         dev server, spin tests, screenshot, wallpaper, font and title-lettering helpers
deploy.sh      deploy | config DIR | package [FILE]
```

## Credits

The music, fonts and photos belong to their creators and keep their own licences.

- Music by PianoCafe_Kumi, from Pixabay. Track list in `public/music/CREDITS.txt`.
- Fonts: Echoes Dominion and Modern Typewriter (personal, non-commercial use), Homemade Apple (Apache 2.0), Courier Prime (SIL OFL 1.1). Each licence sits next to its font. The opening title is drawn from SVG outlines rather than a font file.
- Wallpaper photo credits in `public/img/CREDITS.txt`.
- Spoken results by [Piper](https://github.com/rhasspy/piper). The voice model's licence is on its Hugging Face page.
- The starter wheels link to Wikipedia for background reading.

## License

The code is under the [WTFPL](http://www.wtfpl.net/), version 2: do what you want with it.

It comes without any warranty, to the extent permitted by applicable law. Play safe: every dare is a suggestion, and both players' consent comes first.

The licence covers the code only. The music, fonts and photos keep their own licences; see Credits.
