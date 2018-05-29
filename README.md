# Intro

This is an environment file and value parsing piece of npm package. It aims to replace dotenv for me and anyone eager and brave enough to use it. It supports many features I missed.

The default export of this module is a function named env that takes an object with **either** `file` or `content` as field, where `file` must be a path and `content` must be **either** an utf8 `Buffer` or a `string`. 

I build this, because dotenv does not support following:
```bash
TEST1=sgnirts driew tcelloc I
TEST2=I collect weird strings $TEST1
```

Or following:
```bash
HOME="$HOME$USERPOFILE"
```
This might not be cool but it's possible.


It does following:
- Allow single quoted, double quoted and unquoted values
- Parse variables within double quoted variable values or unquoted variable values
  - This is also true for all other variables in process.env
- Not parse variables within single quoted variables
- For content, this only supports utf8. Other formats have to be converted before. (e.g. by [iconv-lite](https://www.npmjs.com/package/iconv-lite))
- Parsed values will be spilled into process.env
- Parsed values will be returned by the Promise

# Usage
```ts
env({file: "/path/"});
```
or
```ts
env({content: "TEST=true"});
```
or
```ts
env({content: Buffer.from([106, 117, 115, 116, 107, 105, 100, 100, 105, 110, 103, 61, 116, 104, 105, 115, 105, 115, 110, 111, 114, 101, 97, 108, 101, 120, 97, 109, 112, 108, 101])});
```

Mind the d.ts:
```ts
export default function env({file, content}: {
    file?: string;
    content?: string | Buffer;
}): Promise<Map<string, string>>;
```


Examples:

```ts
const {env} = require("x3-env");
env({content:"IWANTTHISVAR=ichangedmymind"});

console.log(`I want following value: ${process.env("IWANTTHISVAR")}`);
```

Or
```ts
/**
 * .env.bootstrap content is:
 * HOME=$HOME$USERPROFILE
 * LOCAL_NOT_FOUND_ERROR=".env.local was not found
 * Please create $HOME/.env.local!"
 */
const {env} = require("x3-env");
const { existsSync } = require("fs");
const { join } = require("path");
env({ file: join(__dirname, ".env.bootstrap") });
if (existsSync(join(process.env["HOME"], ".env")))
	env({ file: join(process.env["HOME"], ".env") })
else
	throw new Error(process.env["LOCAL_NOT_FOUND_ERROR"]);
```