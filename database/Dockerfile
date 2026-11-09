FROM postgres:18.6-alpine

# The existing postgres user can initialize the named volume directly.
# Drop the unused root-to-postgres helper and its embedded Go runtime.
RUN apk upgrade --no-cache \
    && rm /usr/local/bin/gosu

USER postgres
