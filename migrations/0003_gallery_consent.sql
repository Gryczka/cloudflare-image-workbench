-- Existing uploads deliberately receive no consent. Never infer permission from approval.
ALTER TABLE uploads ADD COLUMN gallery_consent_at INTEGER;
ALTER TABLE uploads ADD COLUMN consent_credit TEXT;
