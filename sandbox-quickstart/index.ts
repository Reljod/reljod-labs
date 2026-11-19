import { Sandbox } from "@vercel/sandbox";
import { config } from "dotenv";

// VERCEL_OIDC_TOKEN comes from `vercel env pull .env.local`; it expires after 12 hours.
config({ path: ".env.local" });

const GENERATED = `console.log("Hello from generated code");\n`;

async function main() {
  const sandbox = await Sandbox.getOrCreate({
    name: "my-sandbox-260140",
    // Not persistent: a persistent sandbox snapshots its disk on every stop.
    persistent: false,
    networkPolicy: "deny-all",
  });
  try {
    // getOrCreate may return an existing sandbox created with other settings.
    await sandbox.update({ networkPolicy: "deny-all", persistent: false });

    await sandbox.writeFiles([
      { path: "/vercel/generated.mjs", content: GENERATED },
    ]);
    const result = await sandbox.runCommand("node", ["/vercel/generated.mjs"]);
    const stdout = await result.stdout();
    const stderr = await result.stderr();
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    if (result.exitCode !== 0) process.exitCode = result.exitCode ?? 1;
  } finally {
    // Nothing is kept between runs: delete it, and any snapshot it left.
    await sandbox.stop().catch(() => {});
    await sandbox.delete({ deleteOrphanSnapshots: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
