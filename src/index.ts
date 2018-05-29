import { Transform, Writable } from "stream";
import { StringDecoder, NodeStringDecoder } from "string_decoder";
import { createReadStream } from "fs";

export class X3EnvParser extends Transform {
	static KEY_FIRST_CHAR_REGEX = /[a-zA-Z_]/;
	static KEY_TAIL_CHAR_REGEX = /[\w]/;
	static VALUE_ALLOWED_NOQUOTE = /[^\n]/;
	static VALUE_ALLOWED_QUOTE = /(.|\n)/;
	static SPACE = /\s/;
	static QUOTE = /['"]/;
	static STRING_VARIABLE = /\$[a-zA-Z_][\w]*/g;

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

	isValueInNoQuote(char: string): boolean {
		return (<RegExp>this.constructor["VALUE_ALLOWED_NOQUOTE"]).test(char);
	}

	isValueInQuote(char: string): boolean {
		return (<RegExp>this.constructor["VALUE_ALLOWED_QUOTE"]).test(char);
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
		let match = this.currentValue.match((<RegExp>this.constructor["STRING_VARIABLE"]));
		if (match) {
			match.shift();
			match = match.sort((matchA, matchB) => matchA > matchB && -1 || matchA < matchB && 1 || 0);
			let parts: any[] = [this.currentValue];
			for (let i = 1, l = match.length; i < l; i++) {
				const varUse = match[i];
				const varName = varUse.substring(1);
				const varValue = this.gatheredValues.has(varName) && this.gatheredValues.get(varName)
					|| typeof process.env[varName] !== "undefined" && process.env[varName] || undefined;
				if (typeof varValue === "undefined") continue;

				parts = parts.reduce((newParts, v, index, arr) => {
					if (typeof v === "string") {
						let split: any[] = v.split(varUse);
						for (let i = 0; i + 1 < split.length; i++) {
							split.splice(++i, 0, { value: varValue });
						}
						newParts.push(...split);
						return newParts;
					}
				}, []);
			}

			parts = parts.map(v => typeof v === "object" && v.value || v);

			return parts.join("");
		}

		return this.currentValue;
	}

	pushEntry({ allowEmpty = false }: { allowEmpty?: boolean } = {}) {
		if (allowEmpty && !this.currentKey) {
			return;
		}
		if (!allowEmpty && !this.currentKey) {
			throw new Error(`Key empty when trying to push entry @ ${this.getPosition()}`);
		}

		// this.gatheredValues.set(this.currentKey, this.currentQuote === '"' || !this.currentQuote ? this.getParsedValue() : this.currentValue);

		this.push({
			key: this.currentKey,
			value: this.currentQuote === '"' || !this.currentQuote ? this.getParsedValue() : this.currentValue
		});

		this.currentKey = this.currentValue = "";
		this.currentQuote = null;
	}

	_transform(buff: Buffer, _: string, next: Function) {
		this.currentContent += this.stringDecoder.write(buff);
		for (let i = 0, l = this.currentContent.length; i < l; i++) {
			const currentChar = this.currentContent[i];
			if (currentChar === "\n") {
				this.currentLineCount++;
				this.currentColumnCount = 0;
			}

			this.currentColumnCount++;

			if (this.inComment) {
				this.inComment = currentChar === "\n";
				continue;
			}

			if (!this.inValue) {
				if (currentChar === "=") {
					this.lastWasEqualSign = true;
					if (!this.currentKey) {
						throw new Error(`No key gathered, but equal sign reached! @ ${this.getPosition()}`);
					}
					continue;
				} else if (currentChar === "#") {
					this.inComment = true;
					this.pushEntry({ allowEmpty: true });
					continue;
				} else if (this.isSpace(currentChar)) {
					continue;
				} else if (this.isKeyBeginning(currentChar) || this.currentKey && this.isKeyTail(currentChar)) {
					this.currentKey += currentChar;
					continue;
				} else if (this.lastWasEqualSign) {
					if (this.isQuote(currentChar)) {
						this.currentQuote = currentChar;
					} else {
						this.currentValue += currentChar;
						this.lastWasEqualSign = false;
					}
					this.inValue = true;
					continue;
				} else {
					throw new Error(`Not in value and can't handle char (${currentChar}) @ ${this.getPosition()}`);
				}
			} else {
				if (currentChar === "\\") {
					this.lastWasEscape = true;
					continue;
				} else if ((this.currentQuote && currentChar === this.currentQuote && !this.lastWasEscape) || !this.currentQuote && currentChar === "\n") {
					this.inValue = false;
					this.pushEntry();
					continue;
				} else {
					if (this.lastWasEscape) {
						this.lastWasEscape = false;
						this.currentValue += "\\";
					}
					this.currentValue += currentChar;
					continue;
				}
			}
		}
	}
}

export default function env(file: string): Promise<Map<string, string>> {
	return new Promise(then => {
		const gatheredValues: Map<string, string> = new Map();
		const writable = new Writable({
			objectMode: true,
			// WritableOptions in @types/node is broken, because it does not allow objectMode style write() implementations,
			// thus we use any for now
			write({ key, value }: any, _, next) {
				gatheredValues.set(key, value);
			}
		});

		writable.on("finish", () => {
			Array.from(gatheredValues).forEach(([key, value]) => process.env[key] = value);
			then(gatheredValues);
		});

		createReadStream(file).pipe(new X3EnvParser).pipe(writable);
	});
}