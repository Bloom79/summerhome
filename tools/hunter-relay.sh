#!/bin/zsh
# Daily deal-hunter review on the owner's Mac (launchd 09:00, after the
# 06:30 UTC Abruzzo refresh): Claude Code with the owner's Claude plan reviews
# the new or re-priced houses on the shortlist, then the verdicts are pushed
# (public/it/hunter.json) and the site redeploys. New genuine deals open a
# GitHub issue and show a macOS notification. Works in its own clone.
set -e
DIR="$HOME/.casatrova-relay/summerhome"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
if [[ ! -d "$DIR/.git" ]]; then
  mkdir -p "${DIR:h}"
  git clone --depth 20 https://github.com/Bloom79/summerhome.git "$DIR"
fi
cd "$DIR"
git fetch --depth 20 origin main
git reset --hard origin/main
OUT=$(HUNTER_LLM=claude node scripts/it/hunter.mjs)
print -r -- "$OUT"
NEW=$(print -r -- "$OUT" | sed -n 's/^new_true=//p')
git add public/it/hunter.json
git -c user.name='casatrova-relay' -c user.email='noreply@github.com' \
  commit -m "Cacciatore $(date -u +%F): $(print -r -- "$OUT" | sed -n 's/^summary=//p')" || exit 0
for i in 1 2 3; do
  if git pull --rebase origin main && git push origin HEAD:main; then break; fi
  sleep 20
done
if [[ -n "$NEW" && "$NEW" != "0" ]]; then
  gh issue create --repo Bloom79/summerhome \
    --title "🎯 Altopiano $(date +%F): $NEW nuove vere occasioni" \
    --body "$(cat hunter-report.md)

Nell'app: https://bloom79.github.io/summerhome/?r=it (🎯 in alto)" || true
  osascript -e "display notification \"$NEW nuove vere occasioni sull'Altopiano\" with title \"🎯 CasaTrova\" sound name \"Glass\"" || true
fi
