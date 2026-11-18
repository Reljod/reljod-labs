const h = { "x-e2e-token": process.env.E2E_BYPASS_TOKEN };
const runs = await (await fetch("http://localhost:3112/api/operator/runs", { headers: h })).json();
const d = await (await fetch(`http://localhost:3112/api/operator/runs/${process.argv[2] ?? runs[0].id}`, { headers: h })).json();
for (const e of d.events.slice(-(+(process.argv[3] ?? 14)))) console.log(e.seq, e.type, JSON.stringify({ ...e, seq: undefined, at: undefined, type: undefined, changes: undefined, caret: undefined, pointer: undefined }).slice(0, 260));
