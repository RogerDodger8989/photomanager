# PostgreSQL 16 med pgvector + PostGIS + pg_trgm
FROM postgis/postgis:16-3.4

# Installera pgvector
RUN apt-get update && apt-get install -y \
    postgresql-16-pgvector \
  && rm -rf /var/lib/apt/lists/*
