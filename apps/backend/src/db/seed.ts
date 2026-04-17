import { auth } from "@/lib/auth.ts";

async function seed() {
  console.log("Creating user...");

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
