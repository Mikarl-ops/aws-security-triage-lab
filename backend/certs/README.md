# Public RDS certificate authorities

`rds-global-bundle.pem` contains public CA certificates, not a private key. It was retrieved from the [official RDS global trust store](https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem) on 2026-11-02. The checksum in `rds-global-bundle.sha256` records the exact reviewed bytes. Production images install it at `/etc/tracker/rds-ca.pem` for a DATABASE_URL using `sslmode=verify-full&sslrootcert=/etc/tracker/rds-ca.pem`.

Review CA updates before any deployment and by 2027-02-01. Download from the official HTTPS source, review the certificate subjects and validity/rotation guidance, update the snapshot and checksum together, rebuild, and repeat the TLS smoke test and image scan. Do not disable verification when a certificate changes. The [RDS TLS guidance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html) remains authoritative for live region/engine requirements.

CI verifies the snapshot checksum and rejects private-key material. The local integration test mounts a separate temporary test CA; its generated private keys are never included in images or Git.
