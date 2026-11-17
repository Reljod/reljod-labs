import { Sandbox } from "@vercel/sandbox";
import { config } from "dotenv";

// VERCEL_OIDC_TOKEN comes from `vercel env pull .env.local`; it expires after 12 hours.
config({ path: ".env.local" });

const GENERATED = `console.log("Hello from generated code");\n`;

async function main() {
  const sandbox = await Sandbox.getOrCreate({
    name: "my-sandbox-260140",
    persistent: true,
    networkPolicy: "deny-all",
  });
  try {
    // getOrCreate may return an existing sandbox created with another policy.
    await sandbox.update({ networkPolicy: "deny-all" });

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
    await sandbox.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
