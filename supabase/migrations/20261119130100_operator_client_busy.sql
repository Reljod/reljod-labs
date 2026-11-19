-- Operator: one call at a time on a Run an outside MCP client drives.
--
-- A client-driven Run has no workflow to put its calls in order, and two MCP
-- calls on the same Run could each read the same counters, take the same
-- Frame number and overshoot the Run's caps. A call claims the Run by setting
-- `client_busy_until` (a lease, so a call that died does not hold it for
-- good) and clears it when it answers. Purely additive: a nullable column the
-- code already deployed never reads.

alter table operator.runs
  add column if not exists client_busy_until timestamptz;
