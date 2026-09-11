import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findCollisions, planDecisions, suggestName, walkLocal } from "../scan-dupes.mjs";

test("suggestName increments until free", () => {
  const taken = new Set(["clip.mp4", "clip (2).mp4"]);
  assert.equal(suggestName("clip.mp4", taken), "clip (3).mp4");
  assert.equal(suggestName("GO-PRO/a.mov", new Set(["go-pro/a.mov"])), "GO-PRO/a (2).mov");
});

test("findCollisions flags same name and same size", () => {
  const local = [
    { rel: "GX010231.MP4", size: 100 },
    { rel: "new.mp4", size: 50 },
    { rel: "same-name.mp4", size: 80 },
  ];
  const remote = new Map([
    ["gx010231.mp4", { key: "YT-MAIN/00_INBOX/GX010231.MP4", size: 100 }],
    ["same-name.mp4", { key: "YT-MAIN/00_INBOX/same-name.mp4", size: 90 }],
  ]);
  const hits = findCollisions(local, remote);
  assert.equal(hits.length, 2);
  const a = hits.find((h) => h.rel === "GX010231.MP4");
  const b = hits.find((h) => h.rel === "same-name.mp4");
  assert.equal(a.sameSize, true);
  assert.equal(b.sameSize, false);
  assert.equal(a.suggestedName, "GX010231 (2).MP4");
});

test("planDecisions splits skip replace rename", () => {
  const cols = [
    { rel: "a.mp4", sameSize: true, suggestedName: "a (2).mp4", remoteKey: "p/a.mp4" },
    { rel: "b.mp4", sameSize: false, suggestedName: "b (2).mp4", remoteKey: "p/b.mp4" },
  ];
  const plan = planDecisions(cols, [
    { rel: "a.mp4", action: "skip" },
    { rel: "b.mp4", action: "replace" },
  ]);
  assert.equal(plan.skip.length, 1);
  assert.equal(plan.replace[0].rel, "b.mp4");
});

test("walkLocal skips junk names", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-scan-"));
  fs.writeFileSync(path.join(dir, "keep.txt"), "x");
  fs.writeFileSync(path.join(dir, ".DS_Store"), "x");
  fs.writeFileSync(path.join(dir, "._keep.txt"), "x");
  const { files } = walkLocal(dir);
  assert.deepEqual(
    files.map((f) => f.rel),
    ["keep.txt"]
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
