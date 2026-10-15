-- A completed Workflow stores the source identity, resolved arguments, output measurements,
-- and a sanitized snapshot of the server source that actually produced its derivatives.
-- Existing results intentionally remain NULL: their generation history cannot be reconstructed.
ALTER TABLE uploads ADD COLUMN original_sha256 TEXT;
ALTER TABLE uploads ADD COLUMN original_bytes INTEGER;
ALTER TABLE uploads ADD COLUMN editorial_provenance_json TEXT;
ALTER TABLE uploads ADD COLUMN creative_provenance_json TEXT;
ALTER TABLE gallery ADD COLUMN provenance_json TEXT;
