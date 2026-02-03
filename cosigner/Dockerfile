FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY cosigner/target/release/zkml-cosigner /usr/local/bin/
COPY models/ /app/models/
COPY dory_srs_22_variables.srs /app/

WORKDIR /app
ENV MODELS_DIR=/app/models
ENV SRS_PATH=/app/dory_srs_22_variables.srs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

CMD ["zkml-cosigner"]
