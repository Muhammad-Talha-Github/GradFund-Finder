import { loadEnvConfig } from "@next/env";
import { createDatabase } from "../lib/db";
import { runCollection, type CollectionQuery } from "../lib/discovery/collection-pipeline";

loadEnvConfig(process.cwd());

export const COLLECTION_QUERIES: CollectionQuery[] = [
  { name: "US CS faculty prospective PhD pages", query: 'computer science professor "prospective PhD students" lab USA site:.edu' },
  { name: "US CS professor recruitment homepages", query: 'computer science professor lab "PhD students" recruiting seeking accepting USA site:.edu' },
  { name: "US AI and machine learning lab PhD openings", query: 'AI machine learning computer science lab professor PhD students openings USA site:.edu' },
  { name: "US CS professor looking for doctoral students", query: 'computer science professor "looking for PhD students" USA site:.edu' },
  { name: "US CS faculty accepting new PhD students", query: 'computer science faculty "accepting new PhD students" USA site:.edu' },
  { name: "US PhD lab join pages in computing", query: '"join my lab" PhD computer science professor USA site:.edu' },
  { name: "US CS research group recruitment pages", query: 'computer science research group PhD recruitment positions prospective students USA university site:.edu' },
  { name: "US systems and security CS faculty PhD recruitment", query: 'systems security computer science professor PhD students recruiting USA university lab site:.edu' },
  { name: "US HCI robotics vision CS lab recruitment", query: 'HCI robotics computer vision professor PhD students openings USA computer science site:.edu' },
  { name: "GitHub Pages CS professor PhD pages", query: 'computer science professor "prospective PhD students" openings site:github.io' },
  { name: "GitHub Pages CS lab recruitment pages", query: 'computer science lab professor recruiting PhD students site:github.io' },
  { name: "DuoOffer CS PhD recruitment posts", query: 'computer science professor PhD recruiting openings United States site:duooffer.github.io' },
  { name: "US CS faculty seeking graduate researchers", query: 'computer science faculty "seeking graduate students" PhD USA lab' },
  { name: "US CS professor taking PhD students", query: 'computer science professor "taking PhD students" research group USA' },
  { name: "US CS lab students welcome recruitment", query: 'computer science lab "PhD students" "join" professor USA university' },
  { name: "US NLP and language model lab recruitment", query: 'NLP natural language processing LLM lab professor PhD students recruiting USA site:.edu' },
  { name: "US data systems and database lab recruitment", query: 'database data systems computer science professor PhD students openings USA site:.edu' },
  { name: "US programming languages and theory lab recruitment", query: 'programming languages theory computer science professor PhD students recruiting USA site:.edu' },
  { name: "US networks and distributed systems lab recruitment", query: 'networking distributed systems computer science lab professor PhD openings USA site:.edu' },
  { name: "US computer vision and robotics faculty recruitment", query: 'computer vision robotics professor "PhD students" recruiting lab USA university' },
  { name: "US HCI and human-centered computing recruitment", query: 'HCI human computer interaction professor PhD students join lab USA site:.edu' },
  { name: "US cybersecurity research group recruitment", query: 'cybersecurity computer security professor PhD students join research group USA site:.edu' },
  { name: "US computer vision faculty recruiting PhD students", query: 'computer vision professor lab recruiting PhD students USA university site:.edu' },
  { name: "US 3D vision and visual computing PhD recruitment", query: '3D computer vision visual computing professor seeking PhD students lab USA' },
  { name: "US geospatial machine learning PhD recruitment", query: 'geospatial machine learning professor lab recruiting PhD students USA university' },
  { name: "US remote sensing and spatial AI PhD recruitment", query: 'remote sensing spatial AI geospatial data professor accepting PhD students USA site:.edu' },
  { name: "US AI security and adversarial machine learning PhD recruitment", query: 'AI security adversarial machine learning professor lab PhD students recruiting USA site:.edu' },
  { name: "US trustworthy and responsible AI PhD recruitment", query: 'trustworthy responsible AI professor research lab seeking PhD students USA site:.edu' },
  { name: "US robust and explainable AI faculty recruitment", query: 'robust explainable interpretable AI professor recruiting PhD students USA computer science lab' },
  { name: "US privacy and security in machine learning PhD recruitment", query: 'privacy security machine learning professor PhD students openings research group USA university' },
  { name: "US computer science PhD students invited to apply", query: 'computer science professor "PhD applicants" research lab USA recruiting' },
  { name: "GitHub Pages CS professor recruiting graduate students", query: 'computer science professor "recruiting PhD students" USA site:github.io' },
  { name: "DuoOffer computing PhD opportunities", query: 'computer science computing PhD positions professor USA site:duooffer.github.io' },
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to a mysql:// URL in .env.local before collecting.");
  const db = createDatabase(process.env.DATABASE_URL, { connectionLimit: 5 });
  try {
    const crawlOnly = process.argv.includes("--crawl-only");
    const summary = await runCollection(db, { queries: COLLECTION_QUERIES, crawlOnly });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.status === "FAILED") process.exitCode = 1;
  } finally { await db.end(); }
}

main().catch((error: unknown) => {
  console.error("Collection failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
