-- 注销清零: the balance a closed student account still held (20261105000100_accounts.sql).
alter type public.txn_type add value 'closing';
