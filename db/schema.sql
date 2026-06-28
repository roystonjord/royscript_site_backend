-- RoyScript contact submissions
-- Target: PostgreSQL 17. Run against the application database (royscript_site).
-- gen_random_uuid() is built into Postgres core (13+), no extension needed.

CREATE TABLE IF NOT EXISTS contact_submissions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    email       text        NOT NULL,
    phone       text,
    company     text,
    message     text        NOT NULL,
    status      text        NOT NULL DEFAULT 'new'
                            CHECK (status IN ('new', 'read', 'archived')),
    ip_address  text,
    user_agent  text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_created_at
    ON contact_submissions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_status
    ON contact_submissions (status);
