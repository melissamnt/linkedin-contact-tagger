import { test } from "node:test";
import assert from "node:assert/strict";
import { extractNameFromTitle, extractProfileUrl } from "../src/profile-url.js";

test("extractProfileUrl: canonical form for a plain profile URL", () => {
  assert.equal(extractProfileUrl("https://www.linkedin.com/in/juan-perez/"), "https://www.linkedin.com/in/juan-perez/");
});

test("extractProfileUrl: case variants map to the same record", () => {
  assert.equal(extractProfileUrl("https://www.linkedin.com/in/Juan-Perez"), "https://www.linkedin.com/in/juan-perez/");
});

test("extractProfileUrl: sub-pages, query and hash collapse to the profile", () => {
  const expected = "https://www.linkedin.com/in/juan-perez/";
  assert.equal(extractProfileUrl("https://www.linkedin.com/in/juan-perez/details/experience/"), expected);
  assert.equal(extractProfileUrl("https://www.linkedin.com/in/juan-perez/?trk=abc"), expected);
  assert.equal(extractProfileUrl("https://www.linkedin.com/in/juan-perez#about"), expected);
});

test("extractProfileUrl: other LinkedIn subdomains normalize to www", () => {
  assert.equal(extractProfileUrl("https://es.linkedin.com/in/juan-perez/"), "https://www.linkedin.com/in/juan-perez/");
});

test("extractProfileUrl: encoded and decoded non-ASCII slugs match", () => {
  const encoded = extractProfileUrl("https://www.linkedin.com/in/mar%C3%ADa-g/");
  const decoded = extractProfileUrl("https://www.linkedin.com/in/María-G/");
  assert.equal(encoded, "https://www.linkedin.com/in/mar%C3%ADa-g/");
  assert.equal(decoded, encoded);
});

test("extractProfileUrl: malformed escapes are not double-encoded", () => {
  assert.equal(extractProfileUrl("https://www.linkedin.com/in/bad%E0%A4"), "https://www.linkedin.com/in/bad%e0%a4/");
});

test("extractProfileUrl: rejects non-profile and non-LinkedIn URLs", () => {
  for (const url of [
    null,
    "",
    "not a url",
    "https://www.linkedin.com/feed/",
    "https://www.linkedin.com/company/acme/",
    "https://evillinkedin.com/in/juan/",
    "https://linkedin.com.evil.com/in/juan/",
  ]) {
    assert.equal(extractProfileUrl(url), null, String(url));
  }
});

test("extractNameFromTitle: strips the LinkedIn suffix and unread badge", () => {
  assert.equal(extractNameFromTitle("Juan Pérez | LinkedIn"), "Juan Pérez");
  assert.equal(extractNameFromTitle("(3) Juan Pérez | LinkedIn"), "Juan Pérez");
});

test("extractNameFromTitle: empty input gives an empty name", () => {
  assert.equal(extractNameFromTitle(""), "");
  assert.equal(extractNameFromTitle(undefined), "");
  assert.equal(extractNameFromTitle(" | LinkedIn"), "");
});
