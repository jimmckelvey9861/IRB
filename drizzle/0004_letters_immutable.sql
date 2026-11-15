-- Issued letters are permanent records of what the investigator was told (21 CFR 56.115(a)(4)).
CREATE TRIGGER letters_no_update_delete BEFORE UPDATE OR DELETE ON letters
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER letters_no_truncate BEFORE TRUNCATE ON letters
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
