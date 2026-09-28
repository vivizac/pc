-- Production introduced the first observation-note no-op guard in this migration.
-- It was immediately superseded by 20260909041814, which moves the content-equality
-- check ahead of revision conflict handling. Fresh environments receive the final
-- function definition in the following migration.
select 1;
