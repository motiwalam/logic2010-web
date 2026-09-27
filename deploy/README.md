# Deploying to motiwala.ca

```sh
deploy/deploy.sh --dry-run     # show what would happen (read-only checks on the server)
deploy/deploy.sh               # build, upload, switch, test
deploy/deploy.sh --rollback    # switch back to the previous release
```

Needs `ssh root@motiwala.ca` (key-based), `rsync`, and `npm` locally. `--skip-build` uses
an existing `dist/`; `--host user@host` (or `DEPLOY_HOST`) targets another machine.

## What is where

| Path on the server | |
| --- | --- |
| `/opt/logic2010/node` → `node-v24.21.0-linux-x64/` | official Node 24 LTS build (glibc 2.28 is enough), SHA-256 pinned in `deploy.sh` and checked against nodejs.org's `SHASUMS256.txt` |
| `/opt/logic2010/app/releases/<time>-<commit>/` | `dist/`, `server/`, `deploy/` of one deployment (root-owned, read-only to the service); the last 5 plus the previous one are kept |
| `/opt/logic2010/app/current` → `releases/…` | the active release (switched by renaming a symlink) |
| `/var/lib/logic2010/logic2010.db` | the SQLite database (+ `-wal`, `-shm`); user `logic2010`, mode 700 |
| `/var/lib/logic2010/backups/` | daily backups `logic2010-YYYY-MM-DD.db`, 14 days kept |
| `/etc/systemd/system/logic2010.service` | the server (`deploy/logic2010.service`), port 8710 on 127.0.0.1 |
| `/etc/systemd/system/logic2010-backup.{service,timer}` | daily backup at 03:30 (+ up to 15 min), also run before each deployment |
| `/etc/httpd/conf.d/logic2010.conf` | `deploy/logic2010-apache.conf`: proxies `/logic2010/` only |

Logs: `journalctl -u logic2010` (one JSON line per request). Status:
`systemctl status logic2010`, `systemctl list-timers logic2010-backup.timer`.

## What deploy.sh does

1. `npm ci && npm run build`.
2. On the server (`remote.sh prepare`): creates the system user `logic2010` (no shell, no
   home), the directories, and installs Node if `/opt/logic2010/node` is not v24.21.0.
3. `rsync` of `dist/ server/ deploy/` (not `server/data`, not tests) into a new release
   directory; unchanged files are hard-linked to the current release.
4. On the server (`remote.sh activate`): backs up the database (if there is one), installs
   the systemd units if they changed (`daemon-reload`), points `current` at the new
   release, restarts `logic2010.service`, and smoke-tests `http://127.0.0.1:8710/logic2010/api/health`
   and the app page. **If the smoke test fails it switches back to the previous release**
   and stops. Then it installs the Apache snippet **only if it changed**, runs
   `apachectl configtest`, and reloads httpd (`systemctl reload httpd`, never restart)
   only if the test passes; if it fails, the previous snippet is put back (or the new one
   removed) and Apache is left untouched. Finally it checks
   `https://motiwala.ca/logic2010/` through Apache (warning only) and prunes old releases.

Every step is idempotent; running it again deploys a fresh release. No existing Apache
file is edited: the only Apache change is the new file `conf.d/logic2010.conf`, which
`httpd.conf` already includes (`IncludeOptional conf.d/*.conf`). Its directives are at
server level, so they apply to both the port-80 vhost (which redirects everything to HTTPS
first) and the HTTPS vhost in `httpd-le-ssl.conf`. They match only `/logic2010` and
`/logic2010/…`.

## SELinux (enforcing)

Checked on the server (read-only):

- **Node binary**: the policy labels `/opt/*/bin/*` as `bin_t` (`matchpathcon
  /opt/logic2010/node/bin/node` → `bin_t`); the script runs `restorecon` after unpacking.
  systemd starts `bin_t` programs in the `unconfined_service_t` domain, so the server is not
  confined by SELinux (the systemd hardening in the unit applies instead). The app files
  under `/opt/logic2010/app` get `usr_t` (readable), the data directory `var_lib_t`.
- **Port 8710** has no SELinux port type (`semanage port -l` does not list it), and
  unconfined services may bind any port. **Apache → 127.0.0.1:8710** is allowed because
  `httpd_can_network_connect` is on (it permits `httpd_t` to connect to any TCP port);
  if that boolean were ever turned off, `setsebool -P httpd_can_network_connect 1` (or
  `semanage port -a -t http_port_t -p tcp 8710`) would be needed.
- The installed unit files and Apache snippet are `restorecon`'d
  (`systemd_unit_file_t`, `httpd_config_t`).
- If something is denied: `ausearch -m avc -ts recent`.

## Rollback

- **To the previous release**: `deploy/deploy.sh --rollback` (or
  `--rollback <release-id>`; release ids are the directory names in
  `/opt/logic2010/app/releases`). By hand on the server:
  `ln -sfn releases/<id> /opt/logic2010/app/current.new && mv -Tf /opt/logic2010/app/current.new /opt/logic2010/app/current && systemctl restart logic2010`.
  Database migrations only add to the schema; an older release refuses to start on a
  database with a *newer* schema version, so after a release that changed the schema,
  restore the pre-deployment backup too (next point).
- **Database**: `systemctl stop logic2010`, then
  `cp /var/lib/logic2010/backups/logic2010-<date>.db /var/lib/logic2010/logic2010.db`,
  `rm -f /var/lib/logic2010/logic2010.db-wal /var/lib/logic2010/logic2010.db-shm`,
  `chown logic2010: /var/lib/logic2010/logic2010.db`, `systemctl start logic2010`.
  (Each deployment makes that day's backup first.)
- **Remove the site completely**:
  `rm /etc/httpd/conf.d/logic2010.conf && apachectl configtest && systemctl reload httpd`,
  `systemctl disable --now logic2010 logic2010-backup.timer`,
  `rm /etc/systemd/system/logic2010*.{service,timer} && systemctl daemon-reload`,
  and optionally `rm -rf /opt/logic2010` (keep `/var/lib/logic2010` for the data) and
  `userdel logic2010`.

## Testing the scripts

`shellcheck deploy/*.sh` is clean. `deploy/deploy.sh --dry-run` runs only read-only
commands on the server. `remote.sh` was also exercised end to end on a development machine
with its paths redirected to a scratch directory and `systemctl`/`apachectl`/`restorecon`
stubbed: Node download and checksum, first deployment, a second deployment with a failing
`apachectl configtest` (snippet restored, no reload), a release that fails its smoke test
(switched back), rollback, and pruning.
