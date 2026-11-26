import "dotenv/config";
import { prisma } from "../../src/lib/prisma.js";

// Creates the admin user (the only user of the system)
async function main() {
  const email = process.env.ADMIN_EMAIL!,
  
        admin = await prisma.user.upsert({
          where: { email },
          update: { role: "ADMIN" },
          create: { name: "Pedra", email, role: "ADMIN",},
        });

  console.log(`Usuário administrador pronto: ${admin.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());