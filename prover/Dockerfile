FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY prover/target/release/zkml-prover /usr/local/bin/
COPY models/ /app/models/
COPY dory_srs_22_variables.srs /app/

WORKDIR /app
ENV MODELS_DIR=/app/models
ENV SRS_PATH=/app/dory_srs_22_variables.srs

ENTRYPOINT ["zkml-prover"]
