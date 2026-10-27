-- New table names leave any earlier experimental transactions table untouched.
CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  name varchar(100) NOT NULL CHECK (length(trim(name)) > 0),
  balance numeric(24, 2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE account_transactions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  type varchar(6) NOT NULL CHECK (type IN ('credit', 'debit')),
  amount numeric(18, 2) NOT NULL CHECK (amount > 0),
  description varchar(500) NOT NULL DEFAULT '',
  reference_id varchar(100) NOT NULL CHECK (length(trim(reference_id)) > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT account_transactions_reference_key UNIQUE (account_id, reference_id)
);

CREATE INDEX account_transactions_history_idx ON account_transactions (account_id, created_at DESC, id DESC);

CREATE FUNCTION prevent_ledger_transaction_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Transactions cannot be updated, deleted or truncated' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER immutable_account_transactions
BEFORE UPDATE OR DELETE OR TRUNCATE ON account_transactions
FOR EACH STATEMENT EXECUTE FUNCTION prevent_ledger_transaction_changes();