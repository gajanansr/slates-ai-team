# Slates runner. Works on ARM64 (Oracle Ampere) and x86: the node image is multi-arch.
FROM node:22-bookworm-slim

# git: agents often need it. ca-certificates: HTTPS to Slates and Anthropic.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Claude Code CLI, pinned so a new release never changes behaviour under you.
ARG CLAUDE_CODE_VERSION=2.1.330
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY runner.mjs lib.mjs work-board.mjs telegram.mjs approvals-mcp.mjs calls.mjs calls-mcp.mjs group.mjs agora.mjs watchers.mjs ntfy.mjs twilio.mjs ./

# Browser tools (BROWSER_TOOLS=1) are NOT baked in: they need a browser plus its system libraries (~400 MB).
# The runner starts @playwright/mcp@0.0.86 with npx (pinned in lib.mjs). Google Chrome has no Linux ARM64 build,
# so on Oracle Ampere set BROWSER_NAME=chromium and add, before "USER node" (as root, version must match @playwright/mcp's):
#   ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
#   RUN npx -y playwright@1.66.0-alpha-2026-11-18 install --with-deps chromium && chmod -R a+rx /opt/ms-playwright

# Everything that must survive restarts lives in /data (state, task folders)
# and the Claude login lives in its own volume.
ENV WORK_DIR=/data/work \
    STATE_FILE=/data/state.json \
    CLAUDE_CONFIG_DIR=/home/node/.claude-config
RUN mkdir -p /data /home/node/.claude-config && chown -R node:node /data /home/node/.claude-config

# Run as the unprivileged "node" user, never root.
USER node
CMD ["node", "runner.mjs"]
