const h = { "x-e2e-token": process.env.E2E_BYPASS_TOKEN };
const runs = await (await fetch("http://localhost:3112/api/operator/runs", { headers: h })).json();
for (const r of runs.slice(0, +(process.argv[2] ?? 3))) console.log(r.id, r.driver, r.model, r.status, r.stoppedBy, r.verdict, "$" + r.costUsd, JSON.stringify(r.metrics), r.error ?? "");
