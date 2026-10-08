-- MonCoach : liaison des profils au compte central (compte.kayto.org).
-- À exécuter AVANT le déploiement du nouveau Worker (sans danger pour l'ancien : simple colonne en plus).
ALTER TABLE members ADD COLUMN account_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_account_id ON members(account_id) WHERE account_id IS NOT NULL;
