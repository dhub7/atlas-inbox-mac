import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAllowedPrefix,
  buildCopyArgs,
  destUri,
  parseProgress,
  parseProgressChunk,
  parseSizeToBytes,
} from "../rclone-job.mjs";

test("assertAllowedPrefix accepts inbox and episode paths", () => {
  assert.equal(assertAllowedPrefix("YT-MAIN/00_INBOX"), "YT-MAIN/00_INBOX/");
  assert.equal(
    assertAllowedPrefix("YT-MAIN/00_INBOX/2026-09-10/OZARK/"),
    "YT-MAIN/00_INBOX/2026-09-10/OZARK/"
  );
  assert.equal(
    assertAllowedPrefix("YT-MAIN/episodes/south-dakota-p2/GO-PRO/BRUTO/"),
    "YT-MAIN/episodes/south-dakota-p2/GO-PRO/BRUTO/"
  );
});

test("assertAllowedPrefix rejects escape and other buckets", () => {
  assert.throws(() => assertAllowedPrefix("etc/passwd"), /not allowed/);
  assert.throws(() => assertAllowedPrefix("YT-MAIN/"), /not allowed/);
  assert.throws(() => assertAllowedPrefix("../YT-MAIN/00_INBOX/"), /not allowed/);
  assert.throws(() => assertAllowedPrefix("dropbox-mirror/../secret"), /not allowed/);
});

test("buildCopyArgs never includes delete flags", () => {
  const args = buildCopyArgs({
    srcPath: "/Volumes/HD/OZARK",
    destUri: "b2:atlas-victor-bruto/YT-MAIN/00_INBOX/2026-09-10/",
  });
  assert.equal(args[0], "copy");
  assert.ok(!args.includes("--delete"));
  assert.ok(!args.includes("--delete-excluded"));
  assert.ok(!args.includes("--b2-hard-delete"));
  assert.ok(args.includes("--checksum"));
  assert.ok(args.includes("--fast-list"));
  assert.ok(!args.includes("--dry-run"));
  const dry = buildCopyArgs({
    srcPath: "C:\\tmp\\x",
    destUri: "b2:atlas-victor-bruto/YT-MAIN/00_INBOX/",
    dryRun: true,
    excludes: ["GX010231.MP4"],
  });
  assert.ok(dry.includes("--dry-run"));
  assert.ok(dry.includes("/GX010231.MP4"));
  assert.ok(!dry.includes("--delete"));
});

test("destUri stays on the project bucket", () => {
  assert.equal(
    destUri("atlas-victor-bruto", "YT-MAIN/00_INBOX/smoke/"),
    "b2:atlas-victor-bruto/YT-MAIN/00_INBOX/smoke/"
  );
  assert.throws(() => destUri("other", "YT-MAIN/00_INBOX/"), /bad bucket|not allowed/);
});

test("parseProgress reads rclone stats-one-line", () => {
  const a = parseProgress(
    "Transferred:   	  100.123 MiB / 3.456 GiB, 3%, 4.5 MiB/s, ETA 12m30s"
  );
  assert.ok(a);
  assert.equal(a.percent, 3);
  assert.equal(a.speed, "4.5 MiB/s");
  assert.equal(a.eta, "12m30s");
  assert.ok(a.bytes > 100_000_000);
  assert.ok(a.total > 3_000_000_000);

  const b = parseProgress("Transferred:   	          0 B / 0 B, -, 0 B/s, ETA -");
  assert.ok(b);
  assert.equal(b.bytes, 0);

  assert.equal(parseProgress("just a log line"), null);
});

test("parseSizeToBytes", () => {
  assert.equal(parseSizeToBytes("1 KiB"), 1024);
  assert.equal(parseSizeToBytes("1.5 MiB"), Math.round(1.5 * 1024 * 1024));
  assert.equal(parseSizeToBytes("12 B"), 12);
});

test("parseProgressChunk reads \\r progress and file counts", () => {
  const cr = parseProgressChunk(
    "Transferred:   	  100.123 MiB / 3.456 GiB, 3%, 4.5 MiB/s, ETA 12m30s\r"
  );
  assert.ok(cr);
  assert.equal(cr.percent, 3);
  const block = parseProgressChunk(
    [
      "Transferred:   	    1.234 GiB / 10.000 GiB, 12%, 4.567 MiB/s, ETA 33m20s",
      "Checks:                 12 / 12, 100%",
      "Transferred:            3 / 50, 6%",
      "Elapsed time:        1m12.3s",
    ].join("\n")
  );
  assert.equal(block.percent, 12);
  assert.equal(block.filesDone, 3);
  assert.equal(block.filesTotal, 50);
  assert.equal(block.elapsed, "1m12.3s");
});
