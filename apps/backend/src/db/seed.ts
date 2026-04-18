import { db } from "@/db/index.ts";
import { userGlobalRoles } from "@/db/schema/department/index.ts";
import { auth } from "@/lib/auth.ts";

async function seed() {
  console.log("Checking user...");

  const existingUser = await db.query.users.findFirst({
    where: (table, { eq: equals }) => equals(table.email, "amanchand012@gmail.com"),
    columns: {
      id: true,
      email: true,
    },
  });

  if (existingUser) {
    await db
      .insert(userGlobalRoles)
      .values({
        userId: existingUser.id,
        role: "system_admin",
      })
      .onConflictDoNothing({
        target: [userGlobalRoles.userId, userGlobalRoles.role],
      });

    console.log("User already exists:", existingUser.email);
    return;
  }

  const authResponse = await auth.api.signUpEmail({
    body: {
      email: "amanchand012@gmail.com",
      password: "aman1234",
      name: "Aman",
      username: "aman",
      displayUsername: "Aman",
    },
  });

  await db
    .insert(userGlobalRoles)
    .values({
      userId: authResponse.user.id,
      role: "system_admin",
    })
    .onConflictDoNothing({
      target: [userGlobalRoles.userId, userGlobalRoles.role],
    });

  console.log("User created:", authResponse.user.email);
}

seed().catch((error: unknown) => {
  console.error("Seed failed.");
  console.error(error);
  process.exit(1);
});
