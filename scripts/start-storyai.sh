#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$project_root"

open_config() {
  if command -v open >/dev/null 2>&1; then
    open -e .env
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open .env >/dev/null 2>&1 || true
  fi
}

generate_key_if_needed() {
  if grep -q '^SEEDANCE_CREDENTIALS_ENCRYPTION_KEY=GENERATE_ON_FIRST_START$' .env \
    || ! grep -q '^SEEDANCE_CREDENTIALS_ENCRYPTION_KEY=.' .env; then
    if ! command -v openssl >/dev/null 2>&1; then
      echo "Install OpenSSL or replace the encryption-key placeholder in .env."
      return 1
    fi
    local key temporary_file
    key="$(openssl rand -hex 32)"
    temporary_file="$(mktemp)"
    if grep -q '^SEEDANCE_CREDENTIALS_ENCRYPTION_KEY=' .env; then
      sed "s/^SEEDANCE_CREDENTIALS_ENCRYPTION_KEY=.*/SEEDANCE_CREDENTIALS_ENCRYPTION_KEY=$key/" .env > "$temporary_file"
    else
      cat .env > "$temporary_file"
      printf '\nSEEDANCE_CREDENTIALS_ENCRYPTION_KEY=%s\n' "$key" >> "$temporary_file"
    fi
    mv "$temporary_file" .env
    chmod 600 .env
  fi
}

if [ ! -f .env ]; then
  cp .env.docker.example .env
  temporary_file="$(mktemp)"
  sed \
    -e "s/^STORYAI_UID=.*/STORYAI_UID=$(id -u)/" \
    -e "s/^STORYAI_GID=.*/STORYAI_GID=$(id -g)/" \
    .env > "$temporary_file"
  mv "$temporary_file" .env
  chmod 600 .env
  generate_key_if_needed
fi

generate_key_if_needed

if ! grep -q '^STORYAI_IMAGE=' .env; then
  printf '\n%s\n' "$(grep '^STORYAI_IMAGE=' .env.docker.example)" >> .env
fi
if ! grep -q '^STORYAI_UID=' .env; then printf '\nSTORYAI_UID=1000\n' >> .env; fi
if ! grep -q '^STORYAI_GID=' .env; then printf 'STORYAI_GID=1000\n' >> .env; fi
temporary_file="$(mktemp)"
sed \
  -e "s/^STORYAI_UID=.*/STORYAI_UID=$(id -u)/" \
  -e "s/^STORYAI_GID=.*/STORYAI_GID=$(id -g)/" \
  .env > "$temporary_file"
mv "$temporary_file" .env
chmod 600 .env
mkdir -p data

if grep -q '^STORYAI_IMAGE=ghcr.io/OWNER/REPOSITORY:latest$' .env; then
  echo "Set STORYAI_IMAGE in .env to the registry image published for your installation."
  open_config || true
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Desktop (macOS/Windows) or Docker Engine with Compose (Linux)."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required. Update Docker Desktop or install the Compose plugin."
  exit 1
fi

wait_for_healthy() {
  local container_id status attempt
  container_id="$(docker compose ps -q storyai | head -n 1)"
  [ -n "$container_id" ] || return 1
  for attempt in $(seq 1 60); do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)"
    [ "$status" = "healthy" ] && return 0
    [ "$status" = "unhealthy" ] && return 1
    sleep 2
  done
  return 1
}

restore_previous_image() {
  [ -n "$previous_image" ] || return 1
  docker image tag "$previous_image" "$image_ref" || return 1
  docker compose up -d --pull never --force-recreate --remove-orphans || return 1
  wait_for_healthy
}

previous_image="$(docker compose images -q storyai 2>/dev/null | head -n 1 || true)"
image_ref="$(sed -n 's/^STORYAI_IMAGE=//p' .env | tail -n 1)"
echo "Checking for StoryAI updates..."
if docker compose pull; then
  if ! docker compose up -d --remove-orphans; then
    echo "The new version failed to start. Restoring the previous version..."
    restore_previous_image || exit 1
  fi
else
  echo "Update download failed; trying the last installed version."
  if ! docker compose up -d --pull never --remove-orphans; then
    echo "No usable StoryAI image is available locally."
    exit 1
  fi
fi

if ! wait_for_healthy; then
  if [ -n "$previous_image" ]; then
    echo "The new version did not become healthy. Restoring the previous version..."
    if ! restore_previous_image; then
      docker compose logs --tail=80 storyai
      echo "The previous version was restored but did not become healthy."
      exit 1
    fi
  else
    docker compose logs --tail=80 storyai
    echo "StoryAI did not become healthy. Data in ./data was preserved."
    exit 1
  fi
fi

storyai_port="$(sed -n 's/^STORYAI_PORT=//p' .env | tail -n 1)"
storyai_port="${storyai_port:-3011}"
storyai_url="http://localhost:${storyai_port}"
echo "StoryAI is starting at ${storyai_url}"

if command -v open >/dev/null 2>&1; then
  open "$storyai_url"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$storyai_url" >/dev/null 2>&1 || true
fi
