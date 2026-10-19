import assert from "node:assert/strict";
import test from "node:test";
import { decodeEncodedSearchQuery, extractContactEmails, extractIntentSignals, extractRelevantIntentSignals } from "../lib/discovery/recruitment-scout";

test("decodes encoded search queries safely", () => {
  assert.equal(decodeEncodedSearchQuery("%22funded%20PhD%22%20site%3A.edu"), '"funded PhD" site:.edu');
  assert.throws(() => decodeEncodedSearchQuery("%"), /URI malformed/);
  assert.throws(() => decodeEncodedSearchQuery(""), /search query/);
});

test("finds recruitment intent phrases without treating unrelated text as a lead", () => {
  assert.deepEqual(extractIntentSignals("Our lab is seeking PhD students. Fully funded positions available."), ["positions available", "seeking phd students"]);
  assert.deepEqual(extractIntentSignals("Our lab studies climate data and publishes papers."), []);
  const undergraduateText = "Graduate students can connect with professors. Throughout the year, professors have openings for undergrads to do work in labs.";
  assert.deepEqual(extractRelevantIntentSignals(undergraduateText, "BS | Research Opportunities | Computer Science"), []);
  assert.deepEqual(extractRelevantIntentSignals("Our lab is seeking PhD students.", "Research Group"), ["seeking phd students"]);
});

test("extracts and deduplicates contact email addresses", () => {
  assert.deepEqual(extractContactEmails("Contact A.Lee@Example.edu", "mailto:a.lee@example.edu; lab@example.edu"), ["a.lee@example.edu", "lab@example.edu"]);
});
