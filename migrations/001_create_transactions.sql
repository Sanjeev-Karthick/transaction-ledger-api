CREATE TABLE transactions (
  id uuid PRIMARY KEY,
  reference varchar(100) NOT NULL UNIQUE CHECK (reference ~ '^[a-zA-Z0-9._:-]+$'),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 999999999999999999),
  currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  direction varchar(6) NOT NULL CHECK (direction IN ('credit', 'debit')),
  description varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX transactions_created_at_id_idx ON transactions (created_at DESC, id DESC);

-- Example records are append-only, including for the owner. Correct mistakes with new entries.
CREATE FUNCTION reject_transaction_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Transactions are append-only' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER transactions_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON transactions
FOR EACH STATEMENT EXECUTE FUNCTION reject_transaction_mutation();