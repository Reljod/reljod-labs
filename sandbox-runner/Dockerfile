# The Sandbox image: Python 3, Node, a non-root user and a workdir. Nothing else.
# Build: docker build -t harness-sandbox:1 sandbox-runner/
# The uid must match SANDBOX_UID in runner.mjs (the /work tmpfs is mounted for it).
FROM python:3.13-alpine

RUN apk add --no-cache nodejs \
 && addgroup -g 10001 sandbox \
 && adduser -D -H -u 10001 -G sandbox -h /work -s /bin/sh sandbox \
 && mkdir -p /work \
 && chown sandbox:sandbox /work

ENV HOME=/work PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER sandbox
WORKDIR /work
CMD ["sleep", "infinity"]
