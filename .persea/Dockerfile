FROM node:18-slim

WORKDIR /workspace

RUN rm -rf /var/lib/apt/lists/* && \
    apt-get -o Acquire::Retries=3 -o Acquire::http::No-Cache=true update && \
    apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
      build-essential \
      openssl \
      ca-certificates \
      git \
      python3 && \
    rm -rf /var/lib/apt/lists/*
