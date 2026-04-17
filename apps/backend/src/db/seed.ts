import { db } from "@/db/index.ts";
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

  console.log("User created:", authResponse.user.email);
}

seed().catch((error: unknown) => {
  console.error("Seed failed.");
  console.error(error);
  process.exit(1);
});
