import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { buildOpportunitySearch } from "@/lib/opportunities/search";
import { getRequestUser } from "@/lib/auth/session";
import { unauthorized } from "@/lib/auth/request";

const leadStatusSql = `CASE WHEN o."fundingClassification" IN ('FULL','PARTIAL') AND o."status"='OPEN' AND o."category" <> 'OTHER_RESEARCH_LEAD' AND o."title" NOT REGEXP '(guide|advice|tips|how to|top[[:space:]]+[0-9]+|best[[:space:]]+[0-9]+|roundup|scholarship database|list of scholarships)' AND NOT (o."sourceUrl" REGEXP '^https?://[^/]+/?$' AND o."title" REGEXP '(university|college|institute|campus|home|welcome)') THEN 'CONFIRMED_FUNDED' WHEN o."category" IN ('PROFESSOR','LAB') THEN 'PROFESSOR_OR_LAB_LEAD' ELSE 'POTENTIAL_OPPORTUNITY' END`;

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    const { searchParams } = new URL(request.url);
    const search = buildOpportunitySearch(searchParams, user.id);
    const records = await query(`SELECT o.*, (userSaved."userId" IS NOT NULL) AS "userIsSaved", DATE_FORMAT(o."deadline", '%Y-%m-%d') AS "deadlineDate", COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('url',s."sourceUrl",'canonicalUrl',s."canonicalUrl")) FROM "OpportunitySource" s WHERE s."opportunityId"=o."id"), JSON_ARRAY()) AS "sources", ${leadStatusSql} AS "leadStatus" FROM "Opportunity" o LEFT JOIN "UserSavedOpportunity" userSaved ON userSaved."opportunityId"=o."id" AND userSaved."userId"=$1 ${search.where} ORDER BY ${search.orderBy}`, search.values);
    // Recruitment quality is checked against the full fetched page during
    // ingestion. Re-running that gate over Gemini's shorter evidence output
    // hid valid saved opportunities when extraction was incomplete.
    const total = records.rows.length;
    const start = (search.page - 1) * search.pageSize;
    const pageRecords = records.rows.slice(start, start + search.pageSize);
    return NextResponse.json({ opportunities: pageRecords.map((record) => ({ ...record, isSaved: Boolean(record.userIsSaved), deadlineLabel: record.deadlineDate ?? "Unknown" })), page: search.page, pageSize: search.pageSize, total, pages: Math.max(1, Math.ceil(total / search.pageSize)), searchType: "database" });
  } catch (error) { return apiError(error); }
}
