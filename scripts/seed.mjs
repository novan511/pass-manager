/**
 * Seed / repair multi-tenant data for local dev.
 * Usage: node scripts/seed.mjs
 */
import { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes, scryptSync } from "crypto";

const prisma = new PrismaClient();

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `s1:${salt.toString("hex")}:${hash.toString("hex")}`;
}

function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "org"
  );
}

async function main() {
  // 1) Ensure platform owner
  const platformEmail = "owner@keyring.test";
  const platformPassword = "platform-owner-pass-1";
  let platform = await prisma.user.findUnique({ where: { email: platformEmail } });
  if (!platform) {
    platform = await prisma.user.create({
      data: {
        email: platformEmail,
        passwordHash: hashPassword(platformPassword),
        platformRole: "superadmin",
        orgRole: null,
        role: "admin",
        status: "active",
        allowedCategories: "work,personal,finance,social,other",
      },
    });
    console.log("Created platform owner:", platformEmail, platformPassword);
  } else {
    await prisma.user.update({
      where: { id: platform.id },
      data: { platformRole: "superadmin", status: "active" },
    });
    console.log("Platform owner already exists:", platformEmail);
  }

  // 2) Ensure demo project org + owner + member
  const orgName = "Acme Studio";
  let org = await prisma.organization.findUnique({ where: { slug: slugify(orgName) } });
  if (!org) {
    org = await prisma.organization.create({
      data: { name: orgName, slug: slugify(orgName) },
    });
    console.log("Created organization:", org.name);
  }

  const ownerEmail = "boss@acme.test";
  const ownerPassword = "acme-owner-pass-1";
  let owner = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (!owner) {
    owner = await prisma.user.create({
      data: {
        email: ownerEmail,
        passwordHash: hashPassword(ownerPassword),
        platformRole: "user",
        orgRole: "owner",
        role: "admin",
        status: "active",
        organizationId: org.id,
        allowedCategories: "work,personal,finance,social,other",
      },
    });
    console.log("Created org owner:", ownerEmail, ownerPassword);
  } else {
    await prisma.user.update({
      where: { id: owner.id },
      data: {
        organizationId: org.id,
        orgRole: "owner",
        role: "admin",
        platformRole: "user",
        status: "active",
      },
    });
  }

  const memberEmail = "staff@acme.test";
  const memberPassword = "acme-member-pass-1";
  let member = await prisma.user.findUnique({ where: { email: memberEmail } });
  if (!member) {
    member = await prisma.user.create({
      data: {
        email: memberEmail,
        passwordHash: hashPassword(memberPassword),
        platformRole: "user",
        orgRole: "member",
        role: "member",
        status: "active",
        organizationId: org.id,
        allowedCategories: "work,personal",
      },
    });
    console.log("Created org member:", memberEmail, memberPassword);
  } else {
    await prisma.user.update({
      where: { id: member.id },
      data: {
        organizationId: org.id,
        orgRole: "member",
        role: "member",
        platformRole: "user",
        status: "active",
        allowedCategories: "work,personal",
      },
    });
  }

  // 3) Backfill: any user without org gets a personal org as owner
  const orphans = await prisma.user.findMany({
    where: { organizationId: null, platformRole: { not: "superadmin" } },
  });
  for (const u of orphans) {
    const name = `${u.email.split("@")[0]} vault`;
    let s = slugify(name);
    if (await prisma.organization.findUnique({ where: { slug: s } })) {
      s = `${s}-${u.id.slice(-6)}`;
    }
    const o = await prisma.organization.create({
      data: { name, slug: s },
    });
    await prisma.user.update({
      where: { id: u.id },
      data: {
        organizationId: o.id,
        orgRole: u.orgRole ?? (u.role === "admin" ? "owner" : "member"),
      },
    });
    console.log("Backfilled org for", u.email, "→", o.name);
  }

  console.log("\nDone. Zero-knowledge note: platform APIs never return vault ciphertext.");
  console.log("Logins:");
  console.log("  Platform :", platformEmail, platformPassword);
  console.log("  Owner    :", ownerEmail, ownerPassword);
  console.log("  Member   :", memberEmail, memberPassword);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
