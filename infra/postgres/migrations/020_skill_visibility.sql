-- Migration 020: Skill catalog visibility and team ownership
-- Public tenant skills are globally discoverable; private tenant skills are team-scoped.

ALTER TABLE skills ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('private', 'public'));

ALTER TABLE skills ADD COLUMN IF NOT EXISTS team_id TEXT;

CREATE INDEX IF NOT EXISTS idx_skills_visibility ON skills(visibility);
CREATE INDEX IF NOT EXISTS idx_skills_team_id ON skills(team_id);
CREATE INDEX IF NOT EXISTS idx_skills_public_active
  ON skills(status, visibility)
  WHERE scope = 'tenant' AND visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_skills_available_team
  ON skills(tenant_id, team_id, status)
  WHERE scope = 'tenant' AND visibility = 'private';

INSERT INTO schema_migrations (version) VALUES ('020')
    ON CONFLICT (version) DO NOTHING;
