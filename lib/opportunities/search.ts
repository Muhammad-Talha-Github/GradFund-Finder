const categories = ["SCHOLARSHIP", "FUNDED_POSITION", "GRADUATE_PROGRAM", "PROFESSOR", "LAB", "OTHER_RESEARCH_LEAD"];

export function buildOpportunitySearch(params: URLSearchParams, userId?: string) {
  const clauses: string[] = [];
  const values: unknown[] = userId ? [userId] : [];
  const add = (sql: string, value: unknown) => { values.push(value); clauses.push(sql.replace("?", `$${values.length}`)); };
  if (params.get("savedOnly") === "true") clauses.push('userSaved."userId" IS NOT NULL');
  const degree = params.get("degree");
  if (degree === "Master's") clauses.push('(o."degreeLevel" ILIKE \'%master%\' OR o."degreeLevel" ILIKE \'%msc%\' OR o."degreeLevel" ILIKE \'%m.sc.%\' OR o."degreeLevel" ILIKE \'%m.phil%\')');
  else if (degree === "PhD") clauses.push('(o."degreeLevel" ILIKE \'%phd%\' OR o."degreeLevel" ILIKE \'%ph.d%\' OR o."degreeLevel" ILIKE \'%doctoral%\' OR o."degreeLevel" ILIKE \'%doctorate%\')');
  else if (degree && degree !== "Any degree") add('o."degreeLevel" ILIKE ?', `%${degree}%`);
  const country = params.get("country");
  if (country && country !== "Any country") {
    if (/^(?:united states|usa|u\.?s\.?a?\.?)$/i.test(country.trim())) {
      values.push("%United States%", "USA", "US", "U.S.");
      const patterns = values.slice(-4).map((_, index) => `$${values.length - 3 + index}`);
      clauses.push(`(o."country" ILIKE ${patterns.join(" OR o.\"country\" ILIKE ")})`);
    } else add('o."country" ILIKE ?', `%${country}%`);
  }
  const field = params.get("field");
  if (field && field !== "Any field") {
    values.push(`%${field}%`);
    const pattern = `$${values.length}`;
    clauses.push(`(o."researchField" ILIKE ${pattern} OR o."title" ILIKE ${pattern} OR o."description" ILIKE ${pattern} OR o."department" ILIKE ${pattern} OR o."institution" ILIKE ${pattern} OR o."labGroup" ILIKE ${pattern} OR CAST(o."evidenceExcerpts" AS CHAR) ILIKE ${pattern}${field.toLowerCase() === "computer science" ? ` OR o."department" ILIKE '%computing%' OR o."title" ILIKE '%CS PhD%' OR CAST(o."evidenceExcerpts" AS CHAR) ILIKE '%CS PhD%'` : ""})`);
  }
  const funding = params.get("funding");
  if (funding === "FULL") add('o."fundingClassification"=?::"FundingClassification"', funding);
  else if (funding === "Funded") clauses.push('o."fundingClassification" IN (\'FULL\',\'PARTIAL\')');
  else if (funding === "Unconfirmed") clauses.push('o."fundingClassification" IN (\'UNCLEAR\',\'NO_EVIDENCE\')');
  else if (funding === "Scholarship") clauses.push('o."category"=\'SCHOLARSHIP\'');
  else if (["PARTIAL", "UNCLEAR", "NO_EVIDENCE"].includes(funding ?? "")) add('o."fundingClassification"=?::"FundingClassification"', funding);
  const category = params.get("category"); if (category && categories.includes(category)) add('o."category"=?', category);
  const eligibility = params.get("eligibility")?.trim().slice(0, 120); if (eligibility) add('o."eligibilityRequirements" ILIKE ?', `%${eligibility}%`);
  const search = params.get("q")?.trim().slice(0, 120);
  if (search) {
    values.push(`%${search}%`); const p = `$${values.length}`;
    clauses.push(`(o."title" ILIKE ${p} OR o."description" ILIKE ${p} OR o."institution" ILIKE ${p} OR o."department" ILIKE ${p} OR o."labGroup" ILIKE ${p} OR o."supervisorName" ILIKE ${p})`);
  }
  const deadline = params.get("deadline");
  if (deadline === "Next 30 days" || deadline === "Next 90 days") {
    values.push(new Date(Date.now() + (deadline === "Next 30 days" ? 30 : 90) * 86400000));
    clauses.push(`o."deadline" >= CURRENT_DATE AND o."deadline" <= $${values.length}`);
  }
  const sort = params.get("sort");
  const orderBy = sort === "Deadline" ? 'o."deadline" IS NULL ASC, o."deadline" ASC, o."updatedAt" DESC' : sort === "Country" ? 'o."country" IS NULL ASC, o."country" ASC, o."title" ASC' : sort === "Funding" ? 'o."fundingClassification" ASC, o."updatedAt" DESC' : 'o."discoveryDate" DESC';
  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    values,
    orderBy,
    page: Math.max(1, Number(params.get("page")) || 1),
    pageSize: Math.max(1, Math.min(50, Number(params.get("pageSize")) || 50)),
  };
}
