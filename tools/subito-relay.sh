#!/bin/zsh
# Daily Subito relay for the Abruzzo region, run on a Mac at home (launchd:
# tools/com.casatrova.subito-relay.plist). Works in its own clone, so the
# owner's working copy is never touched; commits only the Subito snapshot.
set -e
DIR="$HOME/.casatrova-relay/summerhome"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [[ ! -d "$DIR/.git" ]]; then
  mkdir -p "${DIR:h}"
  git clone --depth 20 https://github.com/Bloom79/summerhome.git "$DIR"
fi
cd "$DIR"
git fetch --depth 20 origin main
git reset --hard origin/main
node scripts/it/subito-relay.mjs
git add public/it/cache/subito.json
git -c user.name='casatrova-relay' -c user.email='noreply@github.com' \
  commit -m "Subito relay $(date -u +%F)" || exit 0
for i in 1 2 3; do
  git pull --rebase origin main && git push origin HEAD:main && exit 0
  sleep 20
done
exit 1
