import { hashPassword } from "better-auth/crypto";

const password = process.argv[2];
if (!password) {
  console.error("usage: node scripts/hash-password.mjs <password>");
  process.exit(1);
}

const hash = await hashPassword(password);
console.log(hash);
