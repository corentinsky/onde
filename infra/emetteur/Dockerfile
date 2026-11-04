# Émetteur Onde : Liquidsoap (enchaînements) + Icecast (diffusion) + nginx (porte d’entrée, CORS).
# Même version de Liquidsoap que celle testée par Onde (Ubuntu 24.04 : 2.2.4), sur Intel comme sur Apple Silicon.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y liquidsoap icecast2 nginx-light ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
COPY onde.liq nginx.conf icecast.xml.in entrypoint.sh /etc/onde/
RUN chmod +x /etc/onde/entrypoint.sh
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD curl -fsS http://127.0.0.1:8000/ || exit 1
CMD ["/etc/onde/entrypoint.sh"]
