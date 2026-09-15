import * as assert from "assert";

const { parseDate } = require("../../utils/dateUtil");

suite("Date utility test suite", () => {
    test("ignores missing or invalid ForgeBox dates", () => {
        assert.strictEqual(parseDate(undefined), undefined);
        assert.strictEqual(parseDate(""), undefined);
        assert.strictEqual(parseDate("not-a-date"), undefined);
    });

    test("parses valid ForgeBox dates", () => {
        const date = parseDate("2026-08-17T12:00:00.000Z");

        assert.ok(date instanceof Date);
        assert.strictEqual(date.toISOString(), "2026-08-17T12:00:00.000Z");
    });
});
