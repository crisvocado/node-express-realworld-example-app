FROM node:20-slim

WORKDIR /workspace

RUN rm -rf /var/lib/apt/lists/* && \
    apt-get -o Acquire::Retries=3 -o Acquire::http::No-Cache=true update && \
    apt-get -o Acquire::Retries=3 -y --no-install-recommends install \
        build-essential \
        ca-certificates \
        openssl \
        python3 && \
    rm -rf /var/lib/apt/lists/*
