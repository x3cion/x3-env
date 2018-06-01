import { Transform, Writable, Readable } from "stream";
import { StringDecoder, NodeStringDecoder } from "string_decoder";
import { createReadStream } from "fs";
import { EOL } from "os";

export class X3EnvParser extends Transform {
	static KEY_FIRST_CHAR_REGEX = /[a-zA-Z_]/;
	static KEY_TAIL_CHAR_REGEX = /[\w]/;
	static LINE_ENDING = new RegExp(`[${EOL}]`);
	static SPACE = /\s/;
	static QUOTE = /['"]/;
	static STRING_VARIABLE = /\$([a-zA-Z_][\w]*)/g;

	constructor() {
		super({ readableObjectMode: true });
	}

	stringDecoder: NodeStringDecoder = new StringDecoder("utf8");

	gatheredValues: Map<string, string> = new Map();

	inValue = false;
	inComment = false;
	lastWasEqualSign = false;
	lastWasEscape = false;

	currentContent = "";

	currentValue = "";
	currentKey = "";
	currentQuote = null;

	currentLineCount = 1;
	currentColumnCount = 0;

	isKeyBeginning(char: string): boolean {
		return (<RegExp>this.constructor["KEY_FIRST_CHAR_REGEX"]).test(char);
	}

	isKeyTail(char: string): boolean {
		return (<RegExp>this.constructor["KEY_TAIL_CHAR_REGEX"]).test(char);
	}

	isLineEnding(char: string): boolean {
		return (<RegExp>this.constructor["LINE_ENDING"]).test(char);
	}

	isSpace(char: string): boolean {
		return (<RegExp>this.constructor["SPACE"]).test(char);
	}

	isQuote(char: string): boolean {
		return (<RegExp>this.constructor["QUOTE"]).test(char);
	}

	getPosition(): string {
		return `${this.currentLineCount}:${this.currentColumnCount}`;
	}

	getParsedValue(): string {
		if (!this.currentValue) return "";
		const output = this.currentValue.replace((<RegExp>this.constructor["STRING_VARIABLE"]), (match: string, varName: string) => {
			let response = "";
			if (this.gatheredValues.has(varName)) {
				response = this.gatheredValues.get(varName);
			} else if (typeof process.env[varName] !== "undefined") {
				response = process.env[varName];
			}
			return response;
		});

		return output;
	}

	pushEntry({ allowEmpty = false }: { allowEmpty?: boolean } = {}) {
		if (allowEmpty && !this.currentKey) {
			return;
		}
		if (!allowEmpty && !this.currentKey) {
			throw new Error(`Key empty when trying to push entry @ ${this.getPosition()}`);
		}

		const finalValue = (this.currentQuote === '"' || !this.currentQuote) ? this.getParsedValue() : this.currentValue
		this.gatheredValues.set(this.currentKey, finalValue);

		this.push({
			key: this.currentKey,
			value: finalValue
		});

		this.currentKey = this.currentValue = "";
		this.currentQuote = null;
		this.inComment = this.inValue = this.lastWasEqualSign = this.lastWasEscape = false;
	}

	workContent() {

		for (let i = 0, l = this.currentContent.length; i < l; i++) {
			const currentChar = this.currentContent[i];
			if (currentChar === "\n") {
				this.currentLineCount++;
				this.currentColumnCount = 0;
			}

			this.currentColumnCount++;

			if (this.inComment) {
				this.inComment = currentChar !== "\n";
				continue;
			}

			if (!this.inValue) {
				if (this.lastWasEqualSign) {
					if (this.isQuote(currentChar)) {
						this.currentQuote = currentChar;
					} else {
						this.currentValue += currentChar;
						this.lastWasEqualSign = false;
					}
					this.inValue = true;
					continue;
				} else if (currentChar === "=") {
					this.lastWasEqualSign = true;
					if (!this.currentKey) {
						throw new Error(`No key gathered, but equal sign reached! @ ${this.getPosition()}`);
					}
					continue;
				} else if (currentChar === "#") {
					this.inComment = true;
					this.pushEntry({ allowEmpty: true });
					continue;
				} else if (currentChar === ";" && !this.currentKey) {
					continue;
				} else if (this.isSpace(currentChar)) {
					continue;
				} else if (this.isKeyBeginning(currentChar) || this.currentKey && this.isKeyTail(currentChar)) {
					this.currentKey += currentChar;
					continue;
				} else {
					throw new Error(`Not in value and can't handle char (${currentChar}) @ ${this.getPosition()}`);
				}
			} else {
				if (currentChar === "\\") {
					this.lastWasEscape = true;
					continue;
				} else if ((this.currentQuote && currentChar === this.currentQuote && !this.lastWasEscape) || (!this.currentQuote && (currentChar === ";" || this.isLineEnding(currentChar)))) {
					this.inValue = false;
					this.pushEntry();
					continue;
				} else {
					this.lastWasEscape = false;
					this.currentValue += currentChar;
					continue;
				}
			}
		}

		this.currentContent = "";
	}
	_transform(buff: Buffer, _: string, next: Function) {
		this.currentContent += this.stringDecoder.write(buff);
		this.workContent();
		next();
	}

	_flush(done) {
		this.currentContent += this.stringDecoder.end();
		this.pushEntry({ allowEmpty: true });
		done();
	}
}

export default function env({ file, content }: { file?: string, content?: string | Buffer }): Promise<Map<string, string>> {

	let readable: Readable;
	if (file) {
		readable = createReadStream(file);
	} else if (content) {
		if (typeof content === "string") {
			content = Buffer.from(content);
		}
		readable = new Readable({ read: () => { } });
		readable.push(content);
		readable.push(null);
	} else {
		throw Error("Either {file} or {content} are needed when calling env()!");
	}

	return new Promise(then => {
		const gatheredValues: Map<string, string> = new Map();
		const writable = new Writable({
			objectMode: true,
			// WritableOptions in @types/node is broken, because it does not allow objectMode style write() implementations,
			// thus we use any for now
			write({ key, value }: any, _, next) {
				gatheredValues.set(key, value);
				next();
			}
		});

		writable.on("finish", () => {
			Array.from(gatheredValues).forEach(([key, value]) => process.env[key] = value);
			then(gatheredValues);
		});

		readable.pipe(new X3EnvParser).pipe(writable);
	});
}