-- Deferred backstop for the zero-sum invariant enforced in application
-- code (src/routes/transactions.ts). A DEFERRABLE INITIALLY DEFERRED
-- constraint trigger runs once per affected entries row, but not until
-- commit — so every entry belonging to a transaction has already been
-- inserted by the time the sum is checked, regardless of statement order.
CREATE FUNCTION check_transaction_zero_sum() RETURNS trigger AS $$
DECLARE
	affected_transaction_id uuid;
	total bigint;
BEGIN
	affected_transaction_id := COALESCE(NEW.transaction_id, OLD.transaction_id);

	SELECT COALESCE(SUM(amount), 0) INTO total
	FROM entries
	WHERE transaction_id = affected_transaction_id;

	IF total <> 0 THEN
		RAISE EXCEPTION 'transaction % entries do not sum to zero (got %)', affected_transaction_id, total;
	END IF;

	RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER entries_zero_sum
	AFTER INSERT OR UPDATE OR DELETE ON entries
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW
	EXECUTE FUNCTION check_transaction_zero_sum();
