create table if not exists payouts (
  payout_id        bigint      not null,
  sender            text        not null,
  recipient         text        not null,
  source_asset      text        not null,
  dest_asset        text        not null,
  amount_delivered  numeric     not null,
  success           boolean     not null,
  ledger            bigint      not null,
  created_at        timestamptz not null default now(),
  primary key (payout_id, recipient)
);

create table if not exists batches (
  payout_id           bigint primary key,
  sender               text    not null,
  recipient_count      int     not null,
  success_count        int     not null,
  total_source_amount  numeric not null,
  ledger               bigint  not null
);

create table if not exists cursor (
  id             int primary key default 1,
  last_ledger    bigint not null
);

create index if not exists idx_payouts_sender on payouts(sender);
