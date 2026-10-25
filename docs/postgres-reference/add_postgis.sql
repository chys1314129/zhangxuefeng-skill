-- prisma/migrations/add_postgis/migration.sql

CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE toilets ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326);

UPDATE toilets SET geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
WHERE geom IS NULL;

CREATE INDEX IF NOT EXISTS idx_toilets_geom ON toilets USING GIST(geom);

CREATE OR REPLACE FUNCTION update_toilet_geom()
RETURNS TRIGGER AS $$
BEGIN
  NEW.geom = ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_toilet_geom ON toilets;
CREATE TRIGGER trigger_update_toilet_geom
  BEFORE INSERT OR UPDATE OF lng, lat ON toilets
  FOR EACH ROW
  EXECUTE FUNCTION update_toilet_geom();
