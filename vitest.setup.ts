import { execSync } from "node:child_process";

// 테스트DB 마이그레이션
export default function setup(): void {
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
}
