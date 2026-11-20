import "dotenv/config";
import { getAuth } from "firebase-admin/auth";
import firebaseApp from "../src/config/firebase";
import { logAdminAction } from "../src/services/admin-log.service";

const auth = getAuth(firebaseApp);

// setCustomUserClaims replaces ALL claims, so merge instead of overwriting.
function nextClaims(current: Record<string, unknown>, revoke: boolean) {
  const { admin: _removed, ...rest } = current;

  return revoke
    ? rest
    : {
        ...current,
        admin: true,
      };
}

async function main() {
  const [email, flag] = process.argv.slice(2);

  if (!email) {
    console.error("Usage: npm run grant-admin -- <email> [--revoke]");
    process.exit(1);
  }

  const revoke = flag === "--revoke";

  const user = await auth.getUserByEmail(email);
  const before = user.customClaims ?? {};
  const after = nextClaims(before, revoke);

  await auth.setCustomUserClaims(user.uid, after);
  if (revoke) await auth.revokeRefreshTokens(user.uid);

  await logAdminAction(
    "script",
    revoke ? "admin.revoke" : "admin.grant",
    { type: "user", id: user.uid },
    before,
    after,
  );
  console.log(
    `${revoke ? "Revoked" : "Granted"} admin for ${email} (${user.uid})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});