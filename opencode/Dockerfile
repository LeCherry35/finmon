# opencode sidecar for finmon's in-app assistant. Runs `opencode serve` on the
# private `agent` network only (see docker-compose.yml). It has no repo, no
# source code and no DB credentials: its only capability is the finmon MCP
# tools, reached over HTTP with a per-user token finmon writes into
# /agents/<user-hash>/opencode.json (a read-only mount here).
FROM node:22-bookworm-slim

# Pinned: the lockdown was verified against this version (see src/lib/opencode.ts).
ARG OPENCODE_VERSION=1.18.28
RUN npm install -g "opencode-ai@${OPENCODE_VERSION}" && npm cache clean --force

# Same uid/gid as the app's `nextjs` user, so the 0600 per-user configs the app
# writes into the shared volume are readable here and nowhere else.
RUN groupadd --system --gid 1001 agent \
 && useradd --system --uid 1001 --gid 1001 --create-home --home-dir /home/agent agent \
 && mkdir -p /home/agent/.config/opencode /home/agent/.local/share/opencode /home/agent/.local/state /home/agent/.cache /agents \
 && chown -R agent:agent /home/agent /agents

# Global defaults: deny everything. Each user's config narrows it further to
# "deny all, allow finmon_*".
COPY --chown=agent:agent global-config.json /home/agent/.config/opencode/opencode.json

USER agent
WORKDIR /home/agent
ENV OPENCODE_DISABLE_AUTOUPDATE=true \
    OPENCODE_DISABLE_LSP_DOWNLOAD=true

EXPOSE 4096
CMD ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096", "--pure"]
