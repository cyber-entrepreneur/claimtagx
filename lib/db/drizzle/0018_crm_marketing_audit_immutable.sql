-- Append-only guard for marketing CMS audit rows (mirrors crm_audit_events).

CREATE OR REPLACE FUNCTION crm_marketing_audit_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'crm_marketing_audit is append-only';
END;
$$;

DROP TRIGGER IF EXISTS crm_marketing_audit_no_update ON crm_marketing_audit;
CREATE TRIGGER crm_marketing_audit_no_update
  BEFORE UPDATE ON crm_marketing_audit
  FOR EACH ROW EXECUTE FUNCTION crm_marketing_audit_immutable();

DROP TRIGGER IF EXISTS crm_marketing_audit_no_delete ON crm_marketing_audit;
CREATE TRIGGER crm_marketing_audit_no_delete
  BEFORE DELETE ON crm_marketing_audit
  FOR EACH ROW EXECUTE FUNCTION crm_marketing_audit_immutable();
