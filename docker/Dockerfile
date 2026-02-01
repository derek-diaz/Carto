FROM debian:bookworm-slim


RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg \
  && rm -rf /var/lib/apt/lists/*

# zenohd + remote-api plugin
RUN echo "deb [trusted=yes] https://download.eclipse.org/zenoh/debian-repo/ /" \
      > /etc/apt/sources.list.d/zenoh.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
      zenohd \
      zenoh-plugin-remote-api \
  && rm -rf /var/lib/apt/lists/*


EXPOSE 7447/tcp
EXPOSE 10000/tcp
EXPOSE 8000/tcp
