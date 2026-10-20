#!/bin/sh
# Build the desktop app (Electron) for one or more platforms, start to finish:
# install dependencies, build the client, package, and (macOS) sign + notarize.
#
#   ./scripts/build-desktop.sh            the platform you are on
#   ./scripts/build-desktop.sh mac win    several at once (win needs Rosetta on
#                                         Apple Silicon; mac needs macOS)
#   ./scripts/build-desktop.sh mac --no-notarize   sign only (quick local test)
#
# macOS notarization reads APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and
# APPLE_TEAM_ID from the environment, or from ~/.boardcache-sign.env (or the
# file named by BOARDCACHE_SIGN_ENV) when it exists. Without them the app is
# signed but NOT notarized, and the script says so.
set -eu
cd "$(dirname "$0")/.."

NOTARIZE=1
PLATFORMS=""
for arg in "$@"; do
  case "$arg" in
    mac | win | linux) PLATFORMS="$PLATFORMS $arg" ;;
    --no-notarize) NOTARIZE=0 ;;
    -h | --help)
      sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "build-desktop: unknown argument '$arg' (mac, win, linux, --no-notarize)" >&2
      exit 2
      ;;
  esac
done
if [ -z "$PLATFORMS" ]; then
  case "$(uname -s)" in
    Darwin) PLATFORMS="mac" ;;
    Linux) PLATFORMS="linux" ;;
    *) PLATFORMS="win" ;;
  esac
fi

command -v node >/dev/null 2>&1 || { echo "build-desktop: Node 20+ is required (nodejs.org or 'brew install node@22')" >&2; exit 1; }
if ! command -v pnpm >/dev/null 2>&1; then
  echo "build-desktop: enabling pnpm through Corepack"
  corepack enable 2>/dev/null || {
    echo "build-desktop: pnpm is missing — run 'corepack enable' (sudo if needed) or 'brew install pnpm'" >&2
    exit 1
  }
fi

SIGN_ENV="${BOARDCACHE_SIGN_ENV:-$HOME/.boardcache-sign.env}"
if [ -f "$SIGN_ENV" ]; then
  # shellcheck disable=SC1090
  . "$SIGN_ENV"
fi

# A shell that exports this makes `electron` behave like plain node.
unset ELECTRON_RUN_AS_NODE || true

echo "build-desktop: installing dependencies"
pnpm install

echo "build-desktop: building the client"
VITE_BUILD_ID=$(date +%s) pnpm --filter @boardcache/client build

cd apps/desktop
node ../../scripts/build-config.cjs > app-config.json
echo "build-desktop: bundling the MCP launcher"
pnpm run mcp
echo "build-desktop: sync server $(node -p 'require("./app-config.json").syncServer')"
for platform in $PLATFORMS; do
  EXTRA=""
  if [ "$platform" = "mac" ]; then
    if [ "$(uname -s)" != "Darwin" ]; then
      echo "build-desktop: the mac build needs macOS — skipped" >&2
      continue
    fi
    if [ "$NOTARIZE" = "0" ]; then
      EXTRA="-c.mac.notarize=false"
      echo "build-desktop: mac — signing only (--no-notarize)"
    elif [ -z "${APPLE_ID:-}" ] || [ -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] || [ -z "${APPLE_TEAM_ID:-}" ]; then
      EXTRA="-c.mac.notarize=false"
      echo "build-desktop: mac — NOT notarizing: set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and"
      echo "               APPLE_TEAM_ID (or put them in $SIGN_ENV). Fine for your own Mac;"
      echo "               other Macs will block the app."
    else
      echo "build-desktop: mac — signing and notarizing (a few minutes at Apple)"
    fi
  fi
  echo "build-desktop: packaging for $platform"
  # shellcheck disable=SC2086
  pnpm exec electron-builder --config electron-builder.json "--$platform" $EXTRA
done

echo
echo "build-desktop: done — installers are in apps/desktop/release/"
ls -1 release 2>/dev/null | grep -E '\.(dmg|exe|AppImage|deb)$' | sed 's/^/  /' || true
