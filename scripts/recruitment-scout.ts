import { loadEnvConfig } from "@next/env";
import { runRecruitmentScout } from "@/lib/discovery/recruitment-scout";

loadEnvConfig(process.cwd());

async function main() {
  const queries = process.argv.slice(2).filter((argument) => argument.startsWith("--query=")).map((argument) => argument.slice("--query=".length));
  const result = await runRecruitmentScout(queries);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error("Recruitment scout failed:", error);
  process.exitCode = 1;
});
