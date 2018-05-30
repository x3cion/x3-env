
import * as chai from "chai";
const should = chai.should();

import env from ".";

function compareResults(resultA: Map<string, string>, resultB: Map<string, string>) {
	resultA.size.should.equal(resultB.size);
	for (let [key, value] of resultA) {
		resultA.has(key).should.be.true;
		resultA.get(key).should.equal(resultB.get(key));
	}
}

describe("Test env parsing", () => {
	it("should parse a simple env file", async () => {
		const content = " TEST=123";
		const parsed = await env({ content });
		compareResults(parsed, new Map([["TEST", "123"]]));
	});

	it("should handle unquoted strings correctly", async () => {
		const content = "TEST1=a first\nTEST2=a 2nd";
		const parsed = await env({content});
		compareResults(parsed, new Map([["TEST1", "a first"], ["TEST2", "a 2nd"]]));
	});

	it("should parse an env value into a variable", async () => {
		process.env["TESTENVKEY"] = "testenv value " + Math.random();
		const content = "TEST=home is $TESTENVKEY !";
		const parsed = await env({ content });
		compareResults(parsed, new Map([["TEST", `home is ${process.env["TESTENVKEY"]} !`]]));
	});

	it("should parse values within the file into following values within the file", async () => {
		const content = "TEST1=content\nTEST2=content is $TEST1";
		const parsed = await env({ content });
		compareResults(parsed, new Map([["TEST1", "content"], ["TEST2", "content is content"]]));
	});

	it("should support multiline comments with \"", async () => {
		const content = "TEST='content\nand more content\n'";
		const parsed = await env({content});
		compareResults(parsed, new Map([["TEST", "content\nand more content\n"]]));
	});

	it("should replace unkown variables with nothing", async () => {
		const content = "TEST=$ANONVAR";
		const parsed = await env({content});
		compareResults(parsed, new Map([["TEST", ""]]));
	});

	it("should not replace known variables within single quoted", async () => {
		const content = "TEST1=true\nTEST2='test1 is $TEST1'";
		const parsed = await env({content});
		compareResults(parsed, new Map([["TEST1", "true"], ["TEST2", "test1 is $TEST1"]]));
	});

	it("should ignore comments", async () => {
		const content = "#abc\nTEST=abc";
		const parsed = await env({content});
		compareResults(parsed, new Map([["TEST", "abc"]]));
	});
});